import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mocked staff session + database for readCustomerOrderHistory: the
 * truncation flag depends on how many rows the query FETCHES (the
 * limit), not just on the pure display helper, so the regression test
 * runs the real helper against a fake query layer that honors .limit().
 * Follows the categories-fix.check.ts mock shape.
 */
const mocks = vi.hoisted(() => ({
  orderRows: [] as Record<string, unknown>[],
  seenLimit: null as number | null,
}));

vi.mock("@/lib/admin/supabase", () => {
  function makeBuilder(table: string) {
    const filters: { column: string; value: unknown }[] = [];
    let limit: number | null = null;
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push({ column, value });
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      then: (
        onFulfilled?: (value: { data: unknown; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => {
        if (table === "orders") mocks.seenLimit = limit;
        let rows: unknown[] =
          table === "user_roles"
            ? [{ user_id: "owner-1", role: "owner" }]
            : table === "orders"
              ? mocks.orderRows
              : [];
        for (const filter of filters) {
          rows = rows.filter(
            (row) =>
              typeof row === "object" &&
              row !== null &&
              (row as Record<string, unknown>)[filter.column] === filter.value,
          );
        }
        if (limit !== null) rows = rows.slice(0, limit);
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }
  return {
    adminClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "owner-1", is_anonymous: false } },
          error: null,
        }),
        mfa: {
          getAuthenticatorAssuranceLevel: async () => ({
            data: { currentLevel: "aal2" },
            error: null,
          }),
        },
      },
      from: (table: string) => makeBuilder(table),
      rpc: async () => ({ data: null, error: { message: "RPC unavailable in customer-history tests" } }),
    }),
    adminConfiguration: () => null,
  };
});

import {
  normalizeBdPhoneForHistory,
  previousOrdersForDisplay,
  readCustomerOrderHistory,
} from "../src/lib/admin/customers";
import { areaRoles } from "../src/lib/admin/constants";
import type { OrderRow } from "../src/lib/admin/orders";

function fakeOrder(over: Partial<OrderRow> & { id: string }): OrderRow {
  return {
    order_number: 10001,
    user_id: null,
    customer_name: "Test Customer",
    phone: "01712345678",
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

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";

describe("previous-orders selection", () => {
  it("excludes the current order", () => {
    const rows = [
      fakeOrder({ id: ID_A, order_number: 10001 }),
      fakeOrder({ id: ID_B, order_number: 10002 }),
    ];
    expect(previousOrdersForDisplay(rows, ID_A).map((row) => row.id)).toEqual([ID_B]);
    expect(previousOrdersForDisplay(rows, null)).toHaveLength(2);
  });

  it("sorts newest first with a stable id tie-break", () => {
    const rows = [
      fakeOrder({ id: ID_A, placed_at: "2026-11-01T04:00:00.000Z" }),
      fakeOrder({ id: ID_B, placed_at: "2026-11-05T04:00:00.000Z" }),
      fakeOrder({ id: ID_C, placed_at: "2026-11-05T04:00:00.000Z" }),
    ];
    expect(previousOrdersForDisplay(rows, null).map((row) => row.id)).toEqual([ID_C, ID_B, ID_A]);
  });

  it("caps at the limit (default 10)", () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      fakeOrder({
        id: `44444444-4444-4444-8444-${String(i + 1).padStart(12, "0")}`,
        placed_at: `2026-11-${String(i + 1).padStart(2, "0")}T04:00:00.000Z`,
      }),
    );
    expect(previousOrdersForDisplay(rows, null)).toHaveLength(10);
    expect(previousOrdersForDisplay(rows, null, 3)).toHaveLength(3);
    expect(previousOrdersForDisplay(rows, null, 0)).toEqual([]);
  });

  it("keeps order ids, numbers and totals for the history table", () => {
    const rows = previousOrdersForDisplay(
      [fakeOrder({ id: ID_A, order_number: 10007, total_minor: 253000, status: "delivered" })],
      null,
    );
    expect(rows[0]).toMatchObject({
      id: ID_A,
      order_number: 10007,
      total_minor: 253000,
      status: "delivered",
    });
  });
});

describe("history truncation flag (mocked query layer — M1 regression)", () => {
  const CURRENT_ID = "99999999-9999-4999-8999-999999999999";

  /** Newest-first rows; the current order is the newest (the common case). */
  function historyRows(total: number): OrderRow[] {
    return Array.from({ length: total }, (_, i) =>
      fakeOrder({
        id: i === 0 ? CURRENT_ID : `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`,
        order_number: 10000 + total - i,
        placed_at: `2026-11-${String(15 - i).padStart(2, "0")}T04:00:00.000Z`,
      }),
    );
  }

  beforeEach(() => {
    mocks.orderRows = [];
    mocks.seenLimit = null;
  });

  it("a customer with 15 orders shows the truncation link when viewing the newest order", async () => {
    mocks.orderRows = historyRows(15);
    const result = await readCustomerOrderHistory("01712345678", {
      excludeOrderId: CURRENT_ID,
      area: areaRoles("orders"),
    });
    expect(result.unavailable).toBe(false);
    expect(result.orders).toHaveLength(10);
    expect(result.orders.map((row) => row.id)).not.toContain(CURRENT_ID);
    // The panel gates its "view the full order history" link on this.
    expect(result.truncated).toBe(true);
    // The exclusion removes a fetched row, so the fetch must ask for
    // LIMIT+2 when excluding (12), not LIMIT+1 (11).
    expect(mocks.seenLimit).toBe(12);
  });

  it("reports truncation past the limit when nothing is excluded", async () => {
    mocks.orderRows = historyRows(15);
    const result = await readCustomerOrderHistory("01712345678", {
      area: areaRoles("orders"),
    });
    expect(result.orders).toHaveLength(10);
    expect(result.truncated).toBe(true);
    expect(mocks.seenLimit).toBe(11);
  });

  it("exactly 10 previous orders is complete, not truncated", async () => {
    mocks.orderRows = historyRows(11);
    const result = await readCustomerOrderHistory("01712345678", {
      excludeOrderId: CURRENT_ID,
      area: areaRoles("orders"),
    });
    expect(result.orders).toHaveLength(10);
    expect(result.truncated).toBe(false);
    expect(mocks.seenLimit).toBe(12);
  });

  it("an unmatchable phone returns an honest empty list", async () => {
    mocks.orderRows = historyRows(15);
    const result = await readCustomerOrderHistory("01112345678", {
      excludeOrderId: CURRENT_ID,
      area: areaRoles("orders"),
    });
    expect(result).toEqual({ phone: null, orders: [], truncated: false, unavailable: false });
  });
});

describe("phone normalization for history lookup", () => {
  it("normalizes +88 / 88 prefixes to the strict orders form", () => {
    expect(normalizeBdPhoneForHistory("+8801712345678")).toBe("01712345678");
    expect(normalizeBdPhoneForHistory("8801712345678")).toBe("01712345678");
    expect(normalizeBdPhoneForHistory("01712345678")).toBe("01712345678");
    expect(normalizeBdPhoneForHistory("0171 234 5678")).toBe("01712345678");
    expect(normalizeBdPhoneForHistory("0171-234-5678")).toBe("01712345678");
  });

  it("rejects numbers that cannot be Bangladeshi mobiles", () => {
    expect(normalizeBdPhoneForHistory("01112345678")).toBe(null);
    expect(normalizeBdPhoneForHistory("0171234567")).toBe(null);
    expect(normalizeBdPhoneForHistory("")).toBe(null);
    expect(normalizeBdPhoneForHistory("not a phone")).toBe(null);
  });
});

describe("history panel wiring (source pins)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const read = (path: string) => readFileSync(join(root, path), "utf8");

  it("the shared panel renders order ids as links to order detail pages", () => {
    const panel = read("src/components/admin/sales/CustomerOrderHistoryPanel.tsx");
    expect(panel).toContain("`/admin/sales/orders/${order.id}`");
    expect(panel).toContain("order.order_number ? `#${order.order_number}`");
    expect(panel).toContain("formatDateTime(order.placed_at)");
    expect(panel).toContain("formatMoney(order.total_minor)");
  });

  it("both detail views use the one shared helper + panel", () => {
    for (const page of [
      "src/app/admin/(workspace)/sales/orders/[id]/page.tsx",
      "src/app/admin/(workspace)/sales/incomplete/[id]/page.tsx",
    ]) {
      const source = read(page);
      expect(source).toContain("readCustomerOrderHistory");
      expect(source).toContain("CustomerOrderHistoryPanel");
    }
    const orderPage = read("src/app/admin/(workspace)/sales/orders/[id]/page.tsx");
    expect(orderPage).toContain('area: areaRoles("orders")');
    expect(orderPage).toContain("excludeOrderId: order.id");
    const incompletePage = read("src/app/admin/(workspace)/sales/incomplete/[id]/page.tsx");
    expect(incompletePage).toContain('area: areaRoles("recovery")');
  });

  it("the helper reuses the customer-profile query shape (orders by phone, newest first, bounded)", () => {
    const customers = read("src/lib/admin/customers.ts");
    expect(customers).toContain("readCustomerOrderHistory");
    expect(customers).toContain('.eq("phone", phone)');
    expect(customers).toContain('.order("placed_at", { ascending: false })');
    expect(customers).toContain("CUSTOMER_HISTORY_LIMIT + (options.excludeOrderId ? 2 : 1)");
  });

  it("no page renders history links for sample records", () => {
    const orderPage = read("src/app/admin/(workspace)/sales/orders/[id]/page.tsx");
    expect(orderPage).toContain("!isSample && historyResult");
    const incompletePage = read("src/app/admin/(workspace)/sales/incomplete/[id]/page.tsx");
    expect(incompletePage).toContain("!isSample && historyResult");
  });

  it("unused helper files stay out of the picture: no second history query exists", () => {
    // The shared helper is the only previous-orders query: grep the
    // sales lib for other phone-based order reads outside customers.ts.
    const libDir = join(root, "src/lib/admin");
    const offenders: string[] = [];
    for (const entry of readdirSync(libDir)) {
      if (!entry.endsWith(".ts") || entry === "customers.ts") continue;
      const source = readFileSync(join(libDir, entry), "utf8");
      if (source.includes("readCustomerOrderHistory")) offenders.push(entry);
    }
    expect(offenders).toEqual([]);
    expect(statSync(join(libDir, "customers.ts")).isFile()).toBe(true);
  });
});
