import { describe, it, expect } from "vitest";
import {
  bucketRevenue,
  countByStatus,
  dashboardLoadWarnings,
  loadDashboard,
  startDashboardLoad,
  sumRevenue,
  type DashboardClient,
} from "../src/lib/admin/dashboard";

/**
 * Section-loader regression suite. The streaming dashboard splits
 * loadDashboard into per-section promises; this suite proves the split
 * changes nothing: the same canned store produces the same aggregates
 * through loadDashboard and through the section loaders, each query is
 * issued exactly once, and a failed query degrades only its own
 * section. Fake client only — no network, no real credentials.
 *
 * The fake is a thenable query builder: chainable methods record their
 * calls, and `from(table)` resolves from canned rows by table + filters,
 * so the count queries (total vs created-in-window) and the orders
 * queries (current vs previous vs recent) return different canned data
 * from the same table, exactly as the real queries would.
 */

type Call = { method: string; args: unknown[] };
type QueryResult = {
  data: unknown;
  error: Error | null;
  count: number | null;
};

class FakeQueryBuilder
  implements PromiseLike<QueryResult>
{
  private calls: Call[] = [];

  constructor(
    private resolve: (calls: Call[]) => QueryResult,
  ) {}

  select(...args: unknown[]): this {
    this.calls.push({ method: "select", args });
    return this;
  }

  gte(...args: unknown[]): this {
    this.calls.push({ method: "gte", args });
    return this;
  }

  lt(...args: unknown[]): this {
    this.calls.push({ method: "lt", args });
    return this;
  }

  eq(...args: unknown[]): this {
    this.calls.push({ method: "eq", args });
    return this;
  }

  in(...args: unknown[]): this {
    this.calls.push({ method: "in", args });
    return this;
  }

  order(...args: unknown[]): this {
    this.calls.push({ method: "order", args });
    return this;
  }

  limit(...args: unknown[]): this {
    this.calls.push({ method: "limit", args });
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve(this.calls)).then(
      onfulfilled,
      onrejected,
    );
  }
}

const CURRENT_RANGE = { from: "2026-11-10", to: "2026-11-16" };

const ORDER_A = {
  id: "11111111-1111-4111-8111-111111111111",
  order_number: 10001,
  customer_name: "Ayesha",
  phone: "01700000001",
  payment_method: "cod",
  payment_status: "unpaid",
  status: "delivered",
  total_minor: 100000,
  placed_at: "2026-11-12T10:00:00+06:00",
};
const ORDER_B = {
  id: "22222222-2222-4222-8222-222222222222",
  order_number: 10002,
  customer_name: "Bilal",
  phone: "01700000002",
  payment_method: "cod",
  payment_status: "unpaid",
  status: "confirmed",
  total_minor: 50000,
  placed_at: "2026-11-13T11:00:00+06:00",
};
const ORDER_CANCELLED = {
  id: "33333333-3333-4333-8333-333333333333",
  order_number: 10003,
  customer_name: "Ayesha",
  phone: "01700000001",
  payment_method: "cod",
  payment_status: "unpaid",
  status: "cancelled",
  total_minor: 70000,
  placed_at: "2026-11-14T12:00:00+06:00",
};
const ORDER_PREVIOUS = {
  id: "44444444-4444-4444-8444-444444444444",
  order_number: 10000,
  customer_name: "Ayesha",
  phone: "01700000001",
  payment_method: "cod",
  payment_status: "paid",
  status: "delivered",
  total_minor: 80000,
  placed_at: "2026-11-05T09:00:00+06:00",
};

const PRODUCT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ITEM_A = {
  product_id: PRODUCT_A,
  product_name: "Shirt A",
  quantity: 2,
  line_total_minor: 60000,
  orders: { placed_at: "2026-11-12T10:00:00+06:00", status: "delivered" },
};
const ITEM_B = {
  product_id: PRODUCT_B,
  product_name: "Shirt B",
  quantity: 1,
  line_total_minor: 40000,
  orders: { placed_at: "2026-11-13T11:00:00+06:00", status: "confirmed" },
};
const ITEM_CANCELLED = {
  product_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  product_name: "Shirt C",
  quantity: 5,
  line_total_minor: 200000,
  orders: { placed_at: "2026-11-12T10:00:00+06:00", status: "cancelled" },
};
const ITEM_OUT_OF_WINDOW = {
  product_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  product_name: "Shirt D",
  quantity: 3,
  line_total_minor: 90000,
  orders: { placed_at: "2026-11-01T10:00:00+06:00", status: "delivered" },
};

const INVENTORY_LOW = {
  variant_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  available: 1,
  low_stock_threshold: 2,
  product_variants: {
    size: "M",
    color: "White",
    product_id: PRODUCT_A,
    products: { name: "Shirt A" },
  },
};
const INVENTORY_OK = {
  variant_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  available: 10,
  low_stock_threshold: 2,
  product_variants: {
    size: "L",
    color: "Black",
    product_id: PRODUCT_B,
    products: { name: "Shirt B" },
  },
};

const ABANDONED_WITH_ITEMS = {
  id: "12345678-1234-4123-8123-123456789012",
  checkout_items: [{ id: "23456789-2345-4234-8234-234567890123" }],
};
const ABANDONED_EMPTY = {
  id: "34567890-3456-4345-8345-345678901234",
  checkout_items: [],
};

const MEDIA_A = {
  product_id: PRODUCT_A,
  storage_path: "a/cover.jpg",
  alt_text: "Shirt A cover",
};
const MEDIA_B = {
  product_id: PRODUCT_B,
  storage_path: "b/cover.jpg",
  alt_text: "Shirt B cover",
};

function gteValue(calls: Call[], column: string): string | undefined {
  const call = calls.find(
    (c) => c.method === "gte" && c.args[0] === column,
  );
  return typeof call?.args[1] === "string" ? call.args[1] : undefined;
}

function ordersResolver(calls: Call[]): QueryResult {
  const from = gteValue(calls, "placed_at");
  if (from === "2026-11-10T00:00:00+06:00") {
    return { data: [ORDER_A, ORDER_B, ORDER_CANCELLED], error: null, count: null };
  }
  if (from === "2026-11-03T00:00:00+06:00") {
    return { data: [ORDER_PREVIOUS], error: null, count: null };
  }
  // No placed_at filter: the recent-orders query (newest first).
  return { data: [ORDER_CANCELLED, ORDER_B], error: null, count: null };
}

function productsResolver(calls: Call[]): QueryResult {
  const from = gteValue(calls, "created_at");
  if (from === "2026-11-10T00:00:00+06:00") {
    return { data: [], error: null, count: 3 };
  }
  if (from === "2026-11-03T00:00:00+06:00") {
    return { data: [], error: null, count: 1 };
  }
  return { data: [], error: null, count: 42 };
}

function fakeClient(
  failingTables: readonly string[] = [],
  options?: { orderItemRows?: unknown[] },
): { client: DashboardClient; calls: Record<string, number>; signedUrls: string[] } {
  const calls: Record<string, number> = {};
  const signedUrls: string[] = [];
  const resolvers: Record<string, (calls: Call[]) => QueryResult> = {
    orders: ordersResolver,
    products: productsResolver,
    order_items: () => ({
      data: options?.orderItemRows ?? [ITEM_A, ITEM_B, ITEM_CANCELLED, ITEM_OUT_OF_WINDOW],
      error: null,
      count: null,
    }),
    inventory: () => ({
      data: [INVENTORY_LOW, INVENTORY_OK],
      error: null,
      count: null,
    }),
    checkout_sessions: () => ({
      data: [ABANDONED_WITH_ITEMS, ABANDONED_EMPTY],
      error: null,
      count: null,
    }),
    product_media: () => ({
      data: [MEDIA_A, MEDIA_B],
      error: null,
      count: null,
    }),
  };
  const client = {
    from(table: string) {
      calls[table] = (calls[table] ?? 0) + 1;
      const resolve = failingTables.includes(table)
        ? () => ({ data: null, error: new Error(`${table} boom`), count: null })
        : (resolvers[table] ?? (() => ({ data: [], error: null, count: null })));
      return new FakeQueryBuilder(resolve);
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          signedUrls.push(path);
          return {
            data: { signedUrl: `https://signed.example/${path}` },
            error: null,
          };
        },
      }),
    },
  } as unknown as DashboardClient;
  return { client, calls, signedUrls };
}

describe("dashboard section loaders", () => {
  it("loadDashboard aggregates the canned store exactly", async () => {
    const { client, calls, signedUrls } = fakeClient();
    const loaded = await loadDashboard(client, CURRENT_RANGE, "day");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const data = loaded.data;
    // Revenue excludes cancelled (70,000) but counts delivered + confirmed.
    expect(data.revenueMinor).toBe(150000);
    expect(data.revenueMinorPrevious).toBe(80000);
    expect(data.orderCount).toBe(3);
    expect(data.orderCountPrevious).toBe(1);
    expect(data.customerCount).toBe(2);
    expect(data.customerCountPrevious).toBe(1);
    expect(data.totalProducts).toBe(42);
    expect(data.productsCreatedCurrent).toBe(3);
    expect(data.productsCreatedPrevious).toBe(1);
    expect(data.statusCounts).toEqual({
      pending: 0,
      confirmed: 1,
      packed: 0,
      shipped: 0,
      "out-for-delivery": 0,
      delivered: 1,
      cancelled: 1,
      returned: 0,
    });
    expect(data.revenueBuckets).toHaveLength(7);
    expect(data.revenueBuckets[2]).toMatchObject({
      key: "2026-11-12",
      revenueMinor: 100000,
      orderCount: 1,
    });
    // Cancelled order counts as an order but earns no revenue.
    expect(data.revenueBuckets[4]).toMatchObject({
      key: "2026-11-14",
      revenueMinor: 0,
      orderCount: 1,
    });
    // Best by revenue, least by fewest units; cancelled/out-of-window
    // items never appear.
    expect(data.bestSellers.map((item) => item.productName)).toEqual([
      "Shirt A",
      "Shirt B",
    ]);
    expect(data.leastSellers.map((item) => item.productName)).toEqual([
      "Shirt B",
      "Shirt A",
    ]);
    expect(data.bestSellers[0]?.imageUrl).toBe(
      "https://signed.example/a/cover.jpg",
    );
    expect(data.recentOrders.map((order) => order.id)).toEqual([
      ORDER_CANCELLED.id,
      ORDER_B.id,
    ]);
    expect(data.lowStock).toHaveLength(1);
    expect(data.lowStock[0]?.productName).toBe("Shirt A");
    expect(data.incompleteCount).toBe(1);
    expect(data.failedSections).toEqual([]);
    expect(data.ordersTruncated).toBe(false);
    expect(data.orderItemsTruncated).toBe(false);
    expect(data.incompleteTruncated).toBe(false);
    // Each query issued exactly once.
    expect(calls).toEqual({
      orders: 3,
      products: 3,
      order_items: 1,
      inventory: 1,
      checkout_sessions: 1,
      product_media: 1,
    });
    // One signed URL per listed product, in each panel (best and least
    // both list A and B, so each cover is signed twice — as before).
    expect(signedUrls).toEqual([
      "a/cover.jpg",
      "b/cover.jpg",
      "b/cover.jpg",
      "a/cover.jpg",
    ]);
  });

  it("section promises agree with loadDashboard on the same store", async () => {
    const { client } = fakeClient();
    const loaded = await loadDashboard(client, CURRENT_RANGE, "day");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const data = loaded.data;

    const load = startDashboardLoad(client, CURRENT_RANGE);
    const [ordersWindow, productCounts, incomplete, sellers, recent, lowStock] =
      await Promise.all([
        load.ordersWindow,
        load.productCounts,
        load.incomplete,
        load.sellers,
        load.recentOrders,
        load.lowStock,
      ]);
    expect(sumRevenue(ordersWindow.current)).toBe(data.revenueMinor);
    expect(sumRevenue(ordersWindow.previous)).toBe(data.revenueMinorPrevious);
    expect(countByStatus(ordersWindow.current)).toEqual(data.statusCounts);
    expect(bucketRevenue(ordersWindow.current, "day", CURRENT_RANGE)).toEqual(
      data.revenueBuckets,
    );
    expect(productCounts.total).toBe(data.totalProducts);
    expect(incomplete.count).toBe(data.incompleteCount);
    expect(sellers.best).toEqual(data.bestSellers);
    expect(sellers.least).toEqual(data.leastSellers);
    expect(recent.orders).toEqual(data.recentOrders);
    expect(lowStock.rows).toEqual(data.lowStock);

    const warnings = await dashboardLoadWarnings(load);
    expect(warnings).toEqual({
      failedSections: [],
      ordersTruncated: false,
      orderItemsTruncated: false,
      incompleteTruncated: false,
    });
  });

  it("a failed orders query degrades only the orders sections", async () => {
    const { client } = fakeClient(["orders"]);
    const loaded = await loadDashboard(client, CURRENT_RANGE, "day");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const data = loaded.data;
    expect(data.failedSections).toEqual(["Orders", "Recent orders"]);
    expect(data.revenueMinor).toBe(0);
    expect(data.orderCount).toBe(0);
    expect(data.recentOrders).toEqual([]);
    // Unrelated sections are untouched.
    expect(data.totalProducts).toBe(42);
    expect(data.lowStock).toHaveLength(1);
    expect(data.incompleteCount).toBe(1);
  });

  it("flags order-items truncation when the sellers query hits its cap", async () => {
    const manyItems = Array.from({ length: 1000 }, () => ITEM_A);
    const { client } = fakeClient([], { orderItemRows: manyItems });
    const loaded = await loadDashboard(client, CURRENT_RANGE, "day");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.data.orderItemsTruncated).toBe(true);
    expect(loaded.data.failedSections).toEqual([]);
    const load = startDashboardLoad(client, CURRENT_RANGE);
    const warnings = await dashboardLoadWarnings(load);
    expect(warnings.orderItemsTruncated).toBe(true);
    expect(warnings.failedSections).toEqual([]);
  });

  it("a failed order-items query degrades only the sellers section", async () => {
    const { client } = fakeClient(["order_items"]);
    const loaded = await loadDashboard(client, CURRENT_RANGE, "day");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const data = loaded.data;
    expect(data.failedSections).toEqual(["Best sellers"]);
    expect(data.bestSellers).toEqual([]);
    expect(data.leastSellers).toEqual([]);
    expect(data.revenueMinor).toBe(150000);
    expect(data.recentOrders).toHaveLength(2);
  });
});
