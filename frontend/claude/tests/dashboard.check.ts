import { describe, it, expect } from "vitest";
import {
  addDaysToKey,
  aggregateBestSellers,
  aggregateLeastSellers,
  bucketKeyFor,
  bucketKeysInRange,
  bucketLabel,
  bucketRevenue,
  countByStatus,
  countDistinctPhones,
  periodDelta,
  previousPeriodRange,
  rangeBounds,
  rangeSpanDays,
  resolveGranularity,
  revenueGranularitySchema,
  selectFirstMediaByProduct,
  selectLowStock,
  summarizeRevenue,
  sumRevenue,
  withComparisonSeries,
} from "../src/lib/admin/dashboard";

describe("previous-period windows", () => {
  it("returns the same-length window ending the day before", () => {
    expect(previousPeriodRange({ from: "2026-11-01", to: "2026-11-30" })).toEqual({
      from: "2026-10-02",
      to: "2026-10-31",
    });
    expect(rangeSpanDays({ from: "2026-10-02", to: "2026-10-31" })).toBe(30);
  });
  it("handles a single-day window", () => {
    expect(previousPeriodRange({ from: "2026-11-15", to: "2026-11-15" })).toEqual({
      from: "2026-11-14",
      to: "2026-11-14",
    });
  });
  it("handles month boundaries and leap years", () => {
    expect(previousPeriodRange({ from: "2026-03-01", to: "2026-03-01" })).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });
    expect(previousPeriodRange({ from: "2024-03-01", to: "2024-03-01" })).toEqual({
      from: "2024-02-29",
      to: "2024-02-29",
    });
  });
  it("adds days across month and year boundaries", () => {
    expect(addDaysToKey("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysToKey("not-a-date", 3)).toBe("not-a-date");
  });
});

describe("range bounds", () => {
  it("builds an exclusive end at the next Dhaka midnight", () => {
    expect(rangeBounds({ from: "2026-11-01", to: "2026-11-30" })).toEqual({
      startIso: "2026-11-01T00:00:00+06:00",
      endIsoExclusive: "2026-12-01T00:00:00+06:00",
    });
  });
});

describe("granularity", () => {
  it("resolves automatically from the span", () => {
    expect(resolveGranularity({ from: "2026-11-01", to: "2026-11-30" })).toBe("day");
    expect(resolveGranularity({ from: "2026-11-01", to: "2026-12-01" })).toBe("day");
    expect(resolveGranularity({ from: "2026-11-01", to: "2026-12-02" })).toBe("week");
    expect(resolveGranularity({ from: "2026-01-01", to: "2026-04-30" })).toBe("week");
    expect(resolveGranularity({ from: "2026-01-01", to: "2026-05-01" })).toBe("month");
  });
  it("lets an explicit request win", () => {
    expect(resolveGranularity({ from: "2026-11-01", to: "2026-11-30" }, "month")).toBe("month");
  });
  it("validates granularity input with Zod", () => {
    expect(revenueGranularitySchema.safeParse("week").success).toBe(true);
    expect(revenueGranularitySchema.safeParse("year").success).toBe(false);
    expect(revenueGranularitySchema.safeParse("").success).toBe(false);
  });
});

describe("bucketing", () => {
  // 2026-11-15 is a Sunday; its week starts Monday 2026-11-09.
  it("buckets by Dhaka calendar date, not UTC", () => {
    expect(bucketKeyFor("2026-11-14T20:00:00Z", "day")).toBe("2026-11-15");
    expect(bucketKeyFor("2026-11-14T17:59:59Z", "day")).toBe("2026-11-14");
    expect(bucketKeyFor("2026-11-15T10:00:00+06:00", "week")).toBe("2026-11-09");
    expect(bucketKeyFor("2026-11-09T10:00:00+06:00", "week")).toBe("2026-11-09");
    expect(bucketKeyFor("2026-11-15T10:00:00+06:00", "month")).toBe("2026-11");
    expect(bucketKeyFor("not-a-date", "day")).toBeNull();
  });
  it("labels buckets", () => {
    expect(bucketLabel("2026-11-12", "day")).toBe("12 Nov");
    expect(bucketLabel("2026-11-09", "week")).toBe("Week of 9 Nov");
    expect(bucketLabel("2026-11", "month")).toBe("Nov 2026");
  });
  it("lists every bucket in the range, including empty ones", () => {
    expect(bucketKeysInRange({ from: "2026-11-09", to: "2026-11-11" }, "day")).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
    ]);
    expect(bucketKeysInRange({ from: "2026-11-09", to: "2026-11-16" }, "week")).toEqual([
      "2026-11-09",
      "2026-11-16",
    ]);
    expect(bucketKeysInRange({ from: "2026-11-15", to: "2026-12-05" }, "month")).toEqual([
      "2026-11",
      "2026-12",
    ]);
  });
  it("fills empty days with zeroes and skips invalid timestamps", () => {
    const buckets = bucketRevenue(
      [
        { placed_at: "2026-11-09T10:00:00+06:00", total_minor: 10000, status: "delivered" },
        { placed_at: "2026-11-09T11:00:00+06:00", total_minor: 5000, status: "cancelled" },
        { placed_at: "garbage", total_minor: 99999, status: "delivered" },
      ],
      "day",
      { from: "2026-11-09", to: "2026-11-10" },
    );
    expect(buckets).toEqual([
      { key: "2026-11-09", label: "9 Nov", revenueMinor: 10000, orderCount: 2 },
      { key: "2026-11-10", label: "10 Nov", revenueMinor: 0, orderCount: 0 },
    ]);
  });
  it("buckets revenue by week and month", () => {
    const weekly = bucketRevenue(
      [
        { placed_at: "2026-11-09T10:00:00+06:00", total_minor: 1000, status: "pending" },
        { placed_at: "2026-11-15T10:00:00+06:00", total_minor: 2000, status: "pending" },
        { placed_at: "2026-11-16T10:00:00+06:00", total_minor: 4000, status: "returned" },
      ],
      "week",
      { from: "2026-11-09", to: "2026-11-16" },
    );
    expect(weekly).toEqual([
      { key: "2026-11-09", label: "Week of 9 Nov", revenueMinor: 3000, orderCount: 2 },
      { key: "2026-11-16", label: "Week of 16 Nov", revenueMinor: 0, orderCount: 1 },
    ]);
    const monthly = bucketRevenue(
      [
        { placed_at: "2026-11-30T10:00:00+06:00", total_minor: 1000, status: "pending" },
        { placed_at: "2026-12-01T10:00:00+06:00", total_minor: 2000, status: "pending" },
      ],
      "month",
      { from: "2026-11-01", to: "2026-12-31" },
    );
    expect(monthly).toEqual([
      { key: "2026-11", label: "Nov 2026", revenueMinor: 1000, orderCount: 1 },
      { key: "2026-12", label: "Dec 2026", revenueMinor: 2000, orderCount: 1 },
    ]);
  });
  it("returns zero-filled buckets for empty input", () => {
    expect(bucketRevenue([], "day", { from: "2026-11-09", to: "2026-11-09" })).toEqual([
      { key: "2026-11-09", label: "9 Nov", revenueMinor: 0, orderCount: 0 },
    ]);
    expect(withComparisonSeries([], [])).toEqual([]);
  });
  it("pairs comparison series by position and pads the shorter side", () => {
    const current = bucketRevenue(
      [{ placed_at: "2026-11-09T10:00:00+06:00", total_minor: 3000, status: "pending" }],
      "day",
      { from: "2026-11-09", to: "2026-11-10" },
    );
    const previous = bucketRevenue(
      [{ placed_at: "2026-11-07T10:00:00+06:00", total_minor: 1000, status: "pending" }],
      "day",
      { from: "2026-11-07", to: "2026-11-07" },
    );
    expect(withComparisonSeries(current, previous)).toEqual([
      { label: "9 Nov", value: 3000, compareValue: 1000 },
      { label: "10 Nov", value: 0, compareValue: 0 },
    ]);
  });
});

describe("status counting and revenue", () => {
  it("counts all eight statuses and ignores unknown ones", () => {
    expect(
      countByStatus([
        { status: "pending" },
        { status: "pending" },
        { status: "delivered" },
        { status: "processing" },
        { status: "" },
      ]),
    ).toEqual({
      pending: 2,
      confirmed: 0,
      packed: 0,
      shipped: 0,
      "out-for-delivery": 0,
      delivered: 1,
      cancelled: 0,
      returned: 0,
    });
  });
  it("counts zero for every status on empty input", () => {
    expect(countByStatus([])).toEqual({
      pending: 0,
      confirmed: 0,
      packed: 0,
      shipped: 0,
      "out-for-delivery": 0,
      delivered: 0,
      cancelled: 0,
      returned: 0,
    });
  });
  it("excludes cancelled and returned orders from revenue", () => {
    expect(
      sumRevenue([
        { placed_at: "2026-11-09T10:00:00+06:00", total_minor: 1000, status: "delivered" },
        { placed_at: "2026-11-09T10:00:00+06:00", total_minor: 2000, status: "pending" },
        { placed_at: "2026-11-09T10:00:00+06:00", total_minor: 4000, status: "cancelled" },
        { placed_at: "2026-11-09T10:00:00+06:00", total_minor: 8000, status: "returned" },
      ]),
    ).toBe(3000);
    expect(sumRevenue([])).toBe(0);
  });
  it("counts distinct phones, ignoring blanks and whitespace", () => {
    expect(
      countDistinctPhones([
        { phone: "01711111111" },
        { phone: " 01711111111 " },
        { phone: "01822222222" },
        { phone: "" },
        { phone: "   " },
      ]),
    ).toBe(2);
    expect(countDistinctPhones([])).toBe(0);
  });
});

describe("previous-period comparison math", () => {
  it("computes percent change", () => {
    expect(periodDelta(150, 100)).toBe(50);
    expect(periodDelta(75, 100)).toBe(-25);
    expect(periodDelta(100, 100)).toBe(0);
    expect(periodDelta(0, 100)).toBe(-100);
  });
  it("returns null when the previous value is zero", () => {
    expect(periodDelta(5, 0)).toBeNull();
    expect(periodDelta(0, 0)).toBeNull();
  });
});

describe("best sellers", () => {
  it("groups by product and sorts by revenue, units, then name", () => {
    expect(
      aggregateBestSellers([
        { product_id: "a", product_name: "Shirt A", quantity: 1, line_total_minor: 1000 },
        { product_id: "b", product_name: "Shirt B", quantity: 3, line_total_minor: 900 },
        { product_id: "a", product_name: "Shirt A", quantity: 2, line_total_minor: 2000 },
        { product_id: "c", product_name: "Shirt C", quantity: 5, line_total_minor: 900 },
      ]),
    ).toEqual([
      { productId: "a", productName: "Shirt A", units: 3, revenueMinor: 3000 },
      { productId: "c", productName: "Shirt C", units: 5, revenueMinor: 900 },
      { productId: "b", productName: "Shirt B", units: 3, revenueMinor: 900 },
    ]);
  });
  it("returns an empty list for empty input", () => {
    expect(aggregateBestSellers([])).toEqual([]);
  });
});

describe("least sellers", () => {
  it("groups by product and sorts by fewest units, revenue, then name", () => {
    expect(
      aggregateLeastSellers([
        { product_id: "a", product_name: "Shirt A", quantity: 1, line_total_minor: 1000 },
        { product_id: "b", product_name: "Shirt B", quantity: 3, line_total_minor: 900 },
        { product_id: "a", product_name: "Shirt A", quantity: 2, line_total_minor: 2000 },
        { product_id: "c", product_name: "Shirt C", quantity: 5, line_total_minor: 900 },
        { product_id: "d", product_name: "Shirt D", quantity: 3, line_total_minor: 500 },
      ]),
    ).toEqual([
      { productId: "d", productName: "Shirt D", units: 3, revenueMinor: 500 },
      { productId: "b", productName: "Shirt B", units: 3, revenueMinor: 900 },
      { productId: "a", productName: "Shirt A", units: 3, revenueMinor: 3000 },
      { productId: "c", productName: "Shirt C", units: 5, revenueMinor: 900 },
    ]);
  });
  it("breaks unit and revenue ties by product name", () => {
    expect(
      aggregateLeastSellers([
        { product_id: "b", product_name: "Shirt B", quantity: 1, line_total_minor: 100 },
        { product_id: "a", product_name: "Shirt A", quantity: 1, line_total_minor: 100 },
      ]).map((item) => item.productId),
    ).toEqual(["a", "b"]);
  });
  it("returns an empty list for empty input", () => {
    expect(aggregateLeastSellers([])).toEqual([]);
  });
  it("only ever lists products present in the input rows", () => {
    // Never-sold products have no rows, so they can never appear here.
    expect(
      aggregateLeastSellers([
        { product_id: "a", product_name: "Shirt A", quantity: 1, line_total_minor: 100 },
      ]),
    ).toHaveLength(1);
  });
});

describe("low-stock selection", () => {
  const row = (overrides: Record<string, number | string>) => ({
    variantId: "v1",
    productId: "p1",
    productName: "Shirt",
    size: "M",
    color: "Blue",
    available: 3,
    lowStockThreshold: 5,
    ...overrides,
  });
  it("includes the threshold boundary and sorts lowest first", () => {
    expect(
      selectLowStock(
        [
          row({ variantId: "v1", available: 5, lowStockThreshold: 5 }),
          row({ variantId: "v2", available: 6, lowStockThreshold: 5 }),
          row({ variantId: "v3", available: 0, lowStockThreshold: 5 }),
        ],
        8,
      ).map((r) => r.variantId),
    ).toEqual(["v3", "v1"]);
  });
  it("caps the list and handles empty input", () => {
    expect(
      selectLowStock(
        [row({ variantId: "v1" }), row({ variantId: "v2" }), row({ variantId: "v3" })],
        2,
      ),
    ).toHaveLength(2);
    expect(selectLowStock([], 8)).toEqual([]);
  });
});

describe("revenue summary", () => {
  const bucket = (key: string, label: string, revenueMinor: number) => ({
    key,
    label,
    revenueMinor,
    orderCount: 1,
  });
  it("totals, peaks, and averages in one pass", () => {
    expect(
      summarizeRevenue([
        bucket("2026-11-01", "1 Nov", 1000),
        bucket("2026-11-02", "2 Nov", 3000),
        bucket("2026-11-03", "3 Nov", 2000),
      ]),
    ).toEqual({
      totalMinor: 6000,
      peak: bucket("2026-11-02", "2 Nov", 3000),
      averageMinor: 2000,
      bucketCount: 3,
    });
  });
  it("keeps the first bucket on a peak tie", () => {
    const summary = summarizeRevenue([
      bucket("2026-11-01", "1 Nov", 2000),
      bucket("2026-11-02", "2 Nov", 2000),
    ]);
    expect(summary.peak?.key).toBe("2026-11-01");
  });
  it("handles empty buckets honestly", () => {
    expect(summarizeRevenue([])).toEqual({
      totalMinor: 0,
      peak: null,
      averageMinor: 0,
      bucketCount: 0,
    });
  });
});

describe("cover-media selection", () => {
  it("keeps the first row per product in position order", () => {
    const rows = [
      { product_id: "a", storage_path: "a/1.jpg", alt_text: "A front" },
      { product_id: "b", storage_path: "b/1.jpg", alt_text: "B front" },
      { product_id: "a", storage_path: "a/2.jpg", alt_text: "A back" },
    ];
    const first = selectFirstMediaByProduct(rows);
    expect(first.get("a")).toEqual(rows[0]);
    expect(first.get("b")).toEqual(rows[1]);
    expect(first.size).toBe(2);
  });
  it("returns an empty map for empty input", () => {
    expect(selectFirstMediaByProduct([]).size).toBe(0);
  });
});
