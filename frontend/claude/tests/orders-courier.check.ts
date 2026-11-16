import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORDER_ITEM_COLUMNS,
  isLegalPaymentTransition,
  isLegalTransition,
  isStalePendingOrder,
  legalPaymentTransitions,
  orderItemRowSchema,
  selectSkippedShippedOrders,
  selectSweepableOrders,
  type OrderRow,
} from "../src/lib/admin/orders";
import { PAYMENT_STATUSES, PAYMENT_TRANSITIONS, type PaymentStatus } from "../src/lib/admin/constants";
import { SAMPLE_ORDER_DETAIL } from "../src/lib/admin/sample-sales";

async function migrationSql(filename: string): Promise<string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  return readFile(join(root, "supabase", "migrations", filename), "utf8");
}

describe("payment transitions (coordinator decision table)", () => {
  it("offers exactly the legal moves per status", () => {
    expect(PAYMENT_TRANSITIONS).toEqual({
      unpaid: ["paid", "refunded"],
      paid: ["refunded"],
      refunded: [],
    });
    expect(legalPaymentTransitions("unpaid")).toEqual(["paid", "refunded"]);
    expect(legalPaymentTransitions("paid")).toEqual(["refunded"]);
    expect(legalPaymentTransitions("refunded")).toEqual([]);
  });

  it("forbids paid -> unpaid and every move out of refunded", () => {
    expect(isLegalPaymentTransition("unpaid", "paid")).toBe(true);
    expect(isLegalPaymentTransition("unpaid", "refunded")).toBe(true);
    expect(isLegalPaymentTransition("paid", "refunded")).toBe(true);
    expect(isLegalPaymentTransition("paid", "unpaid")).toBe(false);
    expect(isLegalPaymentTransition("refunded", "unpaid")).toBe(false);
    expect(isLegalPaymentTransition("refunded", "paid")).toBe(false);
    expect(isLegalPaymentTransition("unpaid", "unpaid")).toBe(false);
    expect(isLegalPaymentTransition("paid", "paid")).toBe(false);
    expect(isLegalPaymentTransition("refunded", "refunded")).toBe(false);
  });

  it("covers every payment status in the table", () => {
    expect(PAYMENT_STATUSES).toEqual(["unpaid", "paid", "refunded"]);
    for (const status of PAYMENT_STATUSES) {
      expect(Object.keys(PAYMENT_TRANSITIONS)).toContain(status);
      for (const next of legalPaymentTransitions(status as PaymentStatus)) {
        expect(PAYMENT_STATUSES).toContain(next);
      }
    }
  });

  it("keeps the order-transition helpers intact alongside the payment table", () => {
    expect(isLegalTransition("pending", "confirmed")).toBe(true);
    expect(isLegalTransition("pending", "packed")).toBe(false);
    expect(isLegalTransition("cancelled", "confirmed")).toBe(false);
  });
});

describe("migration 20261116000100: admin_set_payment_status RPC", () => {
  it("enforces permission + MFA, optimistic concurrency, the transition table and auditing", async () => {
    const sql = await migrationSql("20261116000100_admin_set_payment_status.sql");
    expect(sql).toContain("create function public.admin_set_payment_status");
    expect(sql).toContain("security definer");
    expect(sql).toContain("perform private.require_admin('orders.manage')");
    expect(sql).toContain("using errcode = 'PT409'");
    expect(sql).toContain("Order changed; reload");
    // The transition table, enforced server-side even for a bypassed client.
    expect(sql).toContain("(o.payment_status = 'unpaid' and new_payment_status in ('paid', 'refunded'))");
    expect(sql).toContain("(o.payment_status = 'paid' and new_payment_status = 'refunded')");
    expect(sql).toContain("Invalid payment status change");
    expect(sql).toContain("'order.payment_status_changed'");
    expect(sql).toContain("insert into public.admin_audit_logs");
    expect(sql).toContain("admin_audit_logs_orders_payment_read");
    expect(sql).toContain("grant execute on function public.admin_set_payment_status(uuid, timestamptz, text) to authenticated");
    expect(/^begin;/m.test(sql)).toBe(true);
    expect(/^commit;/m.test(sql)).toBe(true);
  });

  it("touches no trigger and never redefines has_permission", async () => {
    const sql = await migrationSql("20261116000100_admin_set_payment_status.sql");
    expect(sql.toLowerCase()).not.toContain("create trigger");
    expect(sql).not.toContain("create function private.has_permission");
    expect(sql).not.toContain("create or replace function private.has_permission");
    expect(sql).not.toContain("alter table public.orders");
  });
});

describe("migration 20261116000200: order_shipments + record RPC", () => {
  it("stores shipments in a separate table with uniqueness + booking guards", async () => {
    const sql = await migrationSql("20261116000200_admin_order_shipments.sql");
    expect(sql).toContain("create table public.order_shipments");
    expect(sql).toContain("order_id uuid not null unique");
    expect(sql).toContain("consignment_id text not null unique");
    expect(sql).toContain("tracking_code text not null");
    expect(sql).toContain("payload jsonb not null");
    expect(sql).toContain("create function public.admin_record_shipment");
    expect(sql).toContain("perform private.require_admin('orders.manage')");
    expect(sql).toContain("o.status not in ('confirmed', 'packed')");
    expect(sql).toContain("Order has already been sent to the courier");
    expect(sql).toContain("'order.shipment_recorded'");
    expect(sql).toContain("order_shipments_staff_read");
    expect(sql).toContain("private.has_permission('orders.read')");
    expect(/^begin;/m.test(sql)).toBe(true);
    expect(/^commit;/m.test(sql)).toBe(true);
  });

  it("never adds columns to orders and never touches the guard trigger", async () => {
    const sql = await migrationSql("20261116000200_admin_order_shipments.sql");
    expect(sql).not.toContain("alter table public.orders");
    expect(sql.toLowerCase()).not.toContain("create trigger");
    expect(sql).not.toContain("guard_order_update()");
  });
});

describe("order detail line items: snapshot regression pin", () => {
  it("selects snapshot columns only — never the SKU, never live-catalogue fields", () => {
    const columns = ORDER_ITEM_COLUMNS.split(",");
    expect(columns).toEqual([
      "id",
      "order_id",
      "product_id",
      "variant_id",
      "product_name",
      "size",
      "color",
      "unit_price_minor",
      "quantity",
      "line_total_minor",
      "created_at",
    ]);
    expect(ORDER_ITEM_COLUMNS).not.toContain("sku");
    expect(columns).not.toContain("price_minor");
    expect(columns).not.toContain("sale_price_minor");
    expect(ORDER_ITEM_COLUMNS).not.toContain("products(");
    expect(ORDER_ITEM_COLUMNS).not.toContain("product_variants(");
  });

  it("the item row schema is exactly the snapshot shape", () => {
    expect(Object.keys(orderItemRowSchema.shape).sort()).toEqual(
      [
        "id",
        "order_id",
        "product_id",
        "variant_id",
        "product_name",
        "size",
        "color",
        "unit_price_minor",
        "quantity",
        "line_total_minor",
        "created_at",
      ].sort(),
    );
    expect(orderItemRowSchema.array().safeParse(SAMPLE_ORDER_DETAIL.items).success).toBe(true);
    const item = SAMPLE_ORDER_DETAIL.items[0]!;
    expect(item.product_name).toBeTruthy();
    expect(item.line_total_minor).toBe(item.unit_price_minor * item.quantity);
  });

  it("sample history entries carry the status/payment kind", () => {
    for (const entry of SAMPLE_ORDER_DETAIL.history) {
      expect(["status", "payment"]).toContain(entry.kind);
    }
  });
});

describe("migration 20261116000500: courier booking claims (M3)", () => {
  it("serializes concurrent bookings with a unique pending-claim row taken before the provider call", async () => {
    const sql = await migrationSql("20261116000500_admin_courier_booking_claims.sql");
    expect(sql).toContain("create table public.courier_booking_claims");
    expect(sql).toContain("order_id uuid not null unique");
    expect(sql).toContain("check (state in ('pending', 'ambiguous'))");
    expect(sql).toContain("create function public.admin_claim_courier_booking(p_order_id uuid)");
    expect(sql).toContain("create function public.admin_release_courier_booking_claim(p_order_id uuid)");
    expect(sql).toContain("create function public.admin_mark_courier_booking_claim_ambiguous(p_order_id uuid)");
    expect(sql).toContain("create function public.admin_clear_ambiguous_courier_booking_claim(p_order_id uuid)");
    expect(sql).toContain("perform private.require_admin('orders.manage')");
    expect(sql).toContain("o.status not in ('confirmed', 'packed')");
    expect(sql).toContain("Order has already been sent to the courier");
    expect(sql).toContain("Courier booking already in progress for this order");
    expect(sql).toContain("Courier booking outcome unknown for this order");
    expect(sql).toContain("exception when unique_violation then");
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain("'order.courier_booking_claimed'");
    expect(sql).toContain("'order.courier_booking_claim_ambiguous'");
    expect(sql).toContain("'order.courier_booking_claim_cleared'");
    expect(sql).toContain("admin_audit_logs_orders_claim_read");
    expect(sql).toContain("grant execute on function public.admin_claim_courier_booking(uuid) to authenticated");
    expect(/^begin;/m.test(sql)).toBe(true);
    expect(/^commit;/m.test(sql)).toBe(true);
  });

  it("is additive-only, RPC-only, and never redefines has_permission", async () => {
    const sql = await migrationSql("20261116000500_admin_courier_booking_claims.sql");
    expect(sql.toLowerCase()).not.toContain("drop table");
    expect(sql.toLowerCase()).not.toContain("drop function");
    expect(sql).not.toContain("alter table public.orders");
    expect(sql).not.toContain("create function private.has_permission");
    expect(sql).not.toContain("create or replace function private.has_permission");
    expect(sql).toContain("revoke all on public.courier_booking_claims from public, anon, authenticated");
  });
});

describe("3-hour sweep selection (injectable clock)", () => {
  const NOW = Date.parse("2026-11-16T07:00:00.000Z");
  let counter = 0;
  const order = (placedAt: string, status: OrderRow["status"] = "pending"): OrderRow => {
    counter += 1;
    return {
      id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
      order_number: 10001,
      user_id: null,
      customer_name: "Test",
      phone: "01712345678",
      email: null,
      division: "Dhaka",
      district: "Dhaka",
      area: "Mirpur",
      address_line: "House 1, Road 2",
      note: null,
      payment_method: "cod",
      payment_status: "unpaid",
      status,
      subtotal_minor: 100000,
      delivery_charge_minor: 8000,
      discount_minor: 0,
      total_minor: 108000,
      placed_at: placedAt,
      created_at: placedAt,
      updated_at: placedAt,
    };
  };

  it("keeps a 2h59m-old pending order and sweeps a 3h01m-old one", () => {
    expect(isStalePendingOrder(order("2026-11-16T04:01:00.000Z"), NOW)).toBe(false);
    expect(isStalePendingOrder(order("2026-11-16T03:59:00.000Z"), NOW)).toBe(true);
  });

  it("keeps an order exactly 3 hours old (strict <, matching the SQL)", () => {
    expect(isStalePendingOrder(order("2026-11-16T04:00:00.000Z"), NOW)).toBe(false);
    expect(isStalePendingOrder(order("2026-11-16T03:59:59.999Z"), NOW)).toBe(true);
  });

  it("never sweeps non-pending orders, however old", () => {
    for (const status of ["confirmed", "packed", "shipped", "delivered", "cancelled"] as const) {
      expect(isStalePendingOrder(order("2026-11-01T04:00:00.000Z", status), NOW)).toBe(false);
    }
    expect(isStalePendingOrder(order("not a date"), NOW)).toBe(false);
  });

  it("skips stale orders that already have a shipment record", () => {
    const stale = order("2026-11-16T03:00:00.000Z");
    const fresh = order("2026-11-16T06:00:00.000Z");
    const shipped = new Set([stale.id]);
    expect(selectSweepableOrders([stale, fresh], shipped, NOW)).toEqual([]);
    expect(selectSweepableOrders([stale, fresh], new Set(), NOW)).toEqual([stale]);
    expect(selectSkippedShippedOrders([stale, fresh], shipped, NOW)).toEqual([stale]);
    expect(selectSkippedShippedOrders([fresh], new Set([fresh.id]), NOW)).toEqual([]);
  });
});

describe("migration 20261116000300: 3-hour sweep", () => {
  it("cancels stale pending orders with the transition RPC's restore math, skipping shipped orders", async () => {
    const sql = await migrationSql("20261116000300_admin_unverified_order_sweep.sql");
    expect(sql).toContain("create function private.cancel_stale_pending_orders()");
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("placed_at < clock_timestamp() - interval '3 hours'");
    expect(sql).toContain("for update");
    expect(sql).toContain("update public.orders set status = 'cancelled'");
    expect(sql).toContain("on_hand = on_hand + item.quantity");
    expect(sql).toContain("insert into public.inventory_movements");
    expect(sql).toContain("not exists (select 1 from public.order_shipments");
    expect(sql).toContain("'order.auto_cancelled_unverified'");
    expect(sql).toContain("create function public.admin_preview_unverified_order_sweep()");
    expect(sql).toContain("create function public.admin_run_unverified_order_sweep()");
    expect(sql).toContain("perform private.require_admin('orders.manage')");
    expect(sql).toContain("admin_audit_logs_orders_sweep_read");
    expect(/^begin;/m.test(sql)).toBe(true);
    expect(/^commit;/m.test(sql)).toBe(true);
  });

  it("creates no scheduler and documents the gap honestly", async () => {
    const sql = await migrationSql("20261116000300_admin_unverified_order_sweep.sql");
    expect(sql.toLowerCase()).not.toContain("cron.schedule");
    expect(sql).toContain("SCHEDULER GAP");
    expect(sql).toContain("NO scheduler exists");
    expect(sql).toContain("pg_cron");
  });

  it("counts skipped orders from the same locked pass as the sweep loop (S4)", async () => {
    const sql = await migrationSql("20261116000300_admin_unverified_order_sweep.sql");
    // Scope the assertions to the private sweep function body: the
    // dry-run preview legitimately uses separate counts.
    const body = sql.slice(
      sql.indexOf("create function private.cancel_stale_pending_orders()"),
      sql.indexOf("revoke all on function private.cancel_stale_pending_orders()"),
    );
    expect(body).toContain("skipped := skipped + 1");
    expect(body).toContain("exists (select 1 from public.order_shipments");
    expect(body).not.toContain("select count(*) into skipped");
    // The loop locks every stale pending row; the shipment check
    // happens per locked row, not in a separate pre-loop statement.
    expect(body).not.toContain("not exists (select 1 from public.order_shipments");
  });
});
