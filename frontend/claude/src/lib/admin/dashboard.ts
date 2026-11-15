import "server-only";
import { z } from "zod";
import type { adminClient } from "./supabase";
import {
  ORDER_STATUSES,
  PRODUCT_MEDIA_BUCKET,
  type OrderStatus,
} from "./constants";
import { percentChange, toDhakaDateKey, type DateRange } from "./format";

/**
 * Dashboard data for /admin.
 *
 * Every query runs through the staff session client, so Row Level Security
 * applies: a role only sees the rows its permissions allow (for example a
 * product_manager has no orders.read permission and therefore sees zero
 * orders here). Numbers are never invented: empty tables produce honest
 * zeroes and empty states, and a failed section is reported in
 * `failedSections` instead of crashing the page.
 *
 * Revenue definition (documented wherever revenue is shown): the sum of
 * `orders.total_minor` for orders whose status is not cancelled or returned.
 * Totals include delivery charges and are net of discounts, as stored.
 * "Processing" is not a database status and is never shown; only the 8
 * values in ORDER_STATUSES are used.
 *
 * All date windows are Asia/Dhaka calendar days. `placed_at` is bucketed by
 * its Dhaka date, and range filters use the fixed +06:00 offset (Bangladesh
 * has no daylight saving time).
 */

export type DashboardClient = Awaited<ReturnType<typeof adminClient>>;

export type RevenueGranularity = "day" | "week" | "month";

export const revenueGranularitySchema = z.enum(["day", "week", "month"]);

/** Statuses excluded from revenue. Cancelled and returned orders earn nothing. */
export const REVENUE_EXCLUDED_STATUSES: readonly OrderStatus[] = [
  "cancelled",
  "returned",
];

/**
 * Set lookups for the per-row hot paths (countByStatus, sumRevenue,
 * bucketRevenue, best-seller filtering). The arrays above stay the
 * canonical ordered definitions; these sets only avoid a linear scan
 * per row.
 */
const REVENUE_EXCLUDED_SET: ReadonlySet<string> = new Set(
  REVENUE_EXCLUDED_STATUSES,
);
const ORDER_STATUS_SET: ReadonlySet<string> = new Set(ORDER_STATUSES);

/** Shared label formatters: constructing one per bucket was pure waste. */
const DAY_KEY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const MONTH_KEY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAY_KEY = "9999-12-31";

/** Add (or subtract) whole days to a YYYY-MM-DD key using UTC math. */
export function addDaysToKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return key;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Inclusive number of days in a range; at least 1. */
export function rangeSpanDays(range: DateRange): number {
  const span =
    (Date.parse(`${range.to}T00:00:00Z`) -
      Date.parse(`${range.from}T00:00:00Z`)) /
    DAY_MS;
  if (!Number.isFinite(span) || span < 0) return 1;
  return Math.floor(span) + 1;
}

/**
 * The same-length window immediately before `range`: it ends the day before
 * `range.from` and has exactly the same number of days.
 */
export function previousPeriodRange(range: DateRange): DateRange {
  const span = rangeSpanDays(range);
  const to = addDaysToKey(range.from, -1);
  const from = addDaysToKey(to, -(span - 1));
  return { from, to };
}

/**
 * Resolve the chart granularity: an explicit request wins, otherwise the
 * span decides (up to 31 days: daily; up to 120 days: weekly; else monthly).
 */
export function resolveGranularity(
  range: DateRange,
  requested?: RevenueGranularity,
): RevenueGranularity {
  if (requested) return requested;
  const span = rangeSpanDays(range);
  if (span <= 31) return "day";
  if (span <= 120) return "week";
  return "month";
}

/**
 * Exclusive [start, end) filter bounds for a Dhaka-date range, as ISO
 * timestamps with the fixed +06:00 offset.
 */
export function rangeBounds(range: DateRange): {
  startIso: string;
  endIsoExclusive: string;
} {
  return {
    startIso: `${range.from}T00:00:00+06:00`,
    endIsoExclusive: `${addDaysToKey(range.to, 1)}T00:00:00+06:00`,
  };
}

/** Dhaka calendar key (YYYY-MM-DD) for a stored timestamp, or null. */
export function dhakaKeyFor(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return toDhakaDateKey(date);
}

/**
 * Bucket key for a timestamp: the Dhaka date (day), the Monday of its week
 * (week), or YYYY-MM (month). Null when the timestamp is invalid.
 */
export function bucketKeyFor(
  iso: string,
  granularity: RevenueGranularity,
): string | null {
  const key = dhakaKeyFor(iso);
  if (!key) return null;
  if (granularity === "day") return key;
  if (granularity === "month") return key.slice(0, 7);
  const date = new Date(`${key}T00:00:00Z`);
  const weekday = date.getUTCDay(); // 0 = Sunday
  const backToMonday = (weekday + 6) % 7;
  date.setUTCDate(date.getUTCDate() - backToMonday);
  return date.toISOString().slice(0, 10);
}

function formatDayKey(key: string): string {
  return DAY_KEY_FORMAT.format(new Date(`${key}T00:00:00Z`));
}

/** Human label for a bucket key: "12 Nov", "Week of 10 Nov", "Nov 2026". */
export function bucketLabel(
  key: string,
  granularity: RevenueGranularity,
): string {
  if (granularity === "month") {
    return MONTH_KEY_FORMAT.format(new Date(`${key}-01T00:00:00Z`));
  }
  if (granularity === "week") return `Week of ${formatDayKey(key)}`;
  return formatDayKey(key);
}

/** Every bucket key in a range, in order, including buckets with no rows. */
export function bucketKeysInRange(
  range: DateRange,
  granularity: RevenueGranularity,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  let cursor = range.from;
  // Ranges are clamped to 366 days by parseDateRange; guard anyway.
  for (let step = 0; step <= 370 && cursor <= range.to && cursor <= MAX_DAY_KEY; step += 1) {
    const key = bucketKeyFor(`${cursor}T12:00:00+06:00`, granularity);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    cursor = addDaysToKey(cursor, 1);
  }
  return keys;
}

export interface RevenueRow {
  placed_at: string;
  total_minor: number;
  status: string;
}

export interface RevenueBucket {
  key: string;
  label: string;
  revenueMinor: number;
  orderCount: number;
}

/**
 * Bucket rows into the full bucket sequence for `range`. `orderCount`
 * counts every order placed in the bucket; `revenueMinor` excludes
 * cancelled and returned orders. Rows with invalid timestamps are skipped.
 */
export function bucketRevenue(
  rows: readonly RevenueRow[],
  granularity: RevenueGranularity,
  range: DateRange,
): RevenueBucket[] {
  const buckets = new Map<string, RevenueBucket>();
  for (const key of bucketKeysInRange(range, granularity)) {
    buckets.set(key, {
      key,
      label: bucketLabel(key, granularity),
      revenueMinor: 0,
      orderCount: 0,
    });
  }
  for (const row of rows) {
    const key = bucketKeyFor(row.placed_at, granularity);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.orderCount += 1;
    if (!REVENUE_EXCLUDED_SET.has(row.status)) {
      bucket.revenueMinor += row.total_minor;
    }
  }
  return [...buckets.values()];
}

/**
 * Pair current buckets with previous-period buckets by position (the two
 * windows have the same length, so positions line up). The shorter series
 * is padded with zeroes. Labels come from the current buckets.
 */
export function withComparisonSeries(
  current: readonly RevenueBucket[],
  previous: readonly RevenueBucket[],
): { label: string; value: number; compareValue: number }[] {
  return current.map((bucket, index) => ({
    label: bucket.label,
    value: bucket.revenueMinor,
    compareValue: previous[index]?.revenueMinor ?? 0,
  }));
}

/** Count rows per order status; unknown statuses are ignored. */
export function countByStatus(
  rows: readonly { status: string }[],
): Record<OrderStatus, number> {
  const counts = Object.fromEntries(
    ORDER_STATUSES.map((status) => [status, 0]),
  ) as Record<OrderStatus, number>;
  for (const row of rows) {
    if (ORDER_STATUS_SET.has(row.status)) {
      counts[row.status as OrderStatus] += 1;
    }
  }
  return counts;
}

/** Revenue over rows: total_minor excluding cancelled and returned orders. */
export function sumRevenue(rows: readonly RevenueRow[]): number {
  let total = 0;
  for (const row of rows) {
    if (!REVENUE_EXCLUDED_SET.has(row.status)) {
      total += row.total_minor;
    }
  }
  return total;
}

/** Distinct customers, identified by phone number (the orders table has no customer table). */
export function countDistinctPhones(
  rows: readonly { phone: string }[],
): number {
  const phones = new Set<string>();
  for (const row of rows) {
    const phone = row.phone.trim();
    if (phone) phones.add(phone);
  }
  return phones.size;
}

/**
 * Percent change of `current` against `previous`. Null when the previous
 * value is 0 (no meaningful percentage exists) — callers render "—".
 */
export function periodDelta(current: number, previous: number): number | null {
  return percentChange(current, previous);
}

export interface BestSellerItemRow {
  product_id: string;
  product_name: string;
  quantity: number;
  line_total_minor: number;
}

export interface BestSellerAggregate {
  productId: string;
  productName: string;
  units: number;
  revenueMinor: number;
}

/** Group order items by product, sorted by revenue, then units, then name. */
export function aggregateBestSellers(
  items: readonly BestSellerItemRow[],
): BestSellerAggregate[] {
  const byProduct = new Map<string, BestSellerAggregate>();
  for (const item of items) {
    const existing = byProduct.get(item.product_id);
    if (existing) {
      existing.units += item.quantity;
      existing.revenueMinor += item.line_total_minor;
    } else {
      byProduct.set(item.product_id, {
        productId: item.product_id,
        productName: item.product_name,
        units: item.quantity,
        revenueMinor: item.line_total_minor,
      });
    }
  }
  return [...byProduct.values()].sort(
    (a, b) =>
      b.revenueMinor - a.revenueMinor ||
      b.units - a.units ||
      a.productName.localeCompare(b.productName),
  );
}

export interface LowStockRow {
  variantId: string;
  productId: string;
  productName: string;
  size: string;
  color: string;
  available: number;
  lowStockThreshold: number;
}

/** Rows at or below their low-stock threshold, lowest stock first, capped. */
export function selectLowStock(
  rows: readonly LowStockRow[],
  limit: number,
): LowStockRow[] {
  return rows
    .filter((row) => row.available <= row.lowStockThreshold)
    .sort((a, b) => a.available - b.available)
    .slice(0, limit);
}

export interface RevenueSummary {
  totalMinor: number;
  /** Highest-revenue bucket (first one wins a tie), or null when empty. */
  peak: RevenueBucket | null;
  /** Mean revenue per bucket; 0 when there are no buckets. */
  averageMinor: number;
  bucketCount: number;
}

/**
 * Totals for the visible summary next to the revenue chart. Single pass;
 * the chart itself stays the visual, this is the adjacent text summary
 * screen-reader and skim readers use.
 */
export function summarizeRevenue(
  buckets: readonly RevenueBucket[],
): RevenueSummary {
  let total = 0;
  let peak: RevenueBucket | null = null;
  for (const bucket of buckets) {
    total += bucket.revenueMinor;
    if (!peak || bucket.revenueMinor > peak.revenueMinor) peak = bucket;
  }
  return {
    totalMinor: total,
    peak,
    averageMinor: buckets.length > 0 ? total / buckets.length : 0,
    bucketCount: buckets.length,
  };
}

export interface CoverMediaRow {
  product_id: string;
  storage_path: string;
  alt_text: string;
}

/**
 * First media row per product. `rows` must arrive ordered by position
 * ascending (the batched query orders them), so the first row seen for a
 * product is its cover image — the same row the old per-product
 * limit(1) queries returned, without one query per product.
 */
export function selectFirstMediaByProduct(
  rows: readonly CoverMediaRow[],
): Map<string, CoverMediaRow> {
  const first = new Map<string, CoverMediaRow>();
  for (const row of rows) {
    if (!first.has(row.product_id)) first.set(row.product_id, row);
  }
  return first;
}

// --- Row schemas: PostgREST rows are untrusted input, parsed with Zod. ---

const orderRowSchema = z.object({
  id: z.uuid(),
  order_number: z.number().int().nullable(),
  customer_name: z.string(),
  phone: z.string(),
  payment_method: z.string(),
  payment_status: z.string(),
  status: z.string(),
  total_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  placed_at: z.iso.datetime({ offset: true }),
});

export type DashboardOrderRow = z.infer<typeof orderRowSchema>;

const orderItemRowSchema = z.object({
  product_id: z.uuid(),
  product_name: z.string(),
  quantity: z.number().int().positive(),
  line_total_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  orders: z
    .union([
      z.object({
        placed_at: z.iso.datetime({ offset: true }),
        status: z.string(),
      }),
      z
        .array(
          z.object({
            placed_at: z.iso.datetime({ offset: true }),
            status: z.string(),
          }),
        )
        .max(1),
    ])
    .nullable()
    .optional()
    .transform((value) =>
      Array.isArray(value) ? (value[0] ?? null) : (value ?? null),
    ),
});

const inventoryRowSchema = z.object({
  variant_id: z.uuid(),
  available: z.number().int().nonnegative(),
  low_stock_threshold: z.number().int().nonnegative(),
  product_variants: z
    .union([
      z.object({
        size: z.string(),
        color: z.string(),
        product_id: z.uuid(),
        products: z
          .union([
            z.object({ name: z.string() }),
            z.array(z.object({ name: z.string() })).max(1),
          ])
          .nullable()
          .optional()
          .transform((value) =>
            Array.isArray(value) ? (value[0] ?? null) : (value ?? null),
          ),
      }),
      z
        .array(
          z.object({
            size: z.string(),
            color: z.string(),
            product_id: z.uuid(),
            products: z
              .union([
                z.object({ name: z.string() }),
                z.array(z.object({ name: z.string() })).max(1),
              ])
              .nullable()
              .optional()
              .transform((value) =>
                Array.isArray(value) ? (value[0] ?? null) : (value ?? null),
              ),
          }),
        )
        .max(1),
    ])
    .nullable()
    .optional()
    .transform((value) =>
      Array.isArray(value) ? (value[0] ?? null) : (value ?? null),
    ),
});

const abandonedSessionRowSchema = z.object({
  id: z.uuid(),
  checkout_items: z.array(z.object({ id: z.uuid() })).optional().default([]),
});

const mediaRowSchema = z.object({
  product_id: z.uuid(),
  storage_path: z.string(),
  alt_text: z.string(),
});

/** Parse rows individually; invalid rows are dropped rather than failing the page. */
function parseRows<T extends z.ZodType>(
  schema: T,
  data: unknown,
): z.infer<T>[] {
  if (!Array.isArray(data)) return [];
  const rows: z.infer<T>[] = [];
  for (const row of data) {
    const parsed = schema.safeParse(row);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

export interface BestSeller extends BestSellerAggregate {
  imageUrl: string | null;
  imageAlt: string;
}

export interface DashboardData {
  range: DateRange;
  previousRange: DateRange;
  granularity: RevenueGranularity;
  totalProducts: number;
  productsCreatedCurrent: number;
  productsCreatedPrevious: number;
  orderCount: number;
  orderCountPrevious: number;
  revenueMinor: number;
  revenueMinorPrevious: number;
  customerCount: number;
  customerCountPrevious: number;
  statusCounts: Record<OrderStatus, number>;
  statusCountsPrevious: Record<OrderStatus, number>;
  revenueBuckets: RevenueBucket[];
  revenueBucketsPrevious: RevenueBucket[];
  bestSellers: BestSeller[];
  recentOrders: DashboardOrderRow[];
  lowStock: LowStockRow[];
  incompleteCount: number;
  incompleteTruncated: boolean;
  ordersTruncated: boolean;
  /** Human labels of sections whose query failed; the page warns about them. */
  failedSections: string[];
}

export type DashboardLoadResult =
  | { ok: true; data: DashboardData }
  | { ok: false; reason: "unavailable"; message: string };

/** Bounds keep dashboard queries finite on a growing store. */
const ORDERS_QUERY_LIMIT = 5000;
const ORDER_ITEMS_QUERY_LIMIT = 1000;
const INVENTORY_QUERY_LIMIT = 100;
const ABANDONED_QUERY_LIMIT = 500;

const ORDER_COLUMNS =
  "id,order_number,customer_name,phone,payment_method,payment_status,status,total_minor,placed_at";

/**
 * Load every dashboard section. Individual query failures degrade only
 * their own section (recorded in `failedSections`); an unexpected failure
 * returns the typed unavailable state instead of throwing.
 */
export async function loadDashboard(
  client: DashboardClient,
  range: DateRange,
  granularity: RevenueGranularity,
): Promise<DashboardLoadResult> {
  const failedSections: string[] = [];
  try {
    const previousRange = previousPeriodRange(range);
    const currentBounds = rangeBounds(range);
    const previousBounds = rangeBounds(previousRange);

    async function attempt<T>(
      label: string,
      query: () => Promise<T>,
      fallback: T,
    ): Promise<T> {
      try {
        return await query();
      } catch {
        failedSections.push(label);
        return fallback;
      }
    }

    const [
      totalProducts,
      productsCreatedCurrent,
      productsCreatedPrevious,
      currentOrders,
      previousOrders,
      recentOrders,
      orderItems,
      inventoryRows,
      abandonedSessions,
    ] = await Promise.all([
      attempt("Products", async () => {
        const result = await client
          .from("products")
          .select("id", { count: "exact", head: true });
        if (result.error) throw result.error;
        return result.count ?? 0;
      }, 0),
      attempt("Products", async () => {
        const result = await client
          .from("products")
          .select("id", { count: "exact", head: true })
          .gte("created_at", currentBounds.startIso)
          .lt("created_at", currentBounds.endIsoExclusive);
        if (result.error) throw result.error;
        return result.count ?? 0;
      }, 0),
      attempt("Products", async () => {
        const result = await client
          .from("products")
          .select("id", { count: "exact", head: true })
          .gte("created_at", previousBounds.startIso)
          .lt("created_at", previousBounds.endIsoExclusive);
        if (result.error) throw result.error;
        return result.count ?? 0;
      }, 0),
      attempt("Orders", async () => {
        const result = await client
          .from("orders")
          .select(ORDER_COLUMNS)
          .gte("placed_at", currentBounds.startIso)
          .lt("placed_at", currentBounds.endIsoExclusive)
          .order("placed_at", { ascending: false })
          .limit(ORDERS_QUERY_LIMIT);
        if (result.error) throw result.error;
        return parseRows(orderRowSchema, result.data);
      }, [] as DashboardOrderRow[]),
      attempt("Orders", async () => {
        const result = await client
          .from("orders")
          .select(ORDER_COLUMNS)
          .gte("placed_at", previousBounds.startIso)
          .lt("placed_at", previousBounds.endIsoExclusive)
          .order("placed_at", { ascending: false })
          .limit(ORDERS_QUERY_LIMIT);
        if (result.error) throw result.error;
        return parseRows(orderRowSchema, result.data);
      }, [] as DashboardOrderRow[]),
      attempt("Recent orders", async () => {
        const result = await client
          .from("orders")
          .select(ORDER_COLUMNS)
          .order("placed_at", { ascending: false })
          .limit(8);
        if (result.error) throw result.error;
        return parseRows(orderRowSchema, result.data);
      }, [] as DashboardOrderRow[]),
      attempt("Best sellers", async () => {
        const result = await client
          .from("order_items")
          .select(
            "product_id,product_name,quantity,line_total_minor,orders!inner(placed_at,status)",
          )
          .order("created_at", { ascending: false })
          .limit(ORDER_ITEMS_QUERY_LIMIT);
        if (result.error) throw result.error;
        const rows = parseRows(orderItemRowSchema, result.data);
        const windowStart = Date.parse(currentBounds.startIso);
        const windowEnd = Date.parse(currentBounds.endIsoExclusive);
        return rows.filter((row) => {
          const order = row.orders;
          if (!order) return false;
          if (REVENUE_EXCLUDED_SET.has(order.status)) {
            return false;
          }
          // Compare instants, not strings: stored offsets vary.
          const placed = Date.parse(order.placed_at);
          return placed >= windowStart && placed < windowEnd;
        });
      }, [] as z.infer<typeof orderItemRowSchema>[]),
      attempt("Low stock", async () => {
        const result = await client
          .from("inventory")
          .select(
            "variant_id,available,low_stock_threshold,product_variants(size,color,product_id,products(name))",
          )
          .order("available", { ascending: true })
          .limit(INVENTORY_QUERY_LIMIT);
        if (result.error) throw result.error;
        const rows = parseRows(inventoryRowSchema, result.data);
        const mapped: LowStockRow[] = [];
        for (const row of rows) {
          const variant = row.product_variants;
          if (!variant) continue;
          mapped.push({
            variantId: row.variant_id,
            productId: variant.product_id,
            productName: variant.products?.name ?? "Unnamed product",
            size: variant.size,
            color: variant.color,
            available: row.available,
            lowStockThreshold: row.low_stock_threshold,
          });
        }
        return selectLowStock(mapped, 8);
      }, [] as LowStockRow[]),
      attempt("Incomplete orders", async () => {
        const result = await client
          .from("checkout_sessions")
          .select("id,checkout_items(id)")
          .eq("lifecycle_status", "abandoned")
          .limit(ABANDONED_QUERY_LIMIT)
          .limit(1, { referencedTable: "checkout_items" });
        if (result.error) throw result.error;
        const rows = parseRows(abandonedSessionRowSchema, result.data);
        return {
          count: rows.filter((row) => row.checkout_items.length > 0).length,
          truncated: rows.length >= ABANDONED_QUERY_LIMIT,
        };
      }, { count: 0, truncated: false }),
    ]);

    // Cover images for best sellers: short-lived signed URLs from the
    // private gallery bucket, exactly like the product library. One
    // batched media query for all best sellers (ordered by position, so
    // the first row per product is its cover), then signed URLs in
    // parallel. A missing image stays missing — no placeholder artwork
    // is ever invented. If the batched query fails, every best seller
    // renders without an image rather than failing the section: the
    // query either works for the whole table or not at all, so
    // per-product retries would buy nothing.
    const aggregates = aggregateBestSellers(orderItems).slice(0, 5);
    let covers = new Map<string, CoverMediaRow>();
    if (aggregates.length > 0) {
      try {
        const media = await client
          .from("product_media")
          .select("product_id,storage_path,alt_text")
          .in(
            "product_id",
            aggregates.map((aggregate) => aggregate.productId),
          )
          .order("position", { ascending: true })
          .limit(200);
        if (!media.error) {
          covers = selectFirstMediaByProduct(
            parseRows(mediaRowSchema, media.data),
          );
        }
      } catch {
        covers = new Map();
      }
    }
    const bestSellers: BestSeller[] = await Promise.all(
      aggregates.map(async (aggregate) => {
        let imageUrl: string | null = null;
        let imageAlt = aggregate.productName;
        const cover = covers.get(aggregate.productId);
        if (cover) {
          imageAlt = cover.alt_text || aggregate.productName;
          try {
            const signed = await client.storage
              .from(PRODUCT_MEDIA_BUCKET)
              .createSignedUrl(cover.storage_path, 120);
            if (!signed.error) imageUrl = signed.data.signedUrl;
          } catch {
            imageUrl = null;
          }
        }
        return { ...aggregate, imageUrl, imageAlt };
      }),
    );

    return {
      ok: true,
      data: {
        range,
        previousRange,
        granularity,
        totalProducts,
        productsCreatedCurrent,
        productsCreatedPrevious,
        orderCount: currentOrders.length,
        orderCountPrevious: previousOrders.length,
        revenueMinor: sumRevenue(currentOrders),
        revenueMinorPrevious: sumRevenue(previousOrders),
        customerCount: countDistinctPhones(currentOrders),
        customerCountPrevious: countDistinctPhones(previousOrders),
        statusCounts: countByStatus(currentOrders),
        statusCountsPrevious: countByStatus(previousOrders),
        revenueBuckets: bucketRevenue(currentOrders, granularity, range),
        revenueBucketsPrevious: bucketRevenue(
          previousOrders,
          granularity,
          previousRange,
        ),
        bestSellers,
        recentOrders,
        lowStock: inventoryRows,
        incompleteCount: abandonedSessions.count,
        incompleteTruncated: abandonedSessions.truncated,
        ordersTruncated:
          currentOrders.length >= ORDERS_QUERY_LIMIT ||
          previousOrders.length >= ORDERS_QUERY_LIMIT,
        failedSections: [...new Set(failedSections)],
      },
    };
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "Dashboard data could not be loaded.",
    };
  }
}
