import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readMigration(name: string): string {
  return readFileSync(join(repoRoot, "supabase", "migrations", name), "utf8");
}

const SCHEDULE = readMigration("20261119000200_unverified_order_sweep_schedule.sql");
const SWEEP = readMigration("20261116000300_admin_unverified_order_sweep.sql");
const ORDERS_LIB = readFileSync(
  join(repoRoot, "frontend", "claude", "src", "lib", "admin", "orders.ts"),
  "utf8",
);

/**
 * The scheduled sweep cannot run in tests (no database, no pg_cron), so
 * these are source pins on the migration that creates it: the schedule,
 * the wrapper, and the exact safety properties (same predicate and
 * restore math as the manual sweep, closed to every API role, never
 * touching a booked parcel).
 */
describe("unverified-order sweep schedule (source pin)", () => {
  it("enables pg_cron and schedules the sweep every 15 minutes by a stable name", () => {
    expect(SCHEDULE).toContain("create extension if not exists pg_cron");
    expect(SCHEDULE).toContain("cron.schedule(");
    expect(SCHEDULE).toContain("'attiresarena-unverified-order-sweep'");
    expect(SCHEDULE).toContain("'*/15 * * * *'");
    expect(SCHEDULE).toContain(
      "'select public.run_unverified_order_sweep_scheduled()'",
    );
  });

  it("wraps the existing sweep instead of re-implementing it", () => {
    expect(SCHEDULE).toContain(
      "create function public.run_unverified_order_sweep_scheduled()",
    );
    expect(SCHEDULE).toContain("private.cancel_stale_pending_orders()");
  });

  it("never requires a staff JWT in the scheduled path", () => {
    // The header comment explains WHY the wrapper exists (the manual
    // wrapper needs a staff JWT); the wrapper body itself must not call
    // it — a cron session has no JWT.
    const body = SCHEDULE.slice(
      SCHEDULE.indexOf("create function public.run_unverified_order_sweep_scheduled()"),
    );
    expect(body).not.toContain("require_admin");
    expect(body).not.toContain("has_permission");
  });

  it("closes the wrapper to every API role and grants only postgres (the cron job's role)", () => {
    expect(SCHEDULE).toContain(
      "revoke all on function public.run_unverified_order_sweep_scheduled() from public, anon, authenticated",
    );
    expect(SCHEDULE).toContain(
      "grant execute on function public.run_unverified_order_sweep_scheduled() to postgres",
    );
    expect(SCHEDULE).not.toContain(
      "grant execute on function public.run_unverified_order_sweep_scheduled() to authenticated",
    );
    expect(SCHEDULE).not.toContain(
      "grant execute on function public.run_unverified_order_sweep_scheduled() to service_role",
    );
  });

  it("the swept set is exactly the manual sweep's set: stale pending orders without a shipment", () => {
    expect(SWEEP).toContain("status = 'pending'");
    expect(SWEEP).toContain("placed_at < clock_timestamp() - interval '3 hours'");
    expect(SWEEP).toContain(
      "select 1 from public.order_shipments s where s.order_id = o.id",
    );
  });

  it("the restore math is the manual sweep's math: stock back per item, with a movement row", () => {
    expect(SWEEP).toContain(
      "update public.inventory set on_hand = on_hand + item.quantity",
    );
    expect(SWEEP).toContain("insert into public.inventory_movements");
  });

  it("the app no longer claims no scheduler exists", () => {
    expect(ORDERS_LIB).not.toContain("NO SCHEDULER EXISTS");
    expect(ORDERS_LIB).toContain("attiresarena-unverified-order-sweep");
    expect(ORDERS_LIB).toContain("20261119000200");
  });
});
