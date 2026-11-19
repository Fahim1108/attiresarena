import "server-only";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, actionOk, actionError, toActionError, type AdminActionResult, type StaffSession } from "./authorization";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TRANSITIONS,
  PRODUCT_MEDIA_BUCKET,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  areaRoles,
  isOrderStatus,
  type OrderStatus,
  type PaymentStatus,
} from "./constants";
import { formatDateTime, formatOrderNumber, parsePage, parsePageSize, toCsv } from "./format";

/* ------------------------------------------------------------------ */
/* Pure helpers (covered by tests/sales.check.ts)                      */
/* ------------------------------------------------------------------ */

/** Legal next statuses, mirroring the guard_order_update trigger exactly. */
export function legalTransitions(status: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[status];
}

export function isLegalTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Statuses every selected order may legally move to (intersection, in the
 * order the first order lists them). Empty when nothing is common to all.
 */
export function commonLegalTransitions(statuses: readonly OrderStatus[]): OrderStatus[] {
  if (statuses.length === 0) return [];
  const first = ORDER_TRANSITIONS[statuses[0] as OrderStatus];
  return first.filter((candidate) =>
    statuses.every((status) => ORDER_TRANSITIONS[status].includes(candidate)),
  );
}

/** Legal next payment statuses, mirroring admin_set_payment_status exactly. */
export function legalPaymentTransitions(status: PaymentStatus): readonly PaymentStatus[] {
  return PAYMENT_TRANSITIONS[status];
}

export function isLegalPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/* ------------------------------------------------------------------ */
/* 3-hour unverified-order rule (pure selection; the sweep itself is   */
/* the admin_run_unverified_order_sweep RPC). The predicate mirrors    */
/* the SQL exactly: status = 'pending' AND placed_at < now - 3 hours.  */
/* An order exactly 3 hours old is KEPT (strict < on both sides).      */
/* `nowMs` is injectable so boundary tests never depend on the clock.  */
/* ------------------------------------------------------------------ */

/** Three hours, in milliseconds. The SQL sweep uses `interval '3 hours'`. */
export const STALE_ORDER_THRESHOLD_MS = 3 * 60 * 60 * 1000;

export function isStalePendingOrder(
  order: { status: OrderStatus; placed_at: string },
  nowMs: number,
): boolean {
  if (order.status !== "pending") return false;
  const placedMs = Date.parse(order.placed_at);
  if (Number.isNaN(placedMs)) return false;
  return placedMs < nowMs - STALE_ORDER_THRESHOLD_MS;
}

/**
 * Orders the sweep would cancel: stale pending orders WITHOUT a shipment
 * record. `shippedOrderIds` is the set of order ids that already have a
 * row in order_shipments; those are skipped, never swept.
 */
export function selectSweepableOrders<T extends { id: string; status: OrderStatus; placed_at: string }>(
  orders: readonly T[],
  shippedOrderIds: ReadonlySet<string>,
  nowMs: number,
): T[] {
  return orders.filter(
    (order) => !shippedOrderIds.has(order.id) && isStalePendingOrder(order, nowMs),
  );
}

/** Stale pending orders skipped ONLY because they already have a shipment. */
export function selectSkippedShippedOrders<T extends { id: string; status: OrderStatus; placed_at: string }>(
  orders: readonly T[],
  shippedOrderIds: ReadonlySet<string>,
  nowMs: number,
): T[] {
  return orders.filter(
    (order) => shippedOrderIds.has(order.id) && isStalePendingOrder(order, nowMs),
  );
}

/** Escape LIKE wildcards so search text is matched literally. */
export function escapeLikePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}

export interface OrderCsvRow {
  order_number: number | null;
  placed_at: string;
  customer_name: string;
  phone: string;
  status: string;
  payment_status: string;
  subtotal_minor: number;
  delivery_charge_minor: number;
  discount_minor: number;
  total_minor: number;
}

function minorToDecimal(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** CSV for order exports. Never includes SKUs or internal ids. */
export function ordersToCsv(rows: readonly OrderCsvRow[]): string {
  return toCsv(
    [
      "Order number",
      "Placed (Dhaka)",
      "Customer",
      "Phone",
      "Status",
      "Payment status",
      "Subtotal (BDT)",
      "Delivery (BDT)",
      "Discount (BDT)",
      "Total (BDT)",
    ],
    rows.map((row) => [
      row.order_number ?? "",
      formatDateTime(row.placed_at),
      row.customer_name,
      row.phone,
      row.status,
      row.payment_status,
      minorToDecimal(row.subtotal_minor),
      minorToDecimal(row.delivery_charge_minor),
      minorToDecimal(row.discount_minor),
      minorToDecimal(row.total_minor),
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* Row schemas (reads go through RLS; the SKU column is never selected) */
/* ------------------------------------------------------------------ */

export const orderRowSchema = z.object({
  id: z.uuid(),
  order_number: z.number().int().nullable(),
  user_id: z.uuid().nullable(),
  customer_name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  division: z.string(),
  district: z.string(),
  area: z.string(),
  address_line: z.string(),
  note: z.string().nullable(),
  payment_method: z.string(),
  payment_status: z.enum(PAYMENT_STATUSES),
  status: z.enum(ORDER_STATUSES),
  subtotal_minor: z.number().int(),
  delivery_charge_minor: z.number().int(),
  discount_minor: z.number().int(),
  total_minor: z.number().int(),
  placed_at: z.iso.datetime({ offset: true }),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export type OrderRow = z.infer<typeof orderRowSchema>;

export const orderItemRowSchema = z.object({
  id: z.uuid(),
  order_id: z.uuid(),
  product_id: z.uuid(),
  variant_id: z.uuid(),
  product_name: z.string(),
  size: z.string(),
  color: z.string(),
  unit_price_minor: z.number().int(),
  quantity: z.number().int(),
  line_total_minor: z.number().int(),
  created_at: z.iso.datetime({ offset: true }),
});

export type OrderItemRow = z.infer<typeof orderItemRowSchema>;

export interface OrderItemView extends OrderItemRow {
  imageUrl: string | null;
  imageAlt: string;
}

const auditChangeSchema = z.object({
  before: z.string().nullish(),
  after: z.string().nullish(),
});

export interface OrderHistoryEntry {
  id: string;
  /** "status" for order.status_changed rows, "payment" for payment rows. */
  kind: "status" | "payment";
  before: string | null;
  after: string | null;
  created_at: string;
}

export const ORDER_COLUMNS =
  "id,order_number,user_id,customer_name,phone,email,division,district,area,address_line,note,payment_method,payment_status,status,subtotal_minor,delivery_charge_minor,discount_minor,total_minor,placed_at,created_at,updated_at";
/**
 * Snapshot columns only: name/size/color/price as recorded at order time.
 * Exported so tests can pin that the detail read never re-derives line
 * items from the live catalogue (and never selects the SKU column).
 */
export const ORDER_ITEM_COLUMNS =
  "id,order_id,product_id,variant_id,product_name,size,color,unit_price_minor,quantity,line_total_minor,created_at";

/* ------------------------------------------------------------------ */
/* Product images (best effort: missing images never block order data) */
/* ------------------------------------------------------------------ */

type StaffClient = StaffSession["client"];

/**
 * First gallery image per product as a short-lived signed URL, falling back
 * to the imported garment photograph. Returns null per product when no
 * image is available or the staff session cannot read media.
 */
export async function productCoverUrls(
  client: StaffClient,
  productIds: readonly string[],
): Promise<Map<string, { url: string; alt: string } | null>> {
  const result = new Map<string, { url: string; alt: string } | null>();
  const unique = [...new Set(productIds)];
  for (const id of unique) result.set(id, null);
  if (unique.length === 0) return result;

  const media = await client
    .from("product_media")
    .select("product_id,storage_path,alt_text,position")
    .in("product_id", unique)
    .order("position", { ascending: true })
    .limit(200);
  const firstByProduct = new Map<string, { storage_path: string; alt_text: string }>();
  if (!media.error && Array.isArray(media.data)) {
    const mediaRow = z.object({
      product_id: z.uuid(),
      storage_path: z.string(),
      alt_text: z.string(),
      position: z.number().int(),
    });
    for (const row of media.data) {
      const parsed = mediaRow.safeParse(row);
      if (parsed.success && !firstByProduct.has(parsed.data.product_id)) {
        firstByProduct.set(parsed.data.product_id, parsed.data);
      }
    }
  }
  await Promise.all(
    [...firstByProduct.entries()].map(async ([productId, image]) => {
      const signed = await client.storage
        .from(PRODUCT_MEDIA_BUCKET)
        .createSignedUrl(image.storage_path, 120);
      if (!signed.error) {
        result.set(productId, { url: signed.data.signedUrl, alt: image.alt_text });
      }
    }),
  );

  const missing = unique.filter((id) => result.get(id) === null);
  if (missing.length > 0) {
    const intake = await client
      .from("thrift_intake")
      .select("product_id,image_path")
      .in("product_id", missing)
      .limit(200);
    if (!intake.error && Array.isArray(intake.data)) {
      const intakeRow = z.object({ product_id: z.uuid(), image_path: z.string() });
      for (const row of intake.data) {
        const parsed = intakeRow.safeParse(row);
        if (parsed.success) {
          result.set(parsed.data.product_id, { url: parsed.data.image_path, alt: "" });
        }
      }
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export type OrderSort = "newest" | "oldest" | "total-desc" | "total-asc";

export interface OrderFilters {
  q: string;
  status: OrderStatus | "";
  payment: "unpaid" | "paid" | "refunded" | "";
  from: string;
  to: string;
  sort: OrderSort;
  page: number;
  pageSize: number;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function validDateKey(value: string): boolean {
  return DATE_KEY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Day after a YYYY-MM-DD key, for an exclusive upper bound. */
function nextDateKey(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function orderFilters(
  params: Record<string, string | string[] | undefined>,
): OrderFilters {
  const text = (key: string): string =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const status = text("status");
  const payment = text("payment");
  const sort = text("sort");
  const from = text("from").trim();
  const to = text("to").trim();
  const validFrom = validDateKey(from) ? from : "";
  let validTo = validDateKey(to) ? to : "";
  if (validFrom && validTo && validTo < validFrom) validTo = "";
  return {
    q: text("q").trim().slice(0, 120),
    status: isOrderStatus(status) ? status : "",
    payment:
      payment === "unpaid" || payment === "paid" || payment === "refunded" ? payment : "",
    from: validFrom,
    to: validTo,
    sort:
      sort === "oldest" || sort === "total-desc" || sort === "total-asc" ? sort : "newest",
    page: parsePage(text("page")),
    pageSize: parsePageSize(text("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

const SEARCH_LIMIT = 100;
const SEARCH_CAP = 150;

async function searchOrderIds(
  client: StaffClient,
  q: string,
): Promise<{ ids: string[]; narrowed: boolean } | null> {
  const pattern = escapeLikePattern(q);
  const numeric = /^\d{1,5}$/.test(q) ? Number(q) : null;
  const [byName, byPhone, byEmail, byNumber] = await Promise.all([
    client.from("orders").select("id").ilike("customer_name", pattern).limit(SEARCH_LIMIT),
    client.from("orders").select("id").ilike("phone", pattern).limit(SEARCH_LIMIT),
    client.from("orders").select("id").ilike("email", pattern).limit(SEARCH_LIMIT),
    numeric === null
      ? Promise.resolve({ data: [], error: null })
      : client.from("orders").select("id").eq("order_number", numeric).limit(SEARCH_LIMIT),
  ]);
  if (byName.error || byPhone.error || byEmail.error || byNumber.error) {
    // Unavailable (table/RPC missing, query failed): the caller degrades
    // honestly instead of throwing into the error boundary.
    return null;
  }
  const idSchema = z.object({ id: z.uuid() });
  const ids = new Set<string>();
  for (const result of [byName, byPhone, byEmail, byNumber]) {
    const parsed = idSchema.array().safeParse(result.data);
    if (!parsed.success) return null;
    for (const row of parsed.data) ids.add(row.id);
  }
  const narrowed =
    [byName.data, byPhone.data, byEmail.data, byNumber.data].some(
      (rows) => (rows?.length ?? 0) >= SEARCH_LIMIT,
    ) || ids.size > SEARCH_CAP;
  return { ids: [...ids].slice(0, SEARCH_CAP), narrowed };
}

function applyOrderQuery(
  client: StaffClient,
  filters: OrderFilters,
  scopeIds: string[] | null,
  range: { from: number; to: number } | null,
) {
  let query = client.from("orders").select(ORDER_COLUMNS, { count: "exact" });
  if (scopeIds !== null) query = query.in("id", scopeIds);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.payment) query = query.eq("payment_status", filters.payment);
  if (filters.from) query = query.gte("placed_at", `${filters.from}T00:00:00+06:00`);
  if (filters.to) query = query.lt("placed_at", `${nextDateKey(filters.to)}T00:00:00+06:00`);
  if (filters.sort === "oldest") {
    query = query.order("placed_at", { ascending: true }).order("id", { ascending: true });
  } else if (filters.sort === "total-desc") {
    query = query.order("total_minor", { ascending: false }).order("placed_at", { ascending: false });
  } else if (filters.sort === "total-asc") {
    query = query.order("total_minor", { ascending: true }).order("placed_at", { ascending: false });
  } else {
    query = query.order("placed_at", { ascending: false }).order("id", { ascending: false });
  }
  if (range) query = query.range(range.from, range.to);
  return query;
}

/**
 * Reads return null when the live data is UNAVAILABLE (missing table/RPC,
 * failed query, or malformed rows) so pages can degrade honestly with
 * labeled sample data instead of throwing into the error boundary. A live
 * empty result is still returned as an empty list. notFound() is kept for
 * genuinely missing records, and requireStaff redirects are never caught.
 */
export async function readOrders(params: Record<string, string | string[] | undefined>) {
  const session = await requireStaff(areaRoles("orders"));
  const filters = orderFilters(params);
  const scope = filters.q ? await searchOrderIds(session.client, filters.q) : null;
  if (filters.q && scope === null) return null;
  if (scope && scope.ids.length === 0) {
    return { orders: [] as OrderRow[], count: 0, filters, narrowed: scope.narrowed };
  }
  const result = await applyOrderQuery(session.client, filters, scope?.ids ?? null, {
    from: (filters.page - 1) * filters.pageSize,
    to: filters.page * filters.pageSize - 1,
  });
  if (result.error) return null;
  const parsed = orderRowSchema.array().safeParse(result.data);
  if (!parsed.success) return null;
  return {
    orders: parsed.data,
    count: result.count ?? 0,
    filters,
    narrowed: scope?.narrowed ?? false,
  };
}

export async function readOrderDetail(id: string) {
  const session = await requireStaff(areaRoles("orders"));
  if (!z.uuid().safeParse(id).success) notFound();
  const orderResult = await session.client
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (orderResult.error) return null;
  if (!orderResult.data) notFound();
  const orderParsed = orderRowSchema.safeParse(orderResult.data);
  if (!orderParsed.success) return null;
  const order = orderParsed.data;

  const itemsResult = await session.client
    .from("order_items")
    .select(ORDER_ITEM_COLUMNS)
    .eq("order_id", id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(100);
  if (itemsResult.error) return null;
  const itemsParsed = orderItemRowSchema.array().safeParse(itemsResult.data);
  if (!itemsParsed.success) return null;
  const items = itemsParsed.data;
  const covers = await productCoverUrls(
    session.client,
    items.map((item) => item.product_id),
  );
  const itemsWithImages: OrderItemView[] = items.map((item) => {
    const cover = covers.get(item.product_id);
    return { ...item, imageUrl: cover?.url ?? null, imageAlt: cover?.alt || item.product_name };
  });

  // Status + payment history share the audit log; both actions are read
  // together (the payment policy in migration 20261116000100 admits
  // orders.read holders for the payment action, as 003 does for status).
  const historyResult = await session.client
    .from("admin_audit_logs")
    .select("id,action,changes,created_at")
    .eq("target_id", id)
    .in("action", ["order.status_changed", "order.payment_status_changed"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (historyResult.error) return null;
  const historyRow = z.object({
    id: z.uuid(),
    action: z.enum(["order.status_changed", "order.payment_status_changed"]),
    changes: z.unknown(),
    created_at: z.iso.datetime({ offset: true }),
  });
  const historyParsed = historyRow.array().safeParse(historyResult.data);
  if (!historyParsed.success) return null;
  const history: OrderHistoryEntry[] = historyParsed.data.map((row) => {
    const changes = auditChangeSchema.safeParse(row.changes);
    return {
      id: row.id,
      kind: row.action === "order.payment_status_changed" ? "payment" : "status",
      before: changes.success ? (changes.data.before ?? null) : null,
      after: changes.success ? (changes.data.after ?? null) : null,
      created_at: row.created_at,
    };
  });

  return { order, items: itemsWithImages, history };
}

/* ------------------------------------------------------------------ */
/* Notifications feed: recent orders as notices (owner item 14)        */
/*                                                                     */
/* Any signed-in staff member may read the feed; RLS decides which     */
/* rows are visible, so staff without orders.read honestly see none.   */
/* Null means unavailable (same contract as the other reads).          */
/* ------------------------------------------------------------------ */

export interface OrderNotice {
  id: string;
  order_number: number | null;
  customer_name: string;
  status: OrderStatus;
  total_minor: number;
  placed_at: string;
}

const orderNoticeSchema = z.object({
  id: z.uuid(),
  order_number: z.number().int().nullable(),
  customer_name: z.string(),
  status: z.enum(ORDER_STATUSES),
  total_minor: z.number().int(),
  placed_at: z.iso.datetime({ offset: true }),
});

export async function readOrderNotices(limit = 20): Promise<OrderNotice[] | null> {
  const session = await requireStaff();
  const bounded = Math.max(1, Math.min(50, Math.floor(limit) || 20));
  const result = await session.client
    .from("orders")
    .select("id,order_number,customer_name,status,total_minor,placed_at")
    .order("placed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(bounded);
  if (result.error) return null;
  const parsed = orderNoticeSchema.array().safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

/* ------------------------------------------------------------------ */
/* Server Actions (writes go through RPCs only)                        */
/* ------------------------------------------------------------------ */

const transitionSchema = z.object({
  id: z.uuid(),
  expected_updated_at: z.iso.datetime({ offset: true }),
  new_status: z.enum(ORDER_STATUSES),
});

function mapTransitionError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && error.code === "PT409") {
    return "This order changed. Reload to see the latest status before trying again.";
  }
  return toActionError(
    error,
    "Order status could not be changed. Check your access and try again.",
  );
}

export async function transitionOrder(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const parsed = transitionSchema.safeParse({
    id: formData.get("id"),
    expected_updated_at: formData.get("expected_updated_at"),
    new_status: formData.get("new_status"),
  });
  if (!parsed.success) {
    return actionError("Enter a valid order and status. Reload and try again.");
  }
  const session = await requireStaff(areaRoles("orders"));
  const result = await session.client.rpc("admin_transition_order", {
    target_order: parsed.data.id,
    expected_updated_at: parsed.data.expected_updated_at,
    new_status: parsed.data.new_status,
  });
  if (result.error) return actionError(mapTransitionError(result.error));
  revalidatePath("/admin/sales/orders");
  revalidatePath(`/admin/sales/orders/${parsed.data.id}`);
  return actionOk(`Order status changed to ${ORDER_STATUS_LABELS[parsed.data.new_status]}.`);
}

const MAX_BULK = 50;

const paymentStatusSchema = z.object({
  id: z.uuid(),
  expected_updated_at: z.iso.datetime({ offset: true }),
  new_payment_status: z.enum(PAYMENT_STATUSES),
});

function mapPaymentError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && error.code === "PT409") {
    return "This order changed. Reload to see the latest payment status before trying again.";
  }
  return toActionError(
    error,
    "Payment status could not be changed. Check your access and try again.",
  );
}

/**
 * Payment-status update via the admin_set_payment_status RPC. Mirrors
 * transitionOrder: zod-validate → requireStaff(orders) → RPC →
 * revalidatePath → actionOk/actionError, never leaking DB errors. The
 * RPC enforces the legal payment table server-side (unpaid → paid /
 * refunded, paid → refunded, refunded terminal, paid → unpaid
 * forbidden); the UI only offers legal moves as a courtesy.
 */
export async function setPaymentStatus(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const parsed = paymentStatusSchema.safeParse({
    id: formData.get("id"),
    expected_updated_at: formData.get("expected_updated_at"),
    new_payment_status: formData.get("new_payment_status"),
  });
  if (!parsed.success) {
    return actionError("Enter a valid order and payment status. Reload and try again.");
  }
  const session = await requireStaff(areaRoles("orders"));
  const result = await session.client.rpc("admin_set_payment_status", {
    target_order: parsed.data.id,
    expected_updated_at: parsed.data.expected_updated_at,
    new_payment_status: parsed.data.new_payment_status,
  });
  if (result.error) return actionError(mapPaymentError(result.error));
  revalidatePath("/admin/sales/orders");
  revalidatePath(`/admin/sales/orders/${parsed.data.id}`);
  return actionOk(
    `Payment status changed to ${PAYMENT_STATUS_LABELS[parsed.data.new_payment_status]}.`,
  );
}

export async function bulkTransitionOrders(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const newStatus = formData.get("new_status");
  if (!isOrderStatus(newStatus)) {
    return actionError("Choose a valid status for the selected orders.");
  }
  const rawIds = formData.getAll("orderId").map(String);
  const rawExpected = formData.getAll("expected").map(String);
  const pairs: { id: string; expected: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawIds.length; i += 1) {
    const id = rawIds[i];
    const expected = rawExpected[i];
    if (!id || !expected || seen.has(id)) continue;
    seen.add(id);
    pairs.push({ id, expected });
  }
  if (pairs.length === 0) return actionError("Select at least one order.");
  if (pairs.length > MAX_BULK) {
    return actionError(`Select at most ${MAX_BULK} orders at a time.`);
  }
  if (
    !pairs.every(
      (pair) =>
        z.uuid().safeParse(pair.id).success &&
        z.iso.datetime({ offset: true }).safeParse(pair.expected).success,
    )
  ) {
    return actionError("The selected orders could not be verified. Reload and try again.");
  }

  const session = await requireStaff(areaRoles("orders"));
  const current = await session.client
    .from("orders")
    .select("id,order_number,status,updated_at")
    .in("id", pairs.map((pair) => pair.id));
  if (current.error) {
    return actionError("The selected orders could not be read. No changes were made.");
  }
  const currentRow = z.object({
    id: z.uuid(),
    order_number: z.number().int().nullable(),
    status: z.enum(ORDER_STATUSES),
    updated_at: z.iso.datetime({ offset: true }),
  });
  const currentParsed = currentRow.array().safeParse(current.data);
  if (!currentParsed.success) {
    return actionError("The selected orders could not be read. No changes were made.");
  }
  const byId = new Map(currentParsed.data.map((row) => [row.id, row]));
  const label = (id: string): string => {
    const row = byId.get(id);
    return row?.order_number ? formatOrderNumber(row.order_number) : "an order";
  };
  // All-or-nothing pre-check: no writes happen unless EVERY selected order
  // is unchanged and may legally move to the target status.
  const problems: string[] = [];
  for (const pair of pairs) {
    const row = byId.get(pair.id);
    if (!row) {
      problems.push("A selected order no longer exists.");
    } else if (row.updated_at !== pair.expected) {
      problems.push(`Order ${label(pair.id)} changed; reload before updating it.`);
    } else if (row.status !== newStatus && !isLegalTransition(row.status, newStatus)) {
      problems.push(
        `Order ${label(pair.id)} cannot move from ${ORDER_STATUS_LABELS[row.status]} to ${ORDER_STATUS_LABELS[newStatus]}.`,
      );
    }
  }
  if (problems.length > 0) {
    return actionError(`No orders were changed. ${problems.slice(0, 3).join(" ")}`);
  }

  let changed = 0;
  for (const pair of pairs) {
    const result = await session.client.rpc("admin_transition_order", {
      target_order: pair.id,
      expected_updated_at: pair.expected,
      new_status: newStatus,
    });
    if (result.error) {
      return actionError(
        changed === 0
          ? `No orders were changed. ${mapTransitionError(result.error)}`
          : `${changed} of ${pairs.length} orders were changed before an error stopped the update: ${mapTransitionError(result.error)} Reload to see the current statuses.`,
      );
    }
    changed += 1;
  }
  revalidatePath("/admin/sales/orders");
  return actionOk(
    `${changed} order${changed === 1 ? "" : "s"} changed to ${ORDER_STATUS_LABELS[newStatus]}.`,
  );
}

export type OrdersCsvExport =
  | { ok: true; csv: string; filename: string; truncated: boolean; total: number }
  | { ok: false; error: string };

const EXPORT_LIMIT = 1000;

export async function exportOrdersCsv(input: {
  q: string;
  status: string;
  payment: string;
  from: string;
  to: string;
  sort: string;
}): Promise<OrdersCsvExport> {
  "use server";
  const session = await requireStaff(areaRoles("orders"));
  const filters = orderFilters({ ...input, page: "1", pageSize: String(EXPORT_LIMIT) });
  const scope = filters.q ? await searchOrderIds(session.client, filters.q) : null;
  if (filters.q && scope === null) {
    return { ok: false, error: "Orders could not be exported. Try again." };
  }
  if (scope && scope.ids.length === 0) {
    return {
      ok: true,
      csv: ordersToCsv([]),
      filename: "orders.csv",
      truncated: false,
      total: 0,
    };
  }
  const result = await applyOrderQuery(session.client, filters, scope?.ids ?? null, {
    from: 0,
    to: EXPORT_LIMIT - 1,
  });
  if (result.error) {
    return { ok: false, error: "Orders could not be exported. Try again." };
  }
  const parsed = orderRowSchema.array().safeParse(result.data);
  if (!parsed.success) {
    return { ok: false, error: "Orders could not be exported. Try again." };
  }
  const rows = parsed.data;
  const total = result.count ?? rows.length;
  const date = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    csv: ordersToCsv(rows),
    filename: `orders-${date}.csv`,
    truncated: total > rows.length || (scope?.narrowed ?? false),
    total,
  };
}

/* ------------------------------------------------------------------ */
/* 3-hour unverified-order sweep: automatic (pg_cron) + manual run.    */
/*                                                                     */
/* The sweep runs AUTOMATICALLY every 15 minutes via the pg_cron job  */
/* 'attiresarena-unverified-order-sweep' (migration 20261119000200),   */
/* which calls the scheduled wrapper run_unverified_order_sweep_       */
/* scheduled() — the same private.cancel_stale_pending_orders() the    */
/* manual run uses, without a staff JWT (a cron session has none).     */
/* The manual run below remains for an immediate, staff-triggered      */
/* sweep from the All Orders page.                                     */
/* ------------------------------------------------------------------ */

const sweepPreviewSchema = z.object({
  stale: z.number().int().nonnegative(),
  would_cancel: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export type SweepPreview = z.infer<typeof sweepPreviewSchema>;

const sweepResultSchema = z.object({
  cancelled: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export type SweepResult = z.infer<typeof sweepResultSchema>;

/**
 * Dry-run counts for the confirmation dialog: how many stale pending
 * orders exist, how many the sweep would cancel, and how many would be
 * skipped because they already have a courier booking. Writes nothing.
 * Called directly from the client panel (same pattern as exportOrdersCsv).
 */
export async function previewStaleOrderSweep(): Promise<
  | { ok: true; preview: SweepPreview }
  | { ok: false; error: string }
> {
  "use server";
  const session = await requireStaff(areaRoles("orders"));
  const result = await session.client.rpc("admin_preview_unverified_order_sweep");
  if (result.error) {
    return {
      ok: false,
      error: "The unverified-order count could not be read. The database setup for the sweep may not be applied yet.",
    };
  }
  const parsed = sweepPreviewSchema.safeParse(result.data);
  if (!parsed.success) {
    return { ok: false, error: "The unverified-order count could not be read. Try again." };
  }
  return { ok: true, preview: parsed.data };
}

/**
 * Manual sweep run. Returns counts, never throws into the boundary. The
 * RPC cancels stale pending orders (restoring stock) and skips orders
 * with a courier booking; the result message reports both counts.
 */
export async function runStaleOrderSweep(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  // The confirmation dialog posts confirm=1; anything else is refused so
  // the sweep can never run from a stray or forged submission.
  if (formData.get("confirm") !== "1") {
    return actionError("Confirm the review in the dialog before running it.");
  }
  const session = await requireStaff(areaRoles("orders"));
  const result = await session.client.rpc("admin_run_unverified_order_sweep");
  if (result.error) {
    return actionError(
      toActionError(
        result.error,
        "Unverified orders could not be reviewed. No orders were changed. Check your access and try again.",
      ),
    );
  }
  const parsed = sweepResultSchema.safeParse(result.data);
  if (!parsed.success) {
    return actionError("The sweep result could not be read. Reload the orders list to see the current statuses.");
  }
  revalidatePath("/admin/sales/orders");
  const { cancelled, skipped } = parsed.data;
  if (cancelled === 0 && skipped === 0) {
    return actionOk("No unverified orders are older than 3 hours. Nothing was changed.");
  }
  const skippedPart =
    skipped > 0
      ? ` ${skipped} stale order${skipped === 1 ? " was" : "s were"} skipped because ${skipped === 1 ? "it already has" : "they already have"} a courier booking.`
      : "";
  return actionOk(
    `${cancelled} unverified order${cancelled === 1 ? " was" : "s were"} cancelled and restocked.${skippedPart}`,
  );
}
