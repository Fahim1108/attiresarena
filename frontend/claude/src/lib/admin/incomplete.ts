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

export interface IncompleteStats {
  /** Total matching abandoned checkouts (the loader's exact count). */
  totalAbandoned: number;
  /** Pending + contacted rows on the loaded page. */
  pendingRecovery: number;
  /** Recovered rows on the loaded page. */
  recovered: number;
  /**
   * Basket value of pending + contacted rows on the loaded page only.
   * Recovered value already became orders and lost value will not recover,
   * so neither counts as potential revenue. Page-scoped by design: the
   * loader returns one page, and inventing a total would be dishonest.
   */
  potentialRevenueMinor: number;
  /** Rows on the loaded page. */
  pageCount: number;
}

/**
 * 4-stat header from the EXISTING loader data only: the loaded page rows
 * plus the loader's exact matching count. No new query. The UI must label
 * the page-scoped figures as such and must never show potential revenue
 * from sample rows (revenue is real data only).
 */
export function incompleteStats(
  views: readonly {
    session: { recovery_status: RecoveryStatus };
    valueMinor: number;
  }[],
  totalCount: number,
): IncompleteStats {
  let pendingRecovery = 0;
  let recovered = 0;
  let potentialRevenueMinor = 0;
  for (const view of views) {
    if (view.session.recovery_status === "pending" || view.session.recovery_status === "contacted") {
      pendingRecovery += 1;
      potentialRevenueMinor += view.valueMinor;
    } else if (view.session.recovery_status === "recovered") {
      recovered += 1;
    }
  }
  return {
    totalAbandoned: totalCount,
    pendingRecovery,
    recovered,
    potentialRevenueMinor,
    pageCount: views.length,
  };
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
): Promise<{ ids: string[]; narrowed: boolean } | null> {
  const pattern = escapeLikePattern(q);
  const [byName, byPhone, byEmail] = await Promise.all([
    client.from("checkout_sessions").select("id").ilike("customer_name", pattern).limit(SEARCH_LIMIT),
    client.from("checkout_sessions").select("id").ilike("phone", pattern).limit(SEARCH_LIMIT),
    client.from("checkout_sessions").select("id").ilike("email", pattern).limit(SEARCH_LIMIT),
  ]);
  if (byName.error || byPhone.error || byEmail.error) {
    // Unavailable: the caller degrades honestly instead of throwing.
    return null;
  }
  const idSchema = z.object({ id: z.uuid() });
  const ids = new Set<string>();
  for (const result of [byName, byPhone, byEmail]) {
    const parsed = idSchema.array().safeParse(result.data);
    if (!parsed.success) return null;
    for (const row of parsed.data) ids.add(row.id);
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

/**
 * Reads return null when the live data is UNAVAILABLE (missing table/RPC,
 * failed query, or malformed rows) so pages can degrade honestly with
 * labeled sample data instead of throwing into the error boundary. The
 * strict definition is unchanged: ONLY abandoned sessions with items and
 * no linked order. notFound() is kept for genuinely missing records.
 */
export async function readIncompleteSessions(
  params: Record<string, string | string[] | undefined>,
) {
  const session = await requireStaff(areaRoles("recovery"));
  const filters = incompleteFilters(params);
  const scope = filters.q ? await searchSessionIds(session.client, filters.q) : null;
  if (filters.q && scope === null) return null;
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
  if (result.error) return null;
  const rowSchema = checkoutSessionRowSchema.extend({
    checkout_items: checkoutItemRowSchema.array(),
  });
  const parsed = rowSchema.array().safeParse(result.data);
  if (!parsed.success) return null;
  const sessions: IncompleteSessionView[] = parsed.data.map((row) => {
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
  if (sessionResult.error) return null;
  if (!sessionResult.data) notFound();
  const checkoutParsed = checkoutSessionRowSchema.safeParse(sessionResult.data);
  if (!checkoutParsed.success) return null;
  const checkout = checkoutParsed.data;

  const itemsResult = await session.client
    .from("checkout_items")
    .select(ITEM_COLUMNS)
    .eq("checkout_session_id", id)
    .order("created_at", { ascending: true })
    .limit(50);
  if (itemsResult.error) return null;
  const itemsParsed = checkoutItemRowSchema.array().safeParse(itemsResult.data);
  if (!itemsParsed.success) return null;
  const items = itemsParsed.data;
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
  if (logResult.error) return null;
  const logParsed = recoveryLogRowSchema.array().safeParse(logResult.data);
  if (!logParsed.success) return null;
  const log = logParsed.data;

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

/**
 * The follow-up note field is gone (Batch 1): staff just press Lost or
 * Revived. The RPC and the append-only log still require a note for a
 * manual entry (the RPC refuses notes shorter than 3 chars; the
 * abandoned_recovery_log CHECK requires a note on manual rows), so the
 * action records a fixed staff note instead of asking for one.
 *
 * That fixed note IS the persistence fix. A note-less submit used to
 * fail validation here — before any RPC call — so Lost never reached
 * the database and the badge still read Pending after reload. The id,
 * table and column were already right: session.id is passed as
 * target_session, and the RPC updates checkout_sessions.recovery_status
 * (guard trigger allows pending/contacted -> lost) and revalidatePath
 * refreshes the list and detail pages. Nothing else in the write path
 * was broken.
 */
const RECOVERY_STAFF_NOTE = "Marked as Lost from the admin panel.";

const recoverySchema = z.object({
  id: z.uuid(),
  expected_updated_at: z.iso.datetime({ offset: true }),
  new_status: z.enum(["lost", "recovered"]),
});

export async function setRecoveryStatus(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const parsed = recoverySchema.safeParse({
    id: formData.get("id"),
    expected_updated_at: formData.get("expected_updated_at"),
    new_status: formData.get("new_status"),
  });
  if (!parsed.success) {
    return actionError("Choose Lost or Revived and try again.");
  }
  // Recovered is recorded only from a linked purchase. The RPC refuses
  // manual 'recovered' (22023), and the checkout_sessions CHECKs forbid
  // recovered on an abandoned session with no order (recovered_at plus
  // a completed lifecycle and order_id are required). Refuse here with
  // the specific reason instead of letting the RPC fail generically.
  // Lifting that rule needs a migration — a coordinator decision, not
  // part of this slice — so Revived cannot write recovered yet.
  if (parsed.data.new_status === "recovered") {
    return actionError(
      "Recovered cannot be set manually. It is recorded automatically when a linked purchase is placed.",
    );
  }
  const session = await requireStaff(areaRoles("recovery"));
  const result = await session.client.rpc("admin_set_checkout_recovery_status", {
    target_session: parsed.data.id,
    expected_updated_at: parsed.data.expected_updated_at,
    new_status: parsed.data.new_status,
    note: RECOVERY_STAFF_NOTE,
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
