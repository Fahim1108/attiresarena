import { describe, expect, it } from "vitest";
import { toCsv } from "../src/lib/admin/format";
import {
  commonLegalTransitions,
  escapeLikePattern,
  isLegalTransition,
  legalTransitions,
  ordersToCsv,
  type OrderRow,
} from "../src/lib/admin/orders";
import {
  checkoutProgressLabel,
  manualRecoveryOptions,
  sessionValue,
} from "../src/lib/admin/incomplete";
import {
  aggregateCustomers,
  customersToCsv,
  isValidBdPhone,
  sortCustomerSummaries,
} from "../src/lib/admin/customers";
import {
  couponDiscountMinor,
  evaluateCouponEligibility,
  fromDatetimeLocal,
  normalizeCouponCode,
  toDatetimeLocal,
  type CouponTerms,
} from "../src/lib/admin/coupons";
import type { OrderStatus } from "../src/lib/admin/constants";

/* Fake rows are test fixtures only; they are never app data. */
function fakeOrder(over: Partial<OrderRow> & { phone: string }): OrderRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    order_number: 10001,
    user_id: null,
    customer_name: "Test Customer",
    email: null,
    division: "Dhaka",
    district: "Dhaka",
    area: "Mirpur",
    address_line: "House 1, Road 2",
    note: null,
    payment_method: "cod",
    payment_status: "unpaid",
    status: "pending",
    subtotal_minor: 100000,
    delivery_charge_minor: 8000,
    discount_minor: 0,
    total_minor: 108000,
    placed_at: "2026-11-10T04:00:00.000Z",
    created_at: "2026-11-10T04:00:00.000Z",
    updated_at: "2026-11-10T04:00:00.000Z",
    ...over,
  };
}

describe("legal order transitions", () => {
  it("mirrors the guard trigger for every status", () => {
    const expected: Record<OrderStatus, readonly OrderStatus[]> = {
      pending: ["confirmed", "cancelled"],
      confirmed: ["packed", "cancelled"],
      packed: ["shipped", "cancelled"],
      shipped: ["out-for-delivery", "delivered", "returned"],
      "out-for-delivery": ["delivered", "returned"],
      delivered: ["returned"],
      cancelled: [],
      returned: [],
    };
    for (const [status, next] of Object.entries(expected)) {
      expect(legalTransitions(status as OrderStatus)).toEqual(next);
    }
  });

  it("never offers Processing or any status outside the 8-value set", () => {
    const all = (
      [
        "pending",
        "confirmed",
        "packed",
        "shipped",
        "out-for-delivery",
        "delivered",
        "cancelled",
        "returned",
      ] as OrderStatus[]
    ).flatMap((status) => [status, ...legalTransitions(status)]);
    expect(all).not.toContain("Processing");
    expect(new Set(all).size).toBe(8);
  });

  it("accepts only legal moves", () => {
    expect(isLegalTransition("pending", "confirmed")).toBe(true);
    expect(isLegalTransition("pending", "packed")).toBe(false);
    expect(isLegalTransition("shipped", "delivered")).toBe(true);
    expect(isLegalTransition("delivered", "shipped")).toBe(false);
    expect(isLegalTransition("cancelled", "confirmed")).toBe(false);
    expect(isLegalTransition("pending", "pending")).toBe(false);
  });

  it("intersects transitions for bulk updates", () => {
    expect(commonLegalTransitions(["pending", "confirmed"])).toEqual(["cancelled"]);
    expect(commonLegalTransitions(["pending", "packed"])).toEqual(["cancelled"]);
    expect(commonLegalTransitions(["shipped", "out-for-delivery"])).toEqual([
      "delivered",
      "returned",
    ]);
    expect(commonLegalTransitions(["pending", "cancelled"])).toEqual([]);
    expect(commonLegalTransitions([])).toEqual([]);
    expect(commonLegalTransitions(["delivered"])).toEqual(["returned"]);
  });
});

describe("coupon discount math", () => {
  const percent = (percentValue: number, max: number | null = null): CouponTerms => ({
    kind: "percent",
    percent_value: percentValue,
    fixed_discount_minor: null,
    min_order_minor: 0,
    max_discount_minor: max,
    starts_at: null,
    expires_at: null,
    total_usage_limit: null,
    per_customer_limit: 1,
    first_order_only: false,
    active: true,
  });
  const fixed = (amount: number, max: number | null = null): CouponTerms => ({
    ...percent(10, max),
    kind: "fixed",
    percent_value: null,
    fixed_discount_minor: amount,
  });

  it("computes percent discounts with truncation like SQL integer division", () => {
    expect(couponDiscountMinor(percent(10), 100050)).toBe(10005);
    expect(couponDiscountMinor(percent(10), 100049)).toBe(10004);
    expect(couponDiscountMinor(percent(100), 50000)).toBe(50000);
  });

  it("computes fixed discounts", () => {
    expect(couponDiscountMinor(fixed(15000), 100000)).toBe(15000);
  });

  it("caps at the maximum discount and at the subtotal", () => {
    expect(couponDiscountMinor(percent(50, 20000), 100000)).toBe(20000);
    expect(couponDiscountMinor(fixed(15000), 10000)).toBe(10000);
    expect(couponDiscountMinor(percent(50), 0)).toBe(0);
    expect(couponDiscountMinor(fixed(15000), -5)).toBe(0);
  });
});

describe("coupon eligibility mirror", () => {
  const base: CouponTerms = {
    kind: "percent",
    percent_value: 10,
    fixed_discount_minor: null,
    min_order_minor: 50000,
    max_discount_minor: null,
    starts_at: null,
    expires_at: null,
    total_usage_limit: null,
    per_customer_limit: 1,
    first_order_only: false,
    active: true,
  };
  const input = {
    subtotalMinor: 100000,
    userId: null as string | null,
    phone: "01712345678",
    totalRedemptions: 0,
    customerRedemptions: 0,
    priorOrderCount: 0,
    priorRedemptionsByUser: 0,
    now: new Date("2026-11-15T04:00:00.000Z"),
  };

  it("returns not_found for a missing coupon and never raises", () => {
    expect(evaluateCouponEligibility(null, input)).toEqual({
      valid: false,
      reason: "not_found",
      discount_minor: 0,
    });
    expect(evaluateCouponEligibility(base, { ...input, subtotalMinor: -1 })).toMatchObject({
      valid: false,
      reason: "invalid_request",
    });
  });

  it("checks active, window, minimum and limits in order", () => {
    expect(evaluateCouponEligibility({ ...base, active: false }, input).reason).toBe("inactive");
    expect(
      evaluateCouponEligibility({ ...base, starts_at: "2026-12-01T00:00:00.000Z" }, input).reason,
    ).toBe("not_yet_valid");
    expect(
      evaluateCouponEligibility({ ...base, expires_at: "2026-11-01T00:00:00.000Z" }, input).reason,
    ).toBe("expired");
    expect(evaluateCouponEligibility(base, { ...input, subtotalMinor: 49999 }).reason).toBe(
      "below_minimum",
    );
    expect(
      evaluateCouponEligibility(
        { ...base, total_usage_limit: 2 },
        { ...input, totalRedemptions: 2 },
      ).reason,
    ).toBe("usage_limit_reached");
    expect(
      evaluateCouponEligibility(base, { ...input, customerRedemptions: 1 }).reason,
    ).toBe("per_customer_limit_reached");
  });

  it("requires a signed-in first-time customer for first-order coupons", () => {
    const first = { ...base, first_order_only: true };
    expect(evaluateCouponEligibility(first, input).reason).toBe("first_order_only");
    expect(
      evaluateCouponEligibility(first, { ...input, userId: "22222222-2222-4222-8222-222222222222" })
        .valid,
    ).toBe(true);
    expect(
      evaluateCouponEligibility(first, {
        ...input,
        userId: "22222222-2222-4222-8222-222222222222",
        priorOrderCount: 1,
      }).reason,
    ).toBe("first_order_only");
    expect(
      evaluateCouponEligibility(first, {
        ...input,
        userId: "22222222-2222-4222-8222-222222222222",
        priorRedemptionsByUser: 1,
      }).reason,
    ).toBe("first_order_only");
  });

  it("returns the capped discount when valid", () => {
    expect(evaluateCouponEligibility(base, input)).toEqual({
      valid: true,
      reason: null,
      discount_minor: 10000,
    });
    expect(
      evaluateCouponEligibility({ ...base, max_discount_minor: 5000 }, input).discount_minor,
    ).toBe(5000);
  });

  it("treats a null per-customer limit as unlimited", () => {
    expect(
      evaluateCouponEligibility(
        { ...base, per_customer_limit: null },
        { ...input, customerRedemptions: 99 },
      ).valid,
    ).toBe(true);
  });
});

describe("customer aggregation", () => {
  it("groups by phone with totals, recency and account detection", () => {
    const rows = [
      fakeOrder({
        phone: "01712345678",
        customer_name: "Old Name",
        email: "old@example.test",
        total_minor: 10000,
        placed_at: "2026-11-01T04:00:00.000Z",
      }),
      fakeOrder({
        phone: "01712345678",
        customer_name: "New Name",
        email: null,
        user_id: "22222222-2222-4222-8222-222222222222",
        total_minor: 20000,
        placed_at: "2026-11-05T04:00:00.000Z",
      }),
      fakeOrder({
        phone: "01812345678",
        customer_name: "Other",
        total_minor: 5000,
        placed_at: "2026-11-03T04:00:00.000Z",
      }),
    ];
    const summaries = aggregateCustomers(rows);
    expect(summaries).toHaveLength(2);
    const main = summaries.find((s) => s.phone === "01712345678");
    expect(main).toMatchObject({
      name: "New Name",
      email: "old@example.test",
      orderCount: 2,
      totalSpentMinor: 30000,
      hasAccount: true,
      firstOrderAt: "2026-11-01T04:00:00.000Z",
      lastOrderAt: "2026-11-05T04:00:00.000Z",
    });
    const other = summaries.find((s) => s.phone === "01812345678");
    expect(other).toMatchObject({ orderCount: 1, totalSpentMinor: 5000, hasAccount: false });
  });

  it("sorts by spent, orders and recency", () => {
    const summaries = aggregateCustomers([
      fakeOrder({ phone: "01711111111", total_minor: 1000, placed_at: "2026-11-01T04:00:00.000Z" }),
      fakeOrder({ phone: "01722222222", total_minor: 9000, placed_at: "2026-11-02T04:00:00.000Z" }),
      fakeOrder({ phone: "01722222222", total_minor: 1000, placed_at: "2026-11-03T04:00:00.000Z" }),
    ]);
    expect(sortCustomerSummaries(summaries, "spent")[0]?.phone).toBe("01722222222");
    expect(sortCustomerSummaries(summaries, "orders")[0]?.phone).toBe("01722222222");
    expect(sortCustomerSummaries(summaries, "recent")[0]?.phone).toBe("01722222222");
  });

  it("validates Bangladeshi mobile numbers strictly", () => {
    expect(isValidBdPhone("01712345678")).toBe(true);
    expect(isValidBdPhone("01912345678")).toBe(true);
    expect(isValidBdPhone("01112345678")).toBe(false);
    expect(isValidBdPhone("+8801712345678")).toBe(false);
    expect(isValidBdPhone("0171234567")).toBe(false);
    expect(isValidBdPhone("")).toBe(false);
    expect(isValidBdPhone(null)).toBe(false);
  });
});

describe("incomplete checkout helpers", () => {
  it("labels progress honestly", () => {
    expect(checkoutProgressLabel({ customer_name: "A", phone: "01712345678" }, 2)).toBe(
      "Reached checkout — delivery details saved",
    );
    expect(checkoutProgressLabel({ customer_name: "A", phone: "01712345678" }, 0)).toBe(
      "Checkout started",
    );
    expect(checkoutProgressLabel({ customer_name: "", phone: "" }, 2)).toBe("Checkout started");
  });

  it("sums snapshot values", () => {
    expect(
      sessionValue([
        { unit_price_minor: 50000, quantity: 2 },
        { unit_price_minor: 10000, quantity: 1 },
      ]),
    ).toBe(110000);
    expect(sessionValue([])).toBe(0);
  });

  it("never offers Recovered as a manual action", () => {
    expect(manualRecoveryOptions("pending")).toEqual(["contacted", "lost"]);
    expect(manualRecoveryOptions("contacted")).toEqual(["lost"]);
    expect(manualRecoveryOptions("lost")).toEqual([]);
    expect(manualRecoveryOptions("recovered")).toEqual([]);
  });
});

describe("search and CSV helpers", () => {
  it("escapes LIKE wildcards literally", () => {
    expect(escapeLikePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });

  it("escapes CSV cells per RFC 4180 via the shared helper", () => {
    const csv = toCsv(["Name", "Note"], [["A, B", 'He said "hi"\nbye']]);
    expect(csv).toContain('"A, B"');
    expect(csv).toContain('"He said ""hi""\nbye"');
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("exports orders without SKUs or internal ids", () => {
    const csv = ordersToCsv([
      {
        order_number: 10001,
        placed_at: "2026-11-10T04:00:00.000Z",
        customer_name: "Test, Customer",
        phone: "01712345678",
        status: "pending",
        payment_status: "unpaid",
        subtotal_minor: 100000,
        delivery_charge_minor: 8000,
        discount_minor: 0,
        total_minor: 108000,
      },
    ]);
    expect(csv).toContain("Order number");
    expect(csv).not.toMatch(/sku/i);
    expect(csv).toContain('"Test, Customer"');
    expect(csv).toContain("1080.00");
  });

  it("exports customers with account and blocked flags", () => {
    const csv = customersToCsv([
      {
        phone: "01712345678",
        name: "Test",
        email: null,
        orderCount: 2,
        totalSpentMinor: 30000,
        firstOrderAt: "2026-11-01T04:00:00.000Z",
        lastOrderAt: "2026-11-05T04:00:00.000Z",
        hasAccount: true,
        latestOrderId: "x",
        blocked: true,
      },
    ]);
    expect(csv).toContain("Account");
    expect(csv).toContain("Yes");
    expect(csv).toContain("300.00");
  });
});

describe("coupon code and date helpers", () => {
  it("normalizes codes to upper case", () => {
    expect(normalizeCouponCode("  welcome10 ")).toBe("WELCOME10");
  });

  it("round-trips Dhaka datetime-local values", () => {
    expect(toDatetimeLocal("2026-11-15T04:30:00.000Z")).toBe("2026-11-15T10:30");
    expect(fromDatetimeLocal("2026-11-15T10:30")).toBe("2026-11-15T10:30:00+06:00");
    expect(fromDatetimeLocal("")).toBe(null);
    expect(fromDatetimeLocal("not a date")).toBe(null);
    expect(toDatetimeLocal(null)).toBe("");
  });
});
