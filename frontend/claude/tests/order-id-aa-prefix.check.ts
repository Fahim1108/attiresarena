import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatOrderNumber } from "../src/lib/admin/format";
import { OrdersTable, type OrderListRow } from "../src/components/admin/sales/OrdersTable";
import type { SalesAction } from "../src/components/admin/sales/types";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * Order numbers display as AA-<number> everywhere in the admin UI,
 * never #<number> (invoice numbers already used AA-; the admin
 * displays did not). Null means unknown: the label falls back to
 * "Order" instead of inventing a number.
 */

function row(overrides: Partial<OrderListRow> = {}): OrderListRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    order_number: 10001,
    customer_name: "Firoj Ahamed Fahim",
    phone: "01700000000",
    status: "pending",
    payment_status: "unpaid",
    total_minor: 58000,
    placed_at: "2026-11-19T03:11:00.000Z",
    updated_at: "2026-11-19T03:11:00.000Z",
    ...overrides,
  };
}

function renderTable(rows: OrderListRow[]): string {
  const stubAction: SalesAction = async () => ({ ok: true, message: "stub" });
  return renderToStaticMarkup(
    createElement(OrdersTable, {
      rows,
      exportFilters: { q: "", status: "", payment: "", from: "", to: "", sort: "" },
      bulkAction: stubAction,
      exportAction: async () => ({ ok: false as const, error: "unused" }),
      statusAction: stubAction,
      paymentAction: stubAction,
      courierAction: stubAction,
      shipments: {},
      shipmentsUnavailable: false,
      courierConfigured: false,
    }),
  );
}

describe("order number AA- prefix", () => {
  it("formats a number as AA-<number> and falls back to Order when unknown", () => {
    expect(formatOrderNumber(10001)).toBe("AA-10001");
    expect(formatOrderNumber(10000)).toBe("AA-10000");
    expect(formatOrderNumber(null)).toBe("Order");
    expect(formatOrderNumber(undefined)).toBe("Order");
  });

  it("renders AA-10001 in an admin orders row and never #10001", () => {
    const html = renderTable([row()]);
    expect(html).toContain("AA-10001");
    expect(html).toContain('aria-label="Select order AA-10001"');
    expect(html).not.toContain("#10001");
    // The "View order details" link lives in the expanded card section,
    // which static markup does not open: assert the source wires the same
    // helper into its aria-label.
    const tableSource = readFileSync(
      join(sourceRoot, "components/admin/sales/OrdersTable.tsx"),
      "utf8",
    );
    expect(tableSource).toContain(
      "aria-label={`View order ${row.order_number ? formatOrderNumber(row.order_number) : row.id}`}",
    );
  });

  it("falls back to Order for an unknown order number", () => {
    const html = renderTable([row({ order_number: null })]);
    expect(html).toContain("Order");
    expect(html).not.toContain("AA-");
  });

  it("shows AA-<number> on the customer order-placed confirmation too", () => {
    const formSource = readFileSync(
      join(sourceRoot, "components/checkout/CheckoutForm.tsx"),
      "utf8",
    );
    expect(formSource).toContain(
      "title={`${formatOrderNumber(placed.orderNumber)} received`}",
    );
    expect(formSource).not.toContain("Order #${placed.orderNumber}");
  });
});
