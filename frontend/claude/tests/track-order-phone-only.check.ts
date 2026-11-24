import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import projects from "@/config/supabase-projects.json";

/**
 * Phone-only track-order suite: the order number is optional, a phone
 * alone lists every order for it (newest first), and the two form
 * fields share one baseline — an error under one field can never push
 * the other field (or the Track button) out of alignment.
 *
 * Covers the app side at the seams that matter: the new guest list
 * RPC call + payload projection, the adapter wiring, the migration
 * text, and the form/page copy + layout pins. All Supabase
 * interaction is mocked and fetch throws by default, so no test can
 * touch the network; the fetch stub routes the tracking list RPC by
 * URL and throws for everything else.
 */

const mocks = vi.hoisted(() => {
  const auth = {
    getUser: vi.fn(),
  };
  return {
    auth,
    createServerClient: vi.fn(),
    from: vi.fn(),
    customerSession: vi.fn(),
  };
});

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {}, get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("@/lib/customer/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/customer/session")>();
  return { ...actual, customerSession: mocks.customerSession };
});

import { dataSource } from "@/services/adapters";
import {
  CUSTOMER_TRACK_ORDERS_RPC,
  trackGuestOrdersByPhone,
} from "@/lib/customer/tracking";

const STAGING_URL = `https://${projects.staging}.supabase.co`;
const FAKE_PUBLISHABLE_KEY = "sb_publishable_fake_test_key_1234567890";
const FAKE_SERVICE_KEY = `eyJ${"x".repeat(40)}`;
const ORDER_ID_NEW = "22222222-3333-4444-8555-666666666666";
const ORDER_ID_OLD = "77777777-8888-4999-8111-000000000000";
const PRODUCT_ID = "44444444-5555-4666-8777-888888888888";
const VARIANT_ID = "99999999-8888-4777-8666-555555555555";

const orderRowNew = {
  id: ORDER_ID_NEW,
  order_number: 10011,
  customer_name: "Fahim",
  phone: "01712345678",
  email: "customer@example.com",
  division: "Dhaka",
  district: "Dhaka",
  area: "Dhanmondi",
  address_line: "House 1, Road 1",
  payment_method: "cod",
  payment_status: "unpaid",
  status: "confirmed",
  subtotal_minor: 150000,
  delivery_charge_minor: 6000,
  discount_minor: 0,
  total_minor: 156000,
  placed_at: "2026-11-21T10:00:00.000Z",
};
const orderRowOld = {
  ...orderRowNew,
  id: ORDER_ID_OLD,
  order_number: 10009,
  status: "delivered",
  total_minor: 63000,
  placed_at: "2026-11-19T10:00:00.000Z",
};
const itemRow = {
  id: "33333333-4444-4555-8666-777777777777",
  order_id: ORDER_ID_NEW,
  product_id: PRODUCT_ID,
  variant_id: VARIANT_ID,
  product_name: "Check shirt",
  size: "M",
  color: "Blue",
  unit_price_minor: 150000,
  quantity: 1,
  line_total_minor: 150000,
  created_at: "2026-11-21T10:00:00.000Z",
};
const listPayload = [
  { order: orderRowNew, items: [itemRow] },
  { order: orderRowOld, items: [] },
];

type FetchCall = { url: string; init: { body?: string } };
const fetchCalls: FetchCall[] = [];

function stubFetchForList(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      fetchCalls.push({ url: String(url), init: { body: init?.body } });
      if (String(url).includes(`/rest/v1/rpc/${CUSTOMER_TRACK_ORDERS_RPC}`)) {
        return { ok: true, json: async () => payload };
      }
      throw new Error("network disabled in tests");
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  fetchCalls.length = 0;
  mocks.createServerClient.mockImplementation(() => ({ auth: mocks.auth, from: mocks.from }));
  mocks.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.customerSession.mockResolvedValue(null);
  vi.stubEnv("SUPABASE_URL", STAGING_URL);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", FAKE_PUBLISHABLE_KEY);
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (): Promise<never> => {
      throw new Error("network disabled in tests");
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("guest list seam (trackGuestOrdersByPhone)", () => {
  const stubRpc = vi.fn();

  beforeEach(() => {
    stubRpc.mockReset();
  });

  it("returns the projected orders, newest first, on a phone match", async () => {
    stubRpc.mockResolvedValue({ ok: true, data: listPayload });
    const orders = await trackGuestOrdersByPhone(stubRpc as never, "01712345678", new Map());
    expect(stubRpc).toHaveBeenCalledWith(CUSTOMER_TRACK_ORDERS_RPC, {
      p_phone: "01712345678",
    });
    expect(orders).toHaveLength(2);
    expect(orders[0]?.orderNumber).toBe("10011");
    expect(orders[0]?.status).toBe("confirmed");
    expect(orders[0]?.lines).toHaveLength(1);
    expect(orders[0]?.lines[0]?.name).toBe("Check shirt");
    expect(orders[0]?.summary.total).toBe(1560);
    expect(orders[1]?.orderNumber).toBe("10009");
    expect(orders[1]?.status).toBe("delivered");
    expect(orders[0]).not.toHaveProperty("courier");
  });

  it("returns [] on a miss, a failed call, or a malformed payload", async () => {
    stubRpc.mockResolvedValue({ ok: true, data: [] });
    expect(await trackGuestOrdersByPhone(stubRpc as never, "01712345678", new Map())).toEqual([]);
    stubRpc.mockResolvedValue({ ok: true, data: null });
    expect(await trackGuestOrdersByPhone(stubRpc as never, "01712345678", new Map())).toEqual([]);
    stubRpc.mockResolvedValue({ ok: false, code: "42501" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await trackGuestOrdersByPhone(stubRpc as never, "01712345678", new Map())).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
    stubRpc.mockResolvedValue({ ok: true, data: [{ order: { ...orderRowNew, status: "mystery" }, items: [] }] });
    expect(await trackGuestOrdersByPhone(stubRpc as never, "01712345678", new Map())).toEqual([]);
    stubRpc.mockResolvedValue({ ok: true, data: [{ order: orderRowNew }] });
    expect(await trackGuestOrdersByPhone(stubRpc as never, "01712345678", new Map())).toEqual([]);
    stubRpc.mockResolvedValue({ ok: true, data: { order: orderRowNew, items: [] } });
    expect(await trackGuestOrdersByPhone(stubRpc as never, "01712345678", new Map())).toEqual([]);
  });

  it("never calls the database with a non-canonical phone", async () => {
    expect(await trackGuestOrdersByPhone(stubRpc as never, "0171234567", new Map())).toEqual([]);
    expect(await trackGuestOrdersByPhone(stubRpc as never, "", new Map())).toEqual([]);
    expect(await trackGuestOrdersByPhone(stubRpc as never, "+8801712345678", new Map())).toEqual([]);
    expect(stubRpc).not.toHaveBeenCalled();
  });
});

describe("adapter: phone-only list through getOrdersByPhone", () => {
  it("returns [] without a phone, without any network call", async () => {
    const fetchSpy = vi.fn(async (): Promise<never> => {
      throw new Error("network disabled in tests");
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await dataSource.getOrdersByPhone("")).toEqual([]);
    expect(await dataSource.getOrdersByPhone("0171234567")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] with a phone when the tracking credential is unconfigured", async () => {
    const fetchSpy = vi.fn(async (): Promise<never> => {
      throw new Error("network disabled in tests");
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await dataSource.getOrdersByPhone("01712345678")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the orders on a phone match, sending the canonical phone", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", FAKE_SERVICE_KEY);
    stubFetchForList(listPayload);
    const orders = await dataSource.getOrdersByPhone("+8801712345678");
    expect(orders).toHaveLength(2);
    expect(orders[0]?.orderNumber).toBe("10011");
    const listCall = fetchCalls.find((call) => call.url.includes(CUSTOMER_TRACK_ORDERS_RPC));
    expect(listCall).toBeDefined();
    expect(listCall?.url).toBe(`${STAGING_URL}/rest/v1/rpc/${CUSTOMER_TRACK_ORDERS_RPC}`);
    expect(JSON.parse(listCall?.init.body ?? "{}")).toEqual({
      p_phone: "01712345678",
    });
  });

  it("returns [] on a phone mismatch", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", FAKE_SERVICE_KEY);
    stubFetchForList([]);
    expect(await dataSource.getOrdersByPhone("01712345678")).toEqual([]);
    expect(fetchCalls.some((call) => call.url.includes(CUSTOMER_TRACK_ORDERS_RPC))).toBe(true);
  });
});

describe("track-order form pins (optional order number, one baseline)", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const form = readFileSync(
    join(testDir, "..", "src", "components", "account", "TrackOrderForm.tsx"),
    "utf8",
  );

  it("makes the order number optional and the phone the lookup key", () => {
    expect(form).toContain('label="Order Number (optional)"');
    expect(form).toContain('placeholder="e.g. AA-10004"');
    expect(form).not.toContain('setOrderError("Enter your order number")');
    expect(form).toContain('setOrderError("Enter a valid order number, e.g. AA-10004")');
    expect(form).toContain("getOrdersByPhoneAction(phone)");
    expect(form).toContain("getOrderByNumberAction(orderNumber, phone)");
    const phoneStart = form.indexOf('id="track-phone"');
    const phoneBlock = form.slice(phoneStart, form.indexOf("/>", phoneStart));
    expect(phoneBlock).toContain('label="Phone Number"');
    expect(phoneBlock).not.toContain("(optional)");
    expect(phoneBlock).toContain("required");
    expect(form).toContain("isValidBdPhone");
  });

  it("clears each field's error as the user types", () => {
    expect(form).toContain("setOrderNumber(e.target.value); setOrderError(undefined);");
    expect(form).toContain("setPhone(e.target.value); setPhoneError(undefined);");
  });

  it("keeps all three columns on one top baseline with reserved message lines", () => {
    expect(form).toContain("sm:items-start");
    expect(form).not.toContain("sm:items-end");
    const inputBlock = (id: string) => {
      const start = form.indexOf(`id="${id}"`);
      return form.slice(start, form.indexOf("/>", start));
    };
    expect(inputBlock("track-orderNumber")).toContain("reserveMessageSpace");
    expect(inputBlock("track-phone")).toContain("reserveMessageSpace");
    expect(form).toContain('size="md"');
    // The button carries a label-height spacer so its top lines up with the inputs.
    expect(form).toContain('className="block text-xs font-medium text-ink"');
  });

  it("shows every found order with status, items and totals, and a count for the list", () => {
    expect(form).toContain("OrderDetail");
    expect(form).toContain("found for this phone number, newest first");
    expect(form).toContain('"No orders found"');
    expect(form).toContain('"Order not found"');
  });
});

describe("track-order page pins (phone-first copy)", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(
    join(testDir, "..", "src", "app", "(store)", "track-order", "page.tsx"),
    "utf8",
  );

  it("no longer leads with the order number", () => {
    expect(page).not.toContain("Enter the order number from your confirmation message");
    expect(page).toContain("Enter the phone number you ordered with to see all your orders");
    expect(page).toContain("Add an order number to find one specific order");
  });
});

describe("reserved message space pin (Field)", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const field = readFileSync(
    join(testDir, "..", "src", "components", "ui", "Field.tsx"),
    "utf8",
  );

  it("renders a blank message line when asked, so a late error cannot shift the row", () => {
    expect(field).toContain("reserveMessageSpace");
    expect(field).toContain('<p aria-hidden="true" className="text-xs">');
  });
});

describe("phone-only list migration pins (authored-only SQL)", () => {
  const sql = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "supabase",
      "migrations",
      "20261124000100_customer_track_orders_by_phone.sql",
    ),
    "utf8",
  );

  it("adds only the service-role-only list function", () => {
    expect(sql).toContain("create function public.customer_track_orders_by_phone(p_phone text)");
    expect(sql).toContain("security definer");
    expect(sql).toContain("private.normalize_bd_phone");
    expect(sql).toContain("revoke all on function public.customer_track_orders_by_phone(text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.customer_track_orders_by_phone(text) to service_role");
    expect(sql.match(/create function/gi)).toHaveLength(1);
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/alter table/i);
    expect(sql).not.toMatch(/create policy/i);
  });

  it("returns the newest-first list, capped, with the same customer-safe columns", () => {
    expect(sql).toContain("order by o.placed_at desc, o.id desc");
    expect(sql).toContain("limit 50");
    expect(sql).toContain("'order', jsonb_build_object(");
    expect(sql).toContain("'items', (");
    expect(sql).not.toContain("'note',");
    expect(sql).not.toContain("'user_id',");
    expect(sql).not.toContain("'sku',");
    expect(sql).not.toContain("'tracking_code',");
    expect(sql).not.toContain("'consignment_id',");
  });

  it("shares the single-lookup per-phone rate budget", () => {
    expect(sql).toContain("private.consume_checkout_rate('track', 'phone:' || v_phone, interval '1 hour', 30)");
    expect(sql).not.toContain("consume_checkout_rate('track', 'order:'");
  });
});
