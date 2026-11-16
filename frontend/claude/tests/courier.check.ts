import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOOKABLE_ORDER_STATUSES,
  STEADFAST_BASE_URL,
  buildSteadfastAddress,
  buildSteadfastInvoice,
  buildSteadfastItemDescription,
  buildSteadfastPayload,
  canBookCourier,
  createSteadfastConsignment,
  isSteadfastConfigured,
  shipmentRowSchema,
  steadfastConfiguration,
  toShipmentSummary,
  validateSteadfastPayload,
  type SteadfastCreateOrderPayload,
  type SteadfastConfiguration,
} from "../src/lib/admin/courier";
import type { OrderItemRow, OrderRow } from "../src/lib/admin/orders";
import { ORDER_STATUSES, type OrderStatus } from "../src/lib/admin/constants";

/* Placeholder credentials are test fixtures only; they are never real secrets. */
const PLACEHOLDER_CONFIG: SteadfastConfiguration = {
  apiKey: "placeholder-api-key-for-tests",
  secretKey: "placeholder-secret-key-for-tests",
};

function fakeOrder(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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
    status: "packed",
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

function fakeItem(over: Partial<OrderItemRow> = {}): OrderItemRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    order_id: "11111111-1111-4111-8111-111111111111",
    product_id: "33333333-3333-4333-8333-333333333333",
    variant_id: "44444444-4444-4444-8444-444444444444",
    product_name: "Vintage Cotton Shirt",
    size: "M",
    color: "Maroon",
    unit_price_minor: 50000,
    quantity: 2,
    line_total_minor: 100000,
    created_at: "2026-11-10T04:00:00.000Z",
    ...over,
  };
}

describe("steadfast configuration", () => {
  it("reads keys from env vars, trimming whitespace", () => {
    expect(
      steadfastConfiguration({
        STEADFAST_API_KEY: "  placeholder-api-key-for-tests  ",
        STEADFAST_SECRET_KEY: "placeholder-secret-key-for-tests",
      }),
    ).toEqual(PLACEHOLDER_CONFIG);
  });

  it("is null when either key is missing or too short", () => {
    expect(steadfastConfiguration({})).toBe(null);
    expect(
      steadfastConfiguration({ STEADFAST_API_KEY: "placeholder-api-key-for-tests" }),
    ).toBe(null);
    expect(
      steadfastConfiguration({
        STEADFAST_API_KEY: "short",
        STEADFAST_SECRET_KEY: "placeholder-secret-key-for-tests",
      }),
    ).toBe(null);
    expect(isSteadfastConfigured({})).toBe(false);
    expect(
      isSteadfastConfigured({
        STEADFAST_API_KEY: "placeholder-api-key-for-tests",
        STEADFAST_SECRET_KEY: "placeholder-secret-key-for-tests",
      }),
    ).toBe(true);
  });

  it("documents the key names in .env.example with no values", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const example = readFileSync(join(root, ".env.example"), "utf8");
    expect(example).toContain("STEADFAST_API_KEY=\n");
    expect(example).toContain("STEADFAST_SECRET_KEY=\n");
    expect(example).toContain("NO SANDBOX");
  });
});

describe("steadfast payload mapping (order snapshot -> API fields)", () => {
  it("maps every field from the order and item snapshots", () => {
    const payload = buildSteadfastPayload(fakeOrder(), [fakeItem()]);
    expect(payload).toEqual({
      invoice: "AA-10001",
      recipient_name: "Test Customer",
      recipient_phone: "01712345678",
      recipient_address: "House 1, Road 2, Mirpur, Dhaka, Dhaka",
      cod_amount: 1080,
      note: "Call before delivery.",
      delivery_type: 0,
      recipient_email: "test@example.invalid",
      item_description: "Vintage Cotton Shirt (M · Maroon) × 2",
      total_lot: 2,
    });
  });

  it("uses the order id in the invoice when no order number exists yet", () => {
    expect(buildSteadfastInvoice(fakeOrder({ order_number: null }))).toBe(
      "AA-11111111-1111-4111-8111-111111111111",
    );
    expect(buildSteadfastInvoice(fakeOrder())).toBe("AA-10001");
  });

  it("joins the address most-specific-first so truncation drops the division last", () => {
    expect(
      buildSteadfastAddress({
        address_line: "House 1",
        area: "Mirpur",
        district: "Dhaka",
        division: "Dhaka",
      }),
    ).toBe("House 1, Mirpur, Dhaka, Dhaka");
    const long = buildSteadfastAddress({
      address_line: "H".repeat(600),
      area: "Mirpur",
      district: "Dhaka",
      division: "Dhaka",
    });
    expect(long.length).toBe(490);
    expect(long.startsWith("H")).toBe(true);
  });

  it("truncates name, note and item description to the documented limits", () => {
    const payload = buildSteadfastPayload(
      fakeOrder({ customer_name: "N".repeat(150), note: "x".repeat(600) }),
      [fakeItem({ product_name: "P".repeat(300) })],
    );
    expect(payload.recipient_name.length).toBe(100);
    expect(payload.note?.length).toBe(480);
    expect(payload.item_description?.length).toBe(250);
  });

  it("omits optional fields when the order has none", () => {
    const payload = buildSteadfastPayload(
      fakeOrder({ note: null, email: null }),
      [],
    );
    expect(payload.note).toBeUndefined();
    expect(payload.recipient_email).toBeUndefined();
    expect(payload.item_description).toBeUndefined();
    expect(payload.total_lot).toBeUndefined();
    expect(buildSteadfastItemDescription([])).toBeUndefined();
  });

  it("sums quantities across items for total_lot", () => {
    const payload = buildSteadfastPayload(fakeOrder(), [
      fakeItem({ quantity: 1 }),
      fakeItem({ id: "55555555-5555-4555-8555-555555555555", quantity: 3 }),
    ]);
    expect(payload.total_lot).toBe(4);
    expect(payload.item_description).toContain("× 1");
    expect(payload.item_description).toContain("× 3");
  });
});

describe("steadfast payload validation", () => {
  const valid: SteadfastCreateOrderPayload = {
    invoice: "AA-10001",
    recipient_name: "Test Customer",
    recipient_phone: "01712345678",
    recipient_address: "House 1, Mirpur, Dhaka",
    cod_amount: 1080,
    delivery_type: 0,
  };

  it("accepts a well-formed payload", () => {
    expect(validateSteadfastPayload(valid)).toBe(null);
    expect(validateSteadfastPayload(buildSteadfastPayload(fakeOrder(), [fakeItem()]))).toBe(null);
  });

  it("rejects bad invoices, phones, addresses and COD amounts", () => {
    expect(validateSteadfastPayload({ ...valid, invoice: "AA 10001!" })).not.toBe(null);
    expect(validateSteadfastPayload({ ...valid, recipient_phone: "01112345678" })).not.toBe(null);
    expect(validateSteadfastPayload({ ...valid, recipient_phone: "+8801712345678" })).not.toBe(null);
    expect(validateSteadfastPayload({ ...valid, recipient_address: "" })).not.toBe(null);
    expect(validateSteadfastPayload({ ...valid, cod_amount: -1 })).not.toBe(null);
    expect(validateSteadfastPayload({ ...valid, cod_amount: 1_000_001 })).not.toBe(null);
    expect(validateSteadfastPayload({ ...valid, cod_amount: Number.NaN })).not.toBe(null);
    expect(validateSteadfastPayload({ ...valid, note: "x".repeat(481) })).not.toBe(null);
  });
});

describe("courier booking guards", () => {
  it("allows booking only from confirmed and packed", () => {
    expect(BOOKABLE_ORDER_STATUSES).toEqual(["confirmed", "packed"]);
    const expected: Record<OrderStatus, boolean> = {
      pending: false,
      confirmed: true,
      packed: true,
      shipped: false,
      "out-for-delivery": false,
      delivered: false,
      cancelled: false,
      returned: false,
    };
    for (const status of ORDER_STATUSES) {
      expect(canBookCourier(status)).toBe(expected[status]);
    }
  });
});

describe("steadfast sending (stubbed network — never the live API)", () => {
  const payload = buildSteadfastPayload(fakeOrder(), [fakeItem()]);

  it("posts to /create_order with Api-Key/Secret-Key headers and stores the returned references", async () => {
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      calls.push({
        url,
        headers: init?.headers ?? {},
        body: init?.body ? JSON.parse(init.body) : null,
      });
      return {
        ok: true,
        json: async () => ({
          status: 200,
          message: "Consignment has been created successfully.",
          consignment: {
            consignment_id: 1424107,
            invoice: "AA-10001",
            tracking_code: "15BAEB8A",
            status: "in_review",
          },
        }),
      };
    }) as unknown as typeof fetch;
    const result = await createSteadfastConsignment({
      config: PLACEHOLDER_CONFIG,
      payload,
      fetchImpl,
    });
    expect(result).toEqual({
      ok: true,
      consignment: {
        consignmentId: "1424107",
        trackingCode: "15BAEB8A",
        providerStatus: "in_review",
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${STEADFAST_BASE_URL}/create_order`);
    expect(calls[0]!.headers).toEqual({
      "Api-Key": PLACEHOLDER_CONFIG.apiKey,
      "Secret-Key": PLACEHOLDER_CONFIG.secretKey,
      "Content-Type": "application/json",
    });
    expect(calls[0]!.body).toEqual(JSON.parse(JSON.stringify(payload)));
    expect(JSON.stringify(calls[0]!.body)).not.toContain(PLACEHOLDER_CONFIG.apiKey);
  });

  it("accepts a string consignment_id", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({
        status: 200,
        consignment: { consignment_id: "98765", tracking_code: "ABC123" },
      }),
    })) as unknown as typeof fetch;
    const result = await createSteadfastConsignment({ config: PLACEHOLDER_CONFIG, payload, fetchImpl });
    expect(result).toEqual({
      ok: true,
      consignment: { consignmentId: "98765", trackingCode: "ABC123", providerStatus: null },
    });
  });

  it("reports a definite refusal as non-ambiguous, without provider internals", async () => {
    const fetchImpl = (async () => ({
      ok: false,
      json: async () => ({ status: 401, message: "Invalid Api-Key detail" }),
    })) as unknown as typeof fetch;
    const result = await createSteadfastConsignment({ config: PLACEHOLDER_CONFIG, payload, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ambiguous).toBe(false);
      expect(result.error).toContain("Steadfast did not accept");
      expect(result.error).not.toContain("Invalid Api-Key");
      expect(result.error).not.toContain(PLACEHOLDER_CONFIG.apiKey);
      expect(result.error).not.toContain(PLACEHOLDER_CONFIG.secretKey);
    }
  });

  it.each([400, 422])(
    "reports an HTTP %s refusal as a definite (non-ambiguous) refusal",
    async (status) => {
      const fetchImpl = (async () => ({
        ok: false,
        status,
        json: async () => ({ status, message: "provider validation detail" }),
      })) as unknown as typeof fetch;
      const result = await createSteadfastConsignment({
        config: PLACEHOLDER_CONFIG,
        payload,
        fetchImpl,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.ambiguous).toBe(false);
        expect(result.error).toContain("Steadfast did not accept");
        expect(result.error).not.toContain("provider validation detail");
      }
    },
  );

  it.each([500, 502, 504])(
    "treats an HTTP %s as AMBIGUOUS — the parcel may already exist",
    async (status) => {
      const fetchImpl = (async () => ({
        ok: false,
        status,
        json: async () => ({ status, message: "provider server detail" }),
      })) as unknown as typeof fetch;
      const result = await createSteadfastConsignment({
        config: PLACEHOLDER_CONFIG,
        payload,
        fetchImpl,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.ambiguous).toBe(true);
        expect(result.error).toContain("check the Steadfast portal");
        expect(result.error).not.toContain("provider server detail");
      }
    },
  );

  it("reports a provider-level refusal (HTTP 200, status != 200) as non-ambiguous", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ status: 400, message: "Duplicate invoice" }),
    })) as unknown as typeof fetch;
    const result = await createSteadfastConsignment({ config: PLACEHOLDER_CONFIG, payload, fetchImpl });
    expect(result).toMatchObject({ ok: false, ambiguous: false });
  });

  it("treats an unreadable 200 response as ambiguous — the parcel may exist", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ unexpected: "shape" }),
    })) as unknown as typeof fetch;
    const result = await createSteadfastConsignment({ config: PLACEHOLDER_CONFIG, payload, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ambiguous).toBe(true);
      expect(result.error).toContain("check the Steadfast portal");
    }
  });

  it("treats a network failure as ambiguous, without the underlying error", async () => {
    const fetchImpl = (async () => {
      throw new Error("socket hang up with provider detail");
    }) as unknown as typeof fetch;
    const result = await createSteadfastConsignment({ config: PLACEHOLDER_CONFIG, payload, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ambiguous).toBe(true);
      expect(result.error).toContain("check the Steadfast portal");
      expect(result.error).not.toContain("socket hang up");
    }
  });

  it("times out instead of hanging, and reports the timeout as ambiguous", async () => {
    const fetchImpl = ((_: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as unknown as typeof fetch;
    const result = await createSteadfastConsignment({
      config: PLACEHOLDER_CONFIG,
      payload,
      fetchImpl,
      timeoutMs: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ambiguous).toBe(true);
      expect(result.error).toContain("did not respond in time");
    }
  });
});

describe("shipment rows", () => {
  it("parses a stored shipment row", () => {
    const parsed = shipmentRowSchema.safeParse({
      id: "66666666-6666-4666-8666-666666666666",
      order_id: "11111111-1111-4111-8111-111111111111",
      consignment_id: "1424107",
      tracking_code: "15BAEB8A",
      invoice: "AA-10001",
      provider_status: "in_review",
      booked_by: null,
      booked_at: "2026-11-16T07:00:00.000Z",
      created_at: "2026-11-16T07:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("the client-facing summary carries no internal ids", () => {
    const row = shipmentRowSchema.parse({
      id: "66666666-6666-4666-8666-666666666666",
      order_id: "11111111-1111-4111-8111-111111111111",
      consignment_id: "1424107",
      tracking_code: "15BAEB8A",
      invoice: "AA-10001",
      provider_status: "in_review",
      booked_by: "77777777-7777-4777-8777-777777777777",
      booked_at: "2026-11-16T07:00:00.000Z",
      created_at: "2026-11-16T07:00:00.000Z",
    });
    const summary = toShipmentSummary(row);
    expect(Object.keys(summary).sort()).toEqual([
      "booked_at",
      "consignment_id",
      "invoice",
      "provider_status",
      "tracking_code",
    ]);
    expect(JSON.stringify(summary)).not.toContain(row.id);
    expect(JSON.stringify(summary)).not.toContain("77777777");
  });
});
