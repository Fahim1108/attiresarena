import "server-only";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, actionOk, actionError, toActionError, type AdminActionResult, type StaffSession } from "./authorization";
import {
  RECOVERY_STATUSES,
  RECOVERY_STATUS_LABELS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  areaRoles,
  type RecoveryStatus,
} from "./constants";
import { parsePage, parsePageSize } from "./format";
import { escapeLikePattern, productCoverUrls } from "./orders";

/* ------------------------------------------------------------------ */
/* Pure helpers (covered by tests/sales.check.ts)                      */
/* ------------------------------------------------------------------ */

/**
 * Honest checkout-progress label. "Reached checkout" is only claimed when
 * the session actually holds contact details and at least one item.
 */
export function checkoutProgressLabel(
  session: { customer_name: string; phone: string },
  itemCount: number,
): string {
  const hasContact = session.customer_name.trim().length > 0 && session.phone.trim().length > 0;
  if (hasContact && itemCount > 0) return "Reached checkout — delivery details saved";
  return "Checkout started";
}

/** Basket value from authoritative price snapshots (minor units). */
export function sessionValue(
  items: readonly { unit_price_minor: number; quantity: number }[],
): number {
  return items.reduce((sum, item) => sum + item.unit_price_minor * item.quantity, 0);
}

/**
 * Recovery statuses staff may set manually. "Recovered" is deliberately
 * absent: the database records it only from a linked purchase.
 */
export function manualRecoveryOptions(status: RecoveryStatus): RecoveryStatus[] {
  if (status === "pending") return ["contacted", "lost"];
  if (status === "contacted") return ["lost"];
  return [];
}

export function isRecoveryStatus(value: unknown): value is RecoveryStatus {
  return typeof value === "string" && (RECOVERY_STATUSES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Row schemas. token_hash is NEVER selected.                          */
/* ------------------------------------------------------------------ */

const toOne = <T extends z.ZodType>(schema: T) =>
  z
    .union([schema, z.array(schema).max(1)])
    .nullable()
    .optional()
    .transform((v) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as z.infer<T> | null);

export const checkoutSessionRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  customer_name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  lifecycle_status: z.enum(["active", "abandoned", "completed"]),
  recovery_status: z.enum(RECOVERY_STATUSES),
  started_at: z.iso.datetime({ offset: true }),
  last_activity_at: z.iso.datetime({ offset: true }),
  abandoned_at: z.iso.datetime({ offset: true }).nullable(),
  contacted_at: z.iso.datetime({ offset: true }).nullable(),
  recovered_at: z.iso.datetime({ offset: true }).nullable(),
  expires_at: z.iso.datetime({ offset: true }),
  order_id: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export type CheckoutSessionRow = z.infer<typeof checkoutSessionRowSchema>;

export const checkoutItemRowSchema = z.object({
  id: z.uuid(),
  checkout_session_id: z.uuid(),
  product_id: z.uuid(),
  variant_id: z.uuid(),
  quantity: z.number().int(),
  regular_price_minor: z.number().int(),
  unit_price_minor: z.number().int(),
  price_snapshot_at: z.iso.datetime({ offset: true }),
  products: toOne(z.object({ name: z.string() })),
  product_variants: toOne(z.object({ size: z.string(), color: z.string() })),
});

export type CheckoutItemRow = z.infer<typeof checkoutItemRowSchema>;

export interface CheckoutItemView extends CheckoutItemRow {
  imageUrl: string | null;
  imageAlt: string;
}

export const recoveryLogRowSchema = z.object({
  id: z.uuid(),
  checkout_session_id: z.uuid(),
  previous_recovery_status: z.enum(RECOVERY_STATUSES),
  new_recovery_status: z.enum(RECOVERY_STATUSES),
  changed_by: z.uuid().nullable(),
  change_source: z.enum(["manual", "automatic"]),
  note: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
});

export type RecoveryLogRow = z.infer<typeof recoveryLogRowSchema>;

const SESSION_COLUMNS =
  "id,user_id,customer_name,phone,email,lifecycle_status,recovery_status,started_at,last_activity_at,abandoned_at,contacted_at,recovered_at,expires_at,order_id,created_at,updated_at";
const ITEM_COLUMNS =
  "id,checkout_session_id,product_id,variant_id,quantity,regular_price_minor,unit_price_minor,price_snapshot_at,created_at,products(name),product_variants(size,color)";

type StaffClient = StaffSession["client"];

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export type IncompleteSort = "recent" | "oldest";

export interface IncompleteFilters {
  q: string;
  recovery: RecoveryStatus | "";
  sort: IncompleteSort;
  page: number;
  pageSize: number;
}

export function incompleteFilters(
  params: Record<string, string | string[] | undefined>,
): IncompleteFilters {
  const text = (key: string): string =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const recovery = text("recovery");
  const sort = text("sort");
  return {
    q: text("q").trim().slice(0, 120),
    recovery: isRecoveryStatus(recovery) ? recovery : "",
    sort: sort === "oldest" ? "oldest" : "recent",
    page: parsePage(text("page")),
    pageSize: parsePageSize(text("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

/* ------------------------------------------------------------------ */
/* Reads: ONLY abandoned sessions with items and no linked order       */
/* ------------------------------------------------------------------ */

const SEARCH_LIMIT = 100;
const SEARCH_CAP = 150;

async function searchSessionIds(
  client: StaffClient,
  q: string,
): Promise<{ ids: string[]; narrowed: boolean }> {
  const pattern = escapeLikePattern(q);
  const [byName, byPhone, byEmail] = await Promise.all([
    client.from("checkout_sessions").select("id").ilike("customer_name", pattern).limit(SEARCH_LIMIT),
    client.from("checkout_sessions").select("id").ilike("phone", pattern).limit(SEARCH_LIMIT),
    client.from("checkout_sessions").select("id").ilike("email", pattern).limit(SEARCH_LIMIT),
  ]);
  if (byName.error || byPhone.error || byEmail.error) {
    throw new Error("Checkout search could not be completed. No changes were made.");
  }
  const idSchema = z.object({ id: z.uuid() });
  const ids = new Set<string>();
  for (const result of [byName, byPhone, byEmail]) {
    for (const row of idSchema.array().parse(result.data)) ids.add(row.id);
  }
  const narrowed =
    [byName.data, byPhone.data, byEmail.data].some((rows) => (rows?.length ?? 0) >= SEARCH_LIMIT) ||
    ids.size > SEARCH_CAP;
  return { ids: [...ids].slice(0, SEARCH_CAP), narrowed };
}

export interface IncompleteSessionView {
  session: CheckoutSessionRow;
  items: CheckoutItemRow[];
  valueMinor: number;
  itemCount: number;
  progressLabel: string;
}

export async function readIncompleteSessions(
  params: Record<string, string | string[] | undefined>,
) {
  const session = await requireStaff(areaRoles("recovery"));
  const filters = incompleteFilters(params);
  const scope = filters.q ? await searchSessionIds(session.client, filters.q) : null;
  if (scope && scope.ids.length === 0) {
    return { sessions: [] as IncompleteSessionView[], count: 0, filters, narrowed: scope.narrowed };
  }
  // checkout_items!inner guarantees at least one item exists; active and
  // completed sessions and browsing-only sessions never appear here.
  let query = session.client
    .from("checkout_sessions")
    .select(`${SESSION_COLUMNS},checkout_items!inner(${ITEM_COLUMNS})`, { count: "exact" })
    .eq("lifecycle_status", "abandoned")
    .is("order_id", null);
  if (scope) query = query.in("id", scope.ids);
  if (filters.recovery) query = query.eq("recovery_status", filters.recovery);
  if (filters.sort === "oldest") {
    query = query.order("abandoned_at", { ascending: true, nullsFirst: false }).order("id");
  } else {
    query = query.order("last_activity_at", { ascending: false }).order("id");
  }
  const result = await query.range(
    (filters.page - 1) * filters.pageSize,
    filters.page * filters.pageSize - 1,
  );
  if (result.error) throw new Error("Incomplete checkouts could not be read. No changes were made.");
  const rowSchema = checkoutSessionRowSchema.extend({
    checkout_items: checkoutItemRowSchema.array(),
  });
  const sessions: IncompleteSessionView[] = rowSchema.array().parse(result.data).map((row) => {
    const { checkout_items, ...sessionRow } = row;
    return {
      session: sessionRow,
      items: checkout_items,
      valueMinor: sessionValue(checkout_items),
      itemCount: checkout_items.reduce((sum, item) => sum + item.quantity, 0),
      progressLabel: checkoutProgressLabel(sessionRow, checkout_items.length),
    };
  });
  return { sessions, count: result.count ?? 0, filters, narrowed: scope?.narrowed ?? false };
}

export async function readIncompleteDetail(id: string) {
  const session = await requireStaff(areaRoles("recovery"));
  if (!z.uuid().safeParse(id).success) notFound();
  const sessionResult = await session.client
    .from("checkout_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (sessionResult.error) throw new Error("Checkout details could not be read.");
  if (!sessionResult.data) notFound();
  const checkout = checkoutSessionRowSchema.parse(sessionResult.data);

  const itemsResult = await session.client
    .from("checkout_items")
    .select(ITEM_COLUMNS)
    .eq("checkout_session_id", id)
    .order("created_at", { ascending: true })
    .limit(50);
  if (itemsResult.error) throw new Error("Checkout items could not be read.");
  const items = checkoutItemRowSchema.array().parse(itemsResult.data);
  const covers = await productCoverUrls(
    session.client,
    items.map((item) => item.product_id),
  );
  const itemsWithImages: CheckoutItemView[] = items.map((item) => {
    const cover = covers.get(item.product_id);
    const name = item.products?.name ?? "Product";
    return { ...item, imageUrl: cover?.url ?? null, imageAlt: cover?.alt || name };
  });

  const logResult = await session.client
    .from("abandoned_recovery_log")
    .select("id,checkout_session_id,previous_recovery_status,new_recovery_status,changed_by,change_source,note,created_at")
    .eq("checkout_session_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (logResult.error) throw new Error("Recovery history could not be read.");
  const log = recoveryLogRowSchema.array().parse(logResult.data);

  return {
    session: checkout,
    items: itemsWithImages,
    valueMinor: sessionValue(items),
    log,
    progressLabel: checkoutProgressLabel(checkout, items.length),
    // Recovery actions exist only for abandoned sessions with no order.
    recoveryEditable: checkout.lifecycle_status === "abandoned" && checkout.order_id === null,
  };
}

/* ------------------------------------------------------------------ */
/* Server Action: manual recovery status via the EXISTING RPC          */
/* ------------------------------------------------------------------ */

const recoverySchema = z.object({
  id: z.uuid(),
  expected_updated_at: z.iso.datetime({ offset: true }),
  new_status: z.enum(["contacted", "lost"]),
  note: z.string().trim().min(3).max(500),
});

export async function setRecoveryStatus(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const rawStatus = formData.get("new_status");
  if (rawStatus === "recovered") {
    return actionError(
      "Recovered cannot be set manually. It is recorded automatically when a linked purchase is placed.",
    );
  }
  const parsed = recoverySchema.safeParse({
    id: formData.get("id"),
    expected_updated_at: formData.get("expected_updated_at"),
    new_status: rawStatus,
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return actionError("Enter a follow-up note of 3 to 500 characters and choose Contacted or Lost.");
  }
  const session = await requireStaff(areaRoles("recovery"));
  const result = await session.client.rpc("admin_set_checkout_recovery_status", {
    target_session: parsed.data.id,
    expected_updated_at: parsed.data.expected_updated_at,
    new_status: parsed.data.new_status,
    note: parsed.data.note,
  });
  if (result.error) {
    if (result.error.code === "PT409") {
      return actionError("This checkout changed. Reload to see the latest recovery status before trying again.");
    }
    return actionError(
      toActionError(result.error, "Recovery status could not be changed. Check your access and try again."),
    );
  }
  revalidatePath("/admin/sales/incomplete");
  revalidatePath(`/admin/sales/incomplete/${parsed.data.id}`);
  return actionOk(`Marked as ${RECOVERY_STATUS_LABELS[parsed.data.new_status]}.`);
}
