import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Courier booking CLAIM tests (review fix M3): the claim row taken
 * before the provider call is what prevents two simultaneous bookings
 * from creating two real parcels. These tests run the real
 * sendOrderToCourier action against a stateful fake database that
 * mirrors the claim RPC semantics in migration 20261116000500
 * (unique claim per order, pending/ambiguous states, 15-minute stale
 * reclaim, ambiguous claims never overwritten) and a stubbed global
 * fetch. No live API and no real database are ever touched: the fetch
 * stub is the only network surface, and it is fully fake.
 *
 * The fake RPCs raise the SAME messages as the SQL functions, so the
 * app's error mapping is exercised exactly as it runs live.
 */

type ClaimRow = { order_id: string; state: "pending" | "ambiguous"; claimed_at: number };

const mocks = vi.hoisted(() => ({
  orders: [] as Record<string, unknown>[],
  items: [] as Record<string, unknown>[],
  shipments: [] as Record<string, unknown>[],
  claims: [] as ClaimRow[],
  claimFails: false,
  recordFails: false,
}));

const CLAIM_IN_PROGRESS = "Courier booking already in progress for this order";
const CLAIM_OUTCOME_UNKNOWN =
  "Courier booking outcome unknown for this order — check the Steadfast portal before trying again";
const STALE_CLAIM_MS = 15 * 60 * 1000;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/admin/supabase", () => {
  function makeBuilder(table: string) {
    const filters: { column: string; value: unknown }[] = [];
    let limit: number | null = null;
    function rowsFor(): Record<string, unknown>[] {
      if (table === "user_roles") return [{ user_id: "owner-1", role: "owner" }];
      if (table === "orders") return mocks.orders;
      if (table === "order_items") return mocks.items;
      if (table === "order_shipments") return mocks.shipments;
      return [];
    }
    function resolved(): Record<string, unknown>[] {
      let rows = rowsFor();
      for (const filter of filters) {
        rows = rows.filter((row) => row[filter.column] === filter.value);
      }
      if (limit !== null) rows = rows.slice(0, limit);
      return rows;
    }
    const builder = {
      select: () => builder,
      order: () => builder,
      in: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push({ column, value });
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      maybeSingle: async () => ({ data: resolved()[0] ?? null, error: null }),
      single: async () => ({ data: resolved()[0] ?? null, error: null }),
      then: (
        onFulfilled?: (value: { data: unknown; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve({ data: resolved(), error: null }).then(onFulfilled, onRejected),
    };
    return builder;
  }

  function rpcError(message: string) {
    return { data: null, error: { message } };
  }

  // Mirrors migration 20261116000500 (claim RPCs) + 20261116000200
  // (record RPC). Each handler runs synchronously (no awaits), so a
  // claim check + insert is atomic — concurrent action calls interleave
  // only BETWEEN rpc calls, exactly like separate PostgREST requests.
  async function fakeRpc(fn: string, args: Record<string, unknown>) {
    const orderId = args.p_order_id as string;
    if (fn === "admin_claim_courier_booking") {
      if (mocks.claimFails) return rpcError("function admin_claim_courier_booking does not exist");
      const order = mocks.orders.find((row) => row.id === orderId);
      if (!order) return rpcError("Order not found");
      if (order.status !== "confirmed" && order.status !== "packed") {
        return rpcError("Order cannot be sent to the courier from its current status");
      }
      if (mocks.shipments.some((row) => row.order_id === orderId)) {
        return rpcError("Order has already been sent to the courier");
      }
      mocks.claims = mocks.claims.filter(
        (claim) =>
          !(
            claim.order_id === orderId &&
            claim.state === "pending" &&
            claim.claimed_at < Date.now() - STALE_CLAIM_MS
          ),
      );
      const existing = mocks.claims.find((claim) => claim.order_id === orderId);
      if (existing) {
        return rpcError(existing.state === "ambiguous" ? CLAIM_OUTCOME_UNKNOWN : CLAIM_IN_PROGRESS);
      }
      mocks.claims.push({ order_id: orderId, state: "pending", claimed_at: Date.now() });
      return { data: "66666666-6666-4666-8666-666666666666", error: null };
    }
    if (fn === "admin_record_shipment") {
      if (mocks.recordFails) return rpcError("record save unavailable");
      const order = mocks.orders.find((row) => row.id === orderId);
      if (!order) return rpcError("Order not found");
      if (order.status !== "confirmed" && order.status !== "packed") {
        return rpcError("Order cannot be sent to the courier from its current status");
      }
      if (mocks.shipments.some((row) => row.order_id === orderId)) {
        return rpcError("Order has already been sent to the courier");
      }
      mocks.shipments.push({
        id: "77777777-7777-4777-8777-777777777777",
        order_id: orderId,
        consignment_id: args.p_consignment_id,
        tracking_code: args.p_tracking_code,
        invoice: args.p_invoice,
        provider_status: args.p_provider_status ?? null,
        booked_by: null,
        booked_at: "2026-11-16T07:00:00.000Z",
        created_at: "2026-11-16T07:00:00.000Z",
      });
      return { data: "77777777-7777-4777-8777-777777777777", error: null };
    }
    if (fn === "admin_release_courier_booking_claim") {
      const existing = mocks.claims.find((claim) => claim.order_id === orderId);
      if (existing?.state === "ambiguous") return rpcError(CLAIM_OUTCOME_UNKNOWN);
      mocks.claims = mocks.claims.filter((claim) => claim.order_id !== orderId);
      return { data: null, error: null };
    }
    if (fn === "admin_mark_courier_booking_claim_ambiguous") {
      const existing = mocks.claims.find(
        (claim) => claim.order_id === orderId && claim.state === "pending",
      );
      if (existing) existing.state = "ambiguous";
      return { data: null, error: null };
    }
    if (fn === "admin_clear_ambiguous_courier_booking_claim") {
      const existing = mocks.claims.find((claim) => claim.order_id === orderId);
      if (existing?.state === "pending") return rpcError(CLAIM_IN_PROGRESS);
      mocks.claims = mocks.claims.filter((claim) => claim.order_id !== orderId);
      return { data: null, error: null };
    }
    return rpcError(`unknown RPC in courier-claim tests: ${fn}`);
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
      rpc: fakeRpc,
    }),
    adminConfiguration: () => null,
  };
});

import { mapClaimError, sendOrderToCourier } from "../src/lib/admin/courier";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function seedOrder(status = "packed") {
  mocks.orders = [
    {
      id: ORDER_ID,
      order_number: 10001,
      user_id: null,
      customer_name: "Test Customer",
      phone: "01712345678",
      email: "test@example.invalid",
      division: "Dhaka",
      district: "Dhaka",
      area: "Mirpur",
      address_line: "House 1, Road 2",
      note: "Call before delivery.",
      payment_method: "cod",
      payment_status: "unpaid",
      status,
      subtotal_minor: 100000,
      delivery_charge_minor: 8000,
      discount_minor: 0,
      total_minor: 108000,
      placed_at: "2026-11-10T04:00:00.000Z",
      created_at: "2026-11-10T04:00:00.000Z",
      updated_at: "2026-11-10T04:00:00.000Z",
    },
  ];
  mocks.items = [
    {
      id: "22222222-2222-4222-8222-222222222222",
      order_id: ORDER_ID,
      product_id: "33333333-3333-4333-8333-333333333333",
      variant_id: "44444444-4444-4444-8444-444444444444",
      product_name: "Vintage Cotton Shirt",
      size: "M",
      color: "Maroon",
      unit_price_minor: 50000,
      quantity: 2,
      line_total_minor: 100000,
      created_at: "2026-11-10T04:00:00.000Z",
    },
  ];
}

function bookForm() {
  const form = new FormData();
  form.set("id", ORDER_ID);
  return form;
}

/** Stubbed provider: never the live API. Returns the fetch spy. */
function stubProvider(
  respond: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>,
) {
  const spy = vi.fn(respond);
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}

function successResponse() {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      status: 200,
      consignment: { consignment_id: 1424107, tracking_code: "15BAEB8A", status: "in_review" },
    }),
  });
}

beforeEach(() => {
  mocks.orders = [];
  mocks.items = [];
  mocks.shipments = [];
  mocks.claims = [];
  mocks.claimFails = false;
  mocks.recordFails = false;
  seedOrder();
  vi.stubEnv("STEADFAST_API_KEY", "placeholder-api-key-for-tests");
  vi.stubEnv("STEADFAST_SECRET_KEY", "placeholder-secret-key-for-tests");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("claim lifecycle through sendOrderToCourier", () => {
  it("books through the claim: success finalizes the shipment and releases the claim", async () => {
    const fetchSpy = stubProvider(successResponse);
    const result = await sendOrderToCourier(null, bookForm());
    expect(result).toEqual({
      ok: true,
      message: expect.stringContaining("Tracking code 15BAEB8A"),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mocks.shipments).toHaveLength(1);
    expect(mocks.shipments[0]).toMatchObject({
      order_id: ORDER_ID,
      consignment_id: "1424107",
      tracking_code: "15BAEB8A",
    });
    expect(mocks.claims).toEqual([]);

    // A repeat attempt is refused by the booked-state probe, without
    // calling the provider again.
    const repeat = await sendOrderToCourier(null, bookForm());
    expect(repeat.ok).toBe(false);
    if (!repeat.ok) {
      expect(repeat.error).toContain("already sent to Steadfast");
      expect(repeat.error).toContain("15BAEB8A");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a pending claim refuses a second booking before any provider call", async () => {
    mocks.claims = [{ order_id: ORDER_ID, state: "pending", claimed_at: Date.now() }];
    const fetchSpy = stubProvider(successResponse);
    const result = await sendOrderToCourier(null, bookForm());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already in progress");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.claims).toHaveLength(1);
  });

  it("two simultaneous bookings create only one parcel", async () => {
    const fetchSpy = stubProvider(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return successResponse();
    });
    const [first, second] = await Promise.all([
      sendOrderToCourier(null, bookForm()),
      sendOrderToCourier(null, bookForm()),
    ]);
    const outcomes = [first, second];
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const refused = outcomes.find((outcome) => !outcome.ok)!;
    if (!refused.ok) expect(refused.error).toContain("already in progress");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mocks.shipments).toHaveLength(1);
    expect(mocks.claims).toEqual([]);
  });

  it("a definite refusal releases the claim so a retry is possible", async () => {
    const fetchSpy = stubProvider(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ status: 400, message: "provider validation detail" }),
    }));
    const refused = await sendOrderToCourier(null, bookForm());
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain("Steadfast did not accept");
      expect(refused.error).not.toContain("provider validation detail");
    }
    // No parcel exists: the claim is gone, so staff can fix and retry.
    expect(mocks.claims).toEqual([]);

    fetchSpy.mockImplementation(successResponse);
    const retried = await sendOrderToCourier(null, bookForm());
    expect(retried.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mocks.shipments).toHaveLength(1);
  });

  it("an ambiguous failure marks the claim and blocks a blind retry", async () => {
    const fetchSpy = stubProvider(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ status: 502, message: "provider server detail" }),
    }));
    const failed = await sendOrderToCourier(null, bookForm());
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toContain("check the Steadfast portal");
      expect(failed.error).not.toContain("provider server detail");
    }
    expect(mocks.claims).toEqual([
      { order_id: ORDER_ID, state: "ambiguous", claimed_at: expect.any(Number) },
    ]);

    // The retry is refused by the ambiguous claim — the provider is
    // never called a second time, and the claim is not overwritten.
    fetchSpy.mockImplementation(successResponse);
    const retried = await sendOrderToCourier(null, bookForm());
    expect(retried.ok).toBe(false);
    if (!retried.ok) {
      expect(retried.error).toContain("Check the Steadfast portal");
      expect(retried.error).toContain("blocked");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mocks.claims[0]?.state).toBe("ambiguous");
    expect(mocks.shipments).toEqual([]);
  });

  it("a record failure after provider success marks the claim ambiguous", async () => {
    mocks.recordFails = true;
    const fetchSpy = stubProvider(successResponse);
    const result = await sendOrderToCourier(null, bookForm());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The parcel exists: the references travel in the error so the
      // owner reconciles in the portal instead of re-booking.
      expect(result.error).toContain("1424107");
      expect(result.error).toContain("15BAEB8A");
      expect(result.error).toContain("do not book again");
    }
    expect(mocks.claims[0]?.state).toBe("ambiguous");

    mocks.recordFails = false;
    const retried = await sendOrderToCourier(null, bookForm());
    expect(retried.ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a stale pending claim does not block a fresh booking", async () => {
    mocks.claims = [
      { order_id: ORDER_ID, state: "pending", claimed_at: Date.now() - 16 * 60 * 1000 },
    ];
    const fetchSpy = stubProvider(successResponse);
    const result = await sendOrderToCourier(null, bookForm());
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mocks.claims).toEqual([]);
  });

  it("a stale reclaim never touches an ambiguous claim", async () => {
    mocks.claims = [
      { order_id: ORDER_ID, state: "ambiguous", claimed_at: Date.now() - 60 * 60 * 1000 },
    ];
    const fetchSpy = stubProvider(successResponse);
    const result = await sendOrderToCourier(null, bookForm());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Check the Steadfast portal");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.claims[0]?.state).toBe("ambiguous");
  });

  it("refuses before any provider call when the claim RPC is unavailable", async () => {
    mocks.claimFails = true;
    const fetchSpy = stubProvider(successResponse);
    const result = await sendOrderToCourier(null, bookForm());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("could not be started");
      expect(result.error).toContain("No parcel was created");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("claim error mapping", () => {
  it("maps contention, unknown-outcome, booked and status refusals to fixed copy", () => {
    expect(mapClaimError({ message: CLAIM_IN_PROGRESS })).toContain("already in progress");
    expect(mapClaimError({ message: CLAIM_OUTCOME_UNKNOWN })).toContain("Check the Steadfast portal");
    expect(mapClaimError({ message: CLAIM_OUTCOME_UNKNOWN })).toContain("blocked");
    expect(mapClaimError({ message: "Order has already been sent to the courier" })).toContain(
      "already sent to Steadfast",
    );
    expect(
      mapClaimError({ message: "Order cannot be sent to the courier from its current status" }),
    ).toContain("Only Confirmed and Packed orders");
  });

  it("falls back to a safe generic message and never echoes DB text", () => {
    expect(mapClaimError({ message: "weird internal detail 42" })).toContain("No parcel was created");
    expect(mapClaimError({ message: "weird internal detail 42" })).not.toContain("weird internal");
    expect(mapClaimError(null)).toContain("No parcel was created");
    expect(mapClaimError(undefined)).toContain("No parcel was created");
  });
});

describe("claim wiring (source pins)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");

  it("the action claims before the provider call and releases/marks after", () => {
    const source = readFileSync(join(root, "src/lib/admin/courier.ts"), "utf8");
    expect(source).toContain("admin_claim_courier_booking");
    expect(source).toContain("admin_release_courier_booking_claim");
    expect(source).toContain("admin_mark_courier_booking_claim_ambiguous");
    expect(source).toContain("CLAIM before the provider call");
    // The claim step precedes the provider call in the action body.
    expect(source.indexOf("claimCourierBooking(session.client")).toBeLessThan(
      source.indexOf("createSteadfastConsignment({ config, payload })"),
    );
  });

  it("no longer claims the probe + unique constraint prevent concurrent duplicate parcels", () => {
    const source = readFileSync(join(root, "src/lib/admin/courier.ts"), "utf8");
    expect(source).not.toContain("enforce the same rule if two staff book at once");
    expect(source).toContain("does NOT serialize concurrent attempts");
  });
});
