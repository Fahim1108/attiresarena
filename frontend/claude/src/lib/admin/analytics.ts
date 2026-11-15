import "server-only";

import { requireStaff } from "./authorization";
import { areaRoles } from "./constants";
import {
  parseDateRange,
  toCsv,
  toDhakaDateKey,
  type DateRange,
} from "./format";

/**
 * Analytics reports from real queries only. Every section degrades to an
 * honest unavailable/empty state when its source table, column or
 * permission is missing — nothing is estimated or filled with sample data.
 *
 * Definitions (also shown in the UI):
 * - Gross sales: sum of total_minor over orders in range, excluding
 *   cancelled and returned orders.
 * - Net revenue: sum of (subtotal_minor - discount_minor) over the same
 *   orders — merchandise revenue excluding delivery charges.
 * - Profit: sum of (unit_price_minor - cost_price_minor) * quantity over
 *   delivered orders, computed ONLY for items whose variant records a
 *   cost price. When no cost data exists, profit is unavailable and is
 *   never estimated.
 */

const EXCLUDED_STATUSES = new Set(["cancelled", "returned"]);

interface OrderRow {
  id: string;
  status: string;
  subtotal_minor: number;
  discount_minor: number;
  total_minor: number;
  phone: string;
  placed_at: string;
}

interface OrderItemRow {
  order_id: string;
  product_id: string;
  variant_id: string;
  product_name: string;
  unit_price_minor: number;
  quantity: number;
  line_total_minor: number;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dayAfter(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function eachDay(range: DateRange): string[] {
  const days: string[] = [];
  let current = range.from;
  while (current <= range.to && days.length <= 366) {
    days.push(current);
    current = dayAfter(current);
  }
  return days;
}

export interface DailyPoint {
  label: string;
  value: number;
}

export interface AnalyticsReport {
  range: DateRange;
  ordersAvailable: boolean;
  grossSalesMinor: number;
  netRevenueMinor: number;
  totalOrders: number;
  averageOrderMinor: number;
  dailySeries: DailyPoint[];
  statusDistribution: { label: string; value: number }[];
  bestSellers: { productName: string; quantity: number; revenueMinor: number }[];
  salesByCategory: { category: string; revenueMinor: number }[];
  couponPerformance: { code: string; redemptions: number }[] | null;
  inventory: {
    totalVariants: number;
    inStock: number;
    outOfStock: number;
    lowStock: number;
  } | null;
  customerTrends: { newCustomers: number; returningCustomers: number } | null;
  profit: {
    profitMinor: number;
    revenueMinor: number;
    costMinor: number;
    itemsWithCost: number;
    deliveredItems: number;
  } | null;
  profitAvailable: boolean;
}

type StaffClient = Awaited<ReturnType<typeof requireStaff>>["client"];

async function fetchOrders(
  client: StaffClient,
  fromIso: string,
  toIso: string | null,
): Promise<OrderRow[] | null> {
  const rows: OrderRow[] = [];
  for (let page = 0; page < 5; page += 1) {
    let query = client
      .from("orders")
      .select("id, status, subtotal_minor, discount_minor, total_minor, phone, placed_at")
      .gte("placed_at", fromIso)
      .order("placed_at", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (toIso) query = query.lt("placed_at", toIso);
    const result = await query;
    if (result.error) return null;
    for (const row of result.data ?? []) {
      rows.push({
        id: String(row.id),
        status: String(row.status),
        subtotal_minor: num(row.subtotal_minor),
        discount_minor: num(row.discount_minor),
        total_minor: num(row.total_minor),
        phone: String(row.phone ?? ""),
        placed_at: String(row.placed_at ?? ""),
      });
    }
    if ((result.data ?? []).length < 1000) break;
  }
  return rows;
}

async function fetchOrderItems(
  client: StaffClient,
  orderIds: string[],
): Promise<OrderItemRow[]> {
  const rows: OrderItemRow[] = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const result = await client
      .from("order_items")
      .select("order_id, product_id, variant_id, product_name, unit_price_minor, quantity, line_total_minor")
      .in("order_id", chunk);
    if (result.error) return rows;
    for (const row of result.data ?? []) {
      rows.push({
        order_id: String(row.order_id),
        product_id: String(row.product_id),
        variant_id: String(row.variant_id),
        product_name: String(row.product_name ?? ""),
        unit_price_minor: num(row.unit_price_minor),
        quantity: num(row.quantity),
        line_total_minor: num(row.line_total_minor),
      });
    }
  }
  return rows;
}

export async function getAnalyticsReport(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<AnalyticsReport> {
  const session = await requireStaff(areaRoles("analytics"));
  const range = parseDateRange(searchParams, 30);
  const fromIso = `${range.from}T00:00:00+06:00`;
  const toIso = `${dayAfter(range.to)}T00:00:00+06:00`;
  const empty: AnalyticsReport = {
    range,
    ordersAvailable: false,
    grossSalesMinor: 0,
    netRevenueMinor: 0,
    totalOrders: 0,
    averageOrderMinor: 0,
    dailySeries: eachDay(range).map((day) => ({ label: day, value: 0 })),
    statusDistribution: [],
    bestSellers: [],
    salesByCategory: [],
    couponPerformance: null,
    inventory: null,
    customerTrends: null,
    profit: null,
    profitAvailable: false,
  };

  const orders = await fetchOrders(session.client, fromIso, toIso);
  if (orders === null) return empty;

  const counted = orders.filter((order) => !EXCLUDED_STATUSES.has(order.status));
  const grossSalesMinor = counted.reduce((sum, order) => sum + order.total_minor, 0);
  const netRevenueMinor = counted.reduce(
    (sum, order) => sum + (order.subtotal_minor - order.discount_minor),
    0,
  );
  const totalOrders = counted.length;

  const dailyTotals = new Map<string, number>();
  for (const day of eachDay(range)) dailyTotals.set(day, 0);
  for (const order of counted) {
    const day = order.placed_at ? toDhakaDateKey(new Date(order.placed_at)) : "";
    if (dailyTotals.has(day)) {
      dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + order.total_minor);
    }
  }
  const statusCounts = new Map<string, number>();
  for (const order of orders) {
    statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1);
  }

  const countedIds = new Set(counted.map((order) => order.id));
  const items = await fetchOrderItems(session.client, [...countedIds]);

  const byProduct = new Map<string, { quantity: number; revenueMinor: number }>();
  for (const item of items) {
    const current = byProduct.get(item.product_name) ?? { quantity: 0, revenueMinor: 0 };
    current.quantity += item.quantity;
    current.revenueMinor += item.line_total_minor;
    byProduct.set(item.product_name, current);
  }
  const bestSellers = [...byProduct.entries()]
    .map(([productName, totals]) => ({ productName, ...totals }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor)
    .slice(0, 10);

  // Sales by category: order_items -> products -> categories.
  const salesByCategory: { category: string; revenueMinor: number }[] = [];
  const productIds = [...new Set(items.map((item) => item.product_id))];
  if (productIds.length > 0) {
    const productResult = await session.client
      .from("products")
      .select("id, category_id")
      .in("id", productIds.slice(0, 200));
    if (!productResult.error) {
      const categoryByProduct = new Map<string, string | null>();
      const categoryIds = new Set<string>();
      for (const product of productResult.data ?? []) {
        categoryByProduct.set(String(product.id), product.category_id ? String(product.category_id) : null);
        if (product.category_id) categoryIds.add(String(product.category_id));
      }
      const names = new Map<string, string>();
      if (categoryIds.size > 0) {
        const categoryResult = await session.client
          .from("categories")
          .select("id, name")
          .in("id", [...categoryIds]);
        if (!categoryResult.error) {
          for (const category of categoryResult.data ?? []) {
            names.set(String(category.id), String(category.name));
          }
        }
      }
      const byCategory = new Map<string, number>();
      for (const item of items) {
        const categoryId = categoryByProduct.get(item.product_id);
        const label = categoryId ? (names.get(categoryId) ?? "Uncategorised") : "Uncategorised";
        byCategory.set(label, (byCategory.get(label) ?? 0) + item.line_total_minor);
      }
      salesByCategory.push(
        ...[...byCategory.entries()]
          .map(([category, revenueMinor]) => ({ category, revenueMinor }))
          .sort((a, b) => b.revenueMinor - a.revenueMinor),
      );
    }
  }

  // Coupon performance from coupon_redemptions (migration 004). The table
  // records coupon_id + redeemed_at only — no per-redemption discount
  // amount exists, so the report shows redemption counts by coupon code.
  // Any error means unavailable. Note the RLS policy requires
  // coupons.manage, so analytics-only roles see an empty list.
  let couponPerformance: AnalyticsReport["couponPerformance"] = null;
  const redemptionResult = await session.client
    .from("coupon_redemptions")
    .select("coupon_id, redeemed_at")
    .gte("redeemed_at", fromIso)
    .lt("redeemed_at", toIso)
    .limit(1000);
  if (!redemptionResult.error) {
    const counts = new Map<string, number>();
    for (const row of redemptionResult.data ?? []) {
      const couponId = String(row.coupon_id ?? "");
      if (!couponId) continue;
      counts.set(couponId, (counts.get(couponId) ?? 0) + 1);
    }
    const codes = new Map<string, string>();
    if (counts.size > 0) {
      const couponResult = await session.client
        .from("coupons")
        .select("id, code")
        .in("id", [...counts.keys()]);
      if (!couponResult.error) {
        for (const coupon of couponResult.data ?? []) {
          codes.set(String(coupon.id), String(coupon.code));
        }
      }
    }
    couponPerformance = [...counts.entries()]
      .map(([couponId, redemptions]) => ({
        code: codes.get(couponId) ?? "Unknown coupon",
        redemptions,
      }))
      .sort((a, b) => b.redemptions - a.redemptions);
  }

  // Inventory aggregates (read-only; inventory writes belong to builder B).
  let inventory: AnalyticsReport["inventory"] = null;
  const inventoryResult = await session.client
    .from("inventory")
    .select("available, low_stock_threshold")
    .limit(5000);
  if (!inventoryResult.error) {
    let inStock = 0;
    let outOfStock = 0;
    let lowStock = 0;
    for (const row of inventoryResult.data ?? []) {
      const available = num(row.available);
      if (available <= 0) outOfStock += 1;
      else {
        inStock += 1;
        if (available <= num(row.low_stock_threshold)) lowStock += 1;
      }
    }
    inventory = {
      totalVariants: inventoryResult.data?.length ?? 0,
      inStock,
      outOfStock,
      lowStock,
    };
  }

  // Customer trends: a phone is "returning" when it ordered before the range.
  let customerTrends: AnalyticsReport["customerTrends"] = null;
  const phonesInRange = new Set(counted.map((order) => order.phone).filter(Boolean));
  if (phonesInRange.size > 0) {
    const priorResult = await session.client
      .from("orders")
      .select("phone")
      .lt("placed_at", fromIso)
      .limit(5000);
    if (!priorResult.error) {
      const priorPhones = new Set(
        (priorResult.data ?? []).map((row) => String(row.phone ?? "")).filter(Boolean),
      );
      let returning = 0;
      for (const phone of phonesInRange) {
        if (priorPhones.has(phone)) returning += 1;
      }
      customerTrends = {
        newCustomers: phonesInRange.size - returning,
        returningCustomers: returning,
      };
    }
  } else {
    customerTrends = { newCustomers: 0, returningCustomers: 0 };
  }

  // Profit: delivered orders only, cost prices only when recorded.
  let profit: AnalyticsReport["profit"] = null;
  let profitAvailable = false;
  const deliveredIds = new Set(
    orders.filter((order) => order.status === "delivered").map((order) => order.id),
  );
  const deliveredItems = await fetchOrderItems(session.client, [...deliveredIds]);
  if (deliveredItems.length > 0) {
    const variantIds = [...new Set(deliveredItems.map((item) => item.variant_id))];
    const costResult = await session.client
      .from("product_variants")
      .select("id, cost_price_minor")
      .in("id", variantIds.slice(0, 200));
    if (!costResult.error) {
      const costs = new Map<string, number>();
      for (const variant of costResult.data ?? []) {
        if (typeof variant.cost_price_minor === "number") {
          costs.set(String(variant.id), variant.cost_price_minor);
        }
      }
      let profitMinor = 0;
      let revenueMinor = 0;
      let costMinor = 0;
      let itemsWithCost = 0;
      for (const item of deliveredItems) {
        const cost = costs.get(item.variant_id);
        if (cost === undefined) continue;
        itemsWithCost += 1;
        revenueMinor += item.line_total_minor;
        costMinor += cost * item.quantity;
        profitMinor += (item.unit_price_minor - cost) * item.quantity;
      }
      if (itemsWithCost > 0) {
        profitAvailable = true;
        profit = {
          profitMinor,
          revenueMinor,
          costMinor,
          itemsWithCost,
          deliveredItems: deliveredItems.length,
        };
      }
    }
  }

  return {
    range,
    ordersAvailable: true,
    grossSalesMinor,
    netRevenueMinor,
    totalOrders,
    averageOrderMinor: totalOrders > 0 ? Math.round(grossSalesMinor / totalOrders) : 0,
    dailySeries: eachDay(range).map((day) => ({
      label: day,
      value: dailyTotals.get(day) ?? 0,
    })),
    statusDistribution: [...statusCounts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    bestSellers,
    salesByCategory,
    couponPerformance,
    inventory,
    customerTrends,
    profit,
    profitAvailable,
  };
}

export type CsvExportResult =
  | { ok: true; filename: string; csv: string }
  | { ok: false; error: string };

/** Daily sales CSV for the selected range (no route handler involved). */
export async function exportDailySalesCsv(form: FormData): Promise<CsvExportResult> {
  "use server";
  const from = form.get("from");
  const to = form.get("to");
  const report = await getAnalyticsReport({
    from: typeof from === "string" ? from : undefined,
    to: typeof to === "string" ? to : undefined,
  });
  if (!report.ordersAvailable) {
    return { ok: false, error: "Order data is unavailable, so no CSV was generated." };
  }
  const csv = toCsv(
    ["date", "gross_sales_minor", "gross_sales_bdt"],
    report.dailySeries.map((point) => [
      point.label,
      point.value,
      (point.value / 100).toFixed(2),
    ]),
  );
  return {
    ok: true,
    filename: `attires-arena-daily-sales-${report.range.from}-to-${report.range.to}.csv`,
    csv,
  };
}
