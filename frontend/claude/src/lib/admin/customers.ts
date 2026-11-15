import "server-only";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, actionOk, actionError, toActionError, type AdminActionResult, type StaffSession } from "./authorization";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, areaRoles } from "./constants";
import { formatDateTime, parsePage, parsePageSize, toCsv } from "./format";
import { escapeLikePattern, orderRowSchema, type OrderRow } from "./orders";

/* ------------------------------------------------------------------ */
/* Pure helpers (covered by tests/sales.check.ts)                      */
/*                                                                     */
/* There is no customers table: customers are derived from orders,     */
/* grouped by phone. Test fixtures are fake rows passed to these       */
/* helpers only; they are never app data.                              */
/* ------------------------------------------------------------------ */

export const BD_PHONE_PATTERN = /^01[3-9][0-9]{8}$/;

export function isValidBdPhone(value: unknown): value is string {
  return typeof value === "string" && BD_PHONE_PATTERN.test(value);
}

export interface CustomerSummary {
  phone: string;
  name: string;
  email: string | null;
  orderCount: number;
  totalSpentMinor: number;
  firstOrderAt: string;
  lastOrderAt: string;
  hasAccount: boolean;
  latestOrderId: string;
}

/**
 * Aggregate order rows into one summary per phone. Name comes from the most
 * recent order; email from the most recent order that recorded one.
 */
export function aggregateCustomers(rows: readonly OrderRow[]): CustomerSummary[] {
  const byPhone = new Map<string, OrderRow[]>();
  for (const row of rows) {
    const group = byPhone.get(row.phone) ?? [];
    group.push(row);
    byPhone.set(row.phone, group);
  }
  const summaries: CustomerSummary[] = [];
  for (const [phone, group] of byPhone) {
    const sorted = [...group].sort((a, b) =>
      a.placed_at === b.placed_at
        ? (a.order_number ?? 0) - (b.order_number ?? 0)
        : a.placed_at < b.placed_at
          ? -1
          : 1,
    );
    const latest = sorted[sorted.length - 1] as OrderRow;
    const first = sorted[0] as OrderRow;
    let email: string | null = null;
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const candidate = sorted[i] as OrderRow;
      if (candidate.email) {
        email = candidate.email;
        break;
      }
    }
    summaries.push({
      phone,
      name: latest.customer_name,
      email,
      orderCount: group.length,
      totalSpentMinor: group.reduce((sum, row) => sum + row.total_minor, 0),
      firstOrderAt: first.placed_at,
      lastOrderAt: latest.placed_at,
      hasAccount: group.some((row) => row.user_id !== null),
      latestOrderId: latest.id,
    });
  }
  return summaries;
}

export type CustomerSort = "spent" | "orders" | "recent";

export function sortCustomerSummaries(
  summaries: readonly CustomerSummary[],
  sort: CustomerSort,
): CustomerSummary[] {
  const sorted = [...summaries];
  if (sort === "orders") {
    sorted.sort((a, b) => b.orderCount - a.orderCount || b.totalSpentMinor - a.totalSpentMinor);
  } else if (sort === "recent") {
    sorted.sort((a, b) => (a.lastOrderAt < b.lastOrderAt ? 1 : a.lastOrderAt > b.lastOrderAt ? -1 : 0));
  } else {
    sorted.sort((a, b) => b.totalSpentMinor - a.totalSpentMinor || b.orderCount - a.orderCount);
  }
  return sorted;
}

export function customersToCsv(
  rows: readonly (CustomerSummary & { blocked: boolean })[],
): string {
  return toCsv(
    ["Phone", "Name", "Email", "Orders", "Total spent (BDT)", "First order (Dhaka)", "Last order (Dhaka)", "Account", "Blocked"],
    rows.map((row) => [
      row.phone,
      row.name,
      row.email ?? "",
      row.orderCount,
      (row.totalSpentMinor / 100).toFixed(2),
      formatDateTime(row.firstOrderAt),
      formatDateTime(row.lastOrderAt),
      row.hasAccount ? "Account" : "Guest",
      row.blocked ? "Yes" : "No",
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* Blocked-customer rows                                               */
/* ------------------------------------------------------------------ */

export const blockedCustomerRowSchema = z.object({
  phone: z.string(),
  reason: z.string(),
  blocked_by: z.uuid().nullable(),
  blocked_at: z.iso.datetime({ offset: true }),
  unblocked_at: z.iso.datetime({ offset: true }).nullable(),
  unblocked_by: z.uuid().nullable(),
  note: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export type BlockedCustomerRow = z.infer<typeof blockedCustomerRowSchema>;

export function isCurrentlyBlocked(row: BlockedCustomerRow | null | undefined): boolean {
  return row !== null && row !== undefined && row.unblocked_at === null;
}

type StaffClient = StaffSession["client"];

const ORDER_COLUMNS =
  "id,order_number,user_id,customer_name,phone,email,division,district,area,address_line,note,payment_method,payment_status,status,subtotal_minor,delivery_charge_minor,discount_minor,total_minor,placed_at,created_at,updated_at";
const BLOCKED_COLUMNS =
  "phone,reason,blocked_by,blocked_at,unblocked_at,unblocked_by,note,created_at,updated_at";

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export interface CustomerFilters {
  q: string;
  sort: CustomerSort;
  page: number;
  pageSize: number;
}

export function customerFilters(
  params: Record<string, string | string[] | undefined>,
): CustomerFilters {
  const text = (key: string): string =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const sort = text("sort");
  return {
    q: text("q").trim().slice(0, 120),
    sort: sort === "orders" || sort === "recent" ? sort : "spent",
    page: parsePage(text("page")),
    pageSize: parsePageSize(text("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/*                                                                     */
/* PostgREST has no GROUP BY, so aggregation runs over a bounded read  */
/* of order rows (most recent first) and is paginated in memory. When  */
/* the bound is hit the UI says so honestly instead of presenting      */
/* partial totals as complete.                                         */
/* ------------------------------------------------------------------ */

const AGGREGATION_LIMIT = 5000;
const SEARCH_LIMIT = 100;
const SEARCH_CAP = 150;

async function searchOrderIdsForCustomers(
  client: StaffClient,
  q: string,
): Promise<{ ids: string[]; narrowed: boolean } | null> {
  const pattern = escapeLikePattern(q);
  const [byName, byPhone, byEmail] = await Promise.all([
    client.from("orders").select("id").ilike("customer_name", pattern).limit(SEARCH_LIMIT),
    client.from("orders").select("id").ilike("phone", pattern).limit(SEARCH_LIMIT),
    client.from("orders").select("id").ilike("email", pattern).limit(SEARCH_LIMIT),
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

export interface CustomerListEntry extends CustomerSummary {
  blocked: boolean;
}

/**
 * Reads return null when the live data is UNAVAILABLE (missing table/RPC,
 * failed query, or malformed rows) so pages can degrade honestly with
 * labeled sample data instead of throwing into the error boundary.
 * notFound() is kept for invalid phones and phones with no orders.
 */
export async function readCustomers(params: Record<string, string | string[] | undefined>) {
  const session = await requireStaff(areaRoles("customers"));
  const filters = customerFilters(params);
  const scope = filters.q ? await searchOrderIdsForCustomers(session.client, filters.q) : null;
  if (filters.q && scope === null) return null;
  if (scope && scope.ids.length === 0) {
    return {
      customers: [] as CustomerListEntry[],
      totalCustomers: 0,
      filters,
      truncated: false,
      narrowed: scope.narrowed,
    };
  }
  let query = session.client
    .from("orders")
    .select(ORDER_COLUMNS)
    .order("placed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AGGREGATION_LIMIT);
  if (scope) query = query.in("id", scope.ids);
  const result = await query;
  if (result.error) return null;
  const rowsParsed = orderRowSchema.array().safeParse(result.data);
  if (!rowsParsed.success) return null;
  const rows = rowsParsed.data;
  const truncated = !scope && rows.length >= AGGREGATION_LIMIT;
  const summaries = sortCustomerSummaries(aggregateCustomers(rows), filters.sort);

  const pageRows = summaries.slice(
    (filters.page - 1) * filters.pageSize,
    filters.page * filters.pageSize,
  );
  const blocked = new Set<string>();
  if (pageRows.length > 0) {
    const blockedResult = await session.client
      .from("blocked_customers")
      .select("phone")
      .in("phone", pageRows.map((row) => row.phone))
      .is("unblocked_at", null);
    if (!blockedResult.error && Array.isArray(blockedResult.data)) {
      for (const row of blockedResult.data) {
        const parsed = z.object({ phone: z.string() }).safeParse(row);
        if (parsed.success) blocked.add(parsed.data.phone);
      }
    }
  }
  return {
    customers: pageRows.map((row) => ({ ...row, blocked: blocked.has(row.phone) })),
    totalCustomers: summaries.length,
    filters,
    truncated,
    narrowed: scope?.narrowed ?? false,
  };
}

export async function readCustomerProfile(rawPhone: string) {
  const session = await requireStaff(areaRoles("customers"));
  // The route param arrives URL-decoded; validate the strict order-phone
  // form server-side regardless of what the link contained.
  const phone = rawPhone.trim();
  if (!isValidBdPhone(phone)) notFound();

  const ordersResult = await session.client
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("phone", phone)
    .order("placed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(201);
  if (ordersResult.error) return null;
  const allOrdersParsed = orderRowSchema.array().safeParse(ordersResult.data);
  if (!allOrdersParsed.success) return null;
  const allOrders = allOrdersParsed.data;
  if (allOrders.length === 0) notFound();
  const orders = allOrders.slice(0, 200);
  // Totals are computed from the same orders shown below, so they always
  // match the visible history; the truncation flag says when older orders
  // exist beyond this page.
  const summary = aggregateCustomers(orders)[0] as CustomerSummary;

  const blockedResult = await session.client
    .from("blocked_customers")
    .select(BLOCKED_COLUMNS)
    .eq("phone", phone)
    .maybeSingle();
  if (blockedResult.error) return null;
  let blockedRow: BlockedCustomerRow | null = null;
  if (blockedResult.data) {
    const blockedParsed = blockedCustomerRowSchema.safeParse(blockedResult.data);
    if (!blockedParsed.success) return null;
    blockedRow = blockedParsed.data;
  }

  return {
    phone,
    summary,
    orders,
    ordersTruncated: allOrders.length > 200,
    blockedRow,
    blocked: isCurrentlyBlocked(blockedRow),
    canManageBlock: session.roles.some((role) => role === "owner" || role === "order_manager"),
  };
}

/* ------------------------------------------------------------------ */
/* Server Actions: block / unblock go through RPCs only                */
/* ------------------------------------------------------------------ */

const blockSchema = z.object({
  phone: z.string().regex(BD_PHONE_PATTERN),
  reason: z.string().trim().min(3).max(500),
});

export async function blockCustomer(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const parsed = blockSchema.safeParse({
    phone: formData.get("phone"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return actionError("Enter a valid phone number and a reason of 3 to 500 characters.");
  }
  const session = await requireStaff(areaRoles("orders"));
  const result = await session.client.rpc("admin_block_customer", {
    p_phone: parsed.data.phone,
    p_reason: parsed.data.reason,
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Customer could not be blocked. Check your access and try again."),
    );
  }
  revalidatePath("/admin/sales/customers");
  revalidatePath(`/admin/sales/customers/${encodeURIComponent(parsed.data.phone)}`);
  return actionOk(
    "Customer blocked (admin record only — checkout does not check this yet).",
  );
}

const unblockSchema = z.object({
  phone: z.string().regex(BD_PHONE_PATTERN),
  note: z.string().trim().max(500),
});

export async function unblockCustomer(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const parsed = unblockSchema.safeParse({
    phone: formData.get("phone"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return actionError("Enter a valid phone number and a note of up to 500 characters.");
  }
  const session = await requireStaff(areaRoles("orders"));
  const result = await session.client.rpc("admin_unblock_customer", {
    p_phone: parsed.data.phone,
    p_note: parsed.data.note === "" ? null : parsed.data.note,
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Customer could not be unblocked. Check your access and try again."),
    );
  }
  revalidatePath("/admin/sales/customers");
  revalidatePath(`/admin/sales/customers/${encodeURIComponent(parsed.data.phone)}`);
  return actionOk("Customer unblocked.");
}

export type CustomersCsvExport =
  | { ok: true; csv: string; filename: string; truncated: boolean; total: number }
  | { ok: false; error: string };

export async function exportCustomersCsv(input: { q: string; sort: string }): Promise<CustomersCsvExport> {
  "use server";
  const session = await requireStaff(areaRoles("customers"));
  const filters = customerFilters({ ...input, page: "1", pageSize: String(MAX_PAGE_SIZE) });
  const scope = filters.q ? await searchOrderIdsForCustomers(session.client, filters.q) : null;
  if (filters.q && scope === null) {
    return { ok: false, error: "Customers could not be exported. Try again." };
  }
  if (scope && scope.ids.length === 0) {
    return { ok: true, csv: customersToCsv([]), filename: "customers.csv", truncated: false, total: 0 };
  }
  let query = session.client
    .from("orders")
    .select(ORDER_COLUMNS)
    .order("placed_at", { ascending: false })
    .limit(AGGREGATION_LIMIT);
  if (scope) query = query.in("id", scope.ids);
  const result = await query;
  if (result.error) {
    return { ok: false, error: "Customers could not be exported. Try again." };
  }
  const rowsParsed = orderRowSchema.array().safeParse(result.data);
  if (!rowsParsed.success) {
    return { ok: false, error: "Customers could not be exported. Try again." };
  }
  const rows = rowsParsed.data;
  const summaries = sortCustomerSummaries(aggregateCustomers(rows), filters.sort);
  const blockedResult = await session.client
    .from("blocked_customers")
    .select("phone")
    .is("unblocked_at", null);
  const blocked = new Set<string>();
  if (!blockedResult.error && Array.isArray(blockedResult.data)) {
    for (const row of blockedResult.data) {
      const parsed = z.object({ phone: z.string() }).safeParse(row);
      if (parsed.success) blocked.add(parsed.data.phone);
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    csv: customersToCsv(summaries.map((row) => ({ ...row, blocked: blocked.has(row.phone) }))),
    filename: `customers-${date}.csv`,
    truncated: !scope && rows.length >= AGGREGATION_LIMIT,
    total: summaries.length,
  };
}
