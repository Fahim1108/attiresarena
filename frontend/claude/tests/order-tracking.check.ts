import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import projects from "@/config/supabase-projects.json";

/**
 * Guest order-tracking suite. The database function itself is
 * authored-only (never applied here); these tests cover the app side
 * end to end at the seams that matter: number parsing, phone
 * normalisation, the guest RPC call + payload projection, and the
 * adapter's session-first / phone-required wiring. All Supabase
 * interaction is mocked and fetch throws by default, so no test can
 * touch the network; the fetch stub routes the tracking RPC by URL
 * and throws for everything else.
 *
 * NOTE: `customerSession()` (React.cache wrapper) is mocked out in
 * this file so each test can choose signed-in or signed-out
 * deterministically; the cached wrapper can persist across tests.
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
  normalizeTrackingPhone,
  parseCustomerOrderNumber,
} from "@/lib/customer/orders";
import {
  CUSTOMER_TRACK_ORDER_RPC,
  trackGuestOrderByPhone,
} from "@/lib/customer/tracking";

const STAGING_URL = `https://${projects.staging}.supabase.co`;
const FAKE_PUBLISHABLE_KEY = "sb_publishable_fake_test_key_1234567890";
const FAKE_SERVICE_KEY = `eyJ${"x".repeat(40)}`;
const USER_ID = "11111111-2222-4333-8444-555555555555";
const ORDER_ID = "22222222-3333-4444-8555-666666666666";
const PRODUCT_ID = "44444444-5555-4666-8777-888888888888";
const VARIANT_ID = "99999999-8888-4777-8666-555555555555";

const orderRow = {
  id: ORDER_ID,
  order_number: 12345,
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
  placed_at: "2026-11-16T10:00:00.000Z",
};
const itemRow = {
  id: "33333333-4444-4555-8666-777777777777",
  order_id: ORDER_ID,
  product_id: PRODUCT_ID,
  variant_id: VARIANT_ID,
  product_name: "Check shirt",
  size: "M",
  color: "Blue",
  unit_price_minor: 150000,
  quantity: 1,
  line_total_minor: 150000,
  created_at: "2026-11-16T10:00:00.000Z",
};
const trackingPayload = { order: orderRow, items: [itemRow] };

type QuerySpec = { data: unknown; error: unknown };
const queryCalls: Array<{ table: string; method: string; args: unknown[] }> = [];
const tableQueues = new Map<string, QuerySpec[]>();

function makeQuery(table: string): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const chain = (method: string) =>
    (...args: unknown[]) => {
      queryCalls.push({ table, method, args });
      return query;
    };
  query.select = chain("select");
  query.eq = chain("eq");
  query.in = chain("in");
  query.order = chain("order");
  query.limit = chain("limit");
  const terminal = (): QuerySpec => {
    const queue = tableQueues.get(table);
    if (queue && queue.length > 0) return queue.shift() as QuerySpec;
    return { data: null, error: null };
  };
  query.maybeSingle = async () => terminal();
  query.single = async () => terminal();
  query.then = (resolve: (value: QuerySpec) => void, reject?: (reason: unknown) => void) =>
    Promise.resolve(terminal()).then(resolve, reject);
  return query;
}

function setTable(table: string, ...specs: QuerySpec[]) {
  tableQueues.set(table, [...specs]);
}

function fakeUser(overrides: Record<string, unknown> = {}): User {
  return {
    id: USER_ID,
    email: "customer@example.com",
    created_at: "2026-11-16T00:00:00.000Z",
    is_anonymous: false,
    user_metadata: {},
    ...overrides,
  } as unknown as User;
}

function fakeClient() {
  return { auth: mocks.auth, from: mocks.from };
}

function signedIn() {
  mocks.customerSession.mockResolvedValue({ client: fakeClient(), user: fakeUser() });
}

type FetchCall = { url: string; init: { body?: string } };
const fetchCalls: FetchCall[] = [];

function stubFetchForTracking(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      fetchCalls.push({ url: String(url), init: { body: init?.body } });
      if (String(url).includes(`/rest/v1/rpc/${CUSTOMER_TRACK_ORDER_RPC}`)) {
        return { ok: true, json: async () => payload };
      }
      throw new Error("network disabled in tests");
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  queryCalls.length = 0;
  tableQueues.clear();
  fetchCalls.length = 0;
  mocks.createServerClient.mockImplementation(() => fakeClient());
  mocks.from.mockImplementation((table: string) => makeQuery(table));
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

describe("order number parsing (AA- prefix)", () => {
  it("accepts bare numbers and the AA- display form", () => {
    expect(parseCustomerOrderNumber("12345")).toBe(12345);
    expect(parseCustomerOrderNumber("AA-12345")).toBe(12345);
    expect(parseCustomerOrderNumber("aa-12345")).toBe(12345);
    expect(parseCustomerOrderNumber("Aa-12345")).toBe(12345);
    expect(parseCustomerOrderNumber("AA12345")).toBe(12345);
    expect(parseCustomerOrderNumber("  AA-12345  ")).toBe(12345);
    expect(parseCustomerOrderNumber("AA-10000")).toBe(10000);
    expect(parseCustomerOrderNumber("AA-99999")).toBe(99999);
  });

  it("rejects anything else", () => {
    expect(parseCustomerOrderNumber("AA-01234")).toBeNull();
    expect(parseCustomerOrderNumber("AA-1234")).toBeNull();
    expect(parseCustomerOrderNumber("AA-123456")).toBeNull();
    expect(parseCustomerOrderNumber("AA-12a45")).toBeNull();
    expect(parseCustomerOrderNumber("BB-12345")).toBeNull();
    expect(parseCustomerOrderNumber("AA-")).toBeNull();
    expect(parseCustomerOrderNumber("01234")).toBeNull();
    expect(parseCustomerOrderNumber("1234")).toBeNull();
    expect(parseCustomerOrderNumber("123456")).toBeNull();
    expect(parseCustomerOrderNumber("")).toBeNull();
  });
});

describe("tracking phone normalisation (strict stored form)", () => {
  it("normalises the forms a customer can type to the stored form", () => {
    expect(normalizeTrackingPhone("01712345678")).toBe("01712345678");
    expect(normalizeTrackingPhone("+8801712345678")).toBe("01712345678");
    expect(normalizeTrackingPhone("8801712345678")).toBe("01712345678");
    expect(normalizeTrackingPhone("0171 234 5678")).toBe("01712345678");
    expect(normalizeTrackingPhone("0171-234-5678")).toBe("01712345678");
    expect(normalizeTrackingPhone(" 01712345678 ")).toBe("01712345678");
  });

  it("returns null for anything that cannot be a stored phone", () => {
    expect(normalizeTrackingPhone("")).toBeNull();
    expect(normalizeTrackingPhone("0171234567")).toBeNull();
    expect(normalizeTrackingPhone("017123456789")).toBeNull();
    expect(normalizeTrackingPhone("02812345678")).toBeNull();
    expect(normalizeTrackingPhone("01112345678")).toBeNull();
    expect(normalizeTrackingPhone("0171234567a")).toBeNull();
    expect(normalizeTrackingPhone("0171234567\n")).toBeNull();
  });
});

describe("guest lookup seam (trackGuestOrderByPhone)", () => {
  const stubRpc = vi.fn();

  beforeEach(() => {
    stubRpc.mockReset();
  });

  it("returns the projected order on a phone match", async () => {
    stubRpc.mockResolvedValue({ ok: true, data: trackingPayload });
    const order = await trackGuestOrderByPhone(stubRpc as never, 12345, "01712345678", new Map());
    expect(stubRpc).toHaveBeenCalledWith(CUSTOMER_TRACK_ORDER_RPC, {
      p_order_number: 12345,
      p_phone: "01712345678",
    });
    expect(order?.orderNumber).toBe("12345");
    expect(order?.status).toBe("confirmed");
    expect(order?.lines).toHaveLength(1);
    expect(order?.lines[0]?.name).toBe("Check shirt");
    expect(order).not.toHaveProperty("courier");
  });

  it("returns null on a miss, a failed call, or a malformed payload", async () => {
    stubRpc.mockResolvedValue({ ok: true, data: null });
    expect(await trackGuestOrderByPhone(stubRpc as never, 12345, "01712345678", new Map())).toBeNull();
    stubRpc.mockResolvedValue({ ok: false, code: "42501" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await trackGuestOrderByPhone(stubRpc as never, 12345, "01712345678", new Map())).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
    stubRpc.mockResolvedValue({ ok: true, data: { order: { ...orderRow, status: "mystery" }, items: [] } });
    expect(await trackGuestOrderByPhone(stubRpc as never, 12345, "01712345678", new Map())).toBeNull();
    stubRpc.mockResolvedValue({ ok: true, data: { order: orderRow } });
    expect(await trackGuestOrderByPhone(stubRpc as never, 12345, "01712345678", new Map())).toBeNull();
  });

  it("never calls the database with a non-canonical phone", async () => {
    expect(await trackGuestOrderByPhone(stubRpc as never, 12345, "0171234567", new Map())).toBeNull();
    expect(await trackGuestOrderByPhone(stubRpc as never, 12345, "", new Map())).toBeNull();
    expect(stubRpc).not.toHaveBeenCalled();
  });
});

describe("adapter: guest tracking through getOrderByNumber", () => {
  it("returns null without a phone, without any database or network call", async () => {
    const fetchSpy = vi.fn(async (): Promise<never> => {
      throw new Error("network disabled in tests");
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await dataSource.getOrderByNumber("AA-12345")).toBeNull();
    expect(await dataSource.getOrderByNumber("AA-12345", "")).toBeNull();
    expect(await dataSource.getOrderByNumber("AA-12345", "0171234567")).toBeNull();
    expect(queryCalls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null with a phone when the tracking credential is unconfigured", async () => {
    const fetchSpy = vi.fn(async (): Promise<never> => {
      throw new Error("network disabled in tests");
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await dataSource.getOrderByNumber("AA-12345", "01712345678")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null for a malformed order number without any call", async () => {
    const fetchSpy = vi.fn(async (): Promise<never> => {
      throw new Error("network disabled in tests");
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await dataSource.getOrderByNumber("AA-999", "01712345678")).toBeNull();
    expect(await dataSource.getOrderByNumber("BB-12345", "01712345678")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the order on a phone match, sending the canonical phone", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", FAKE_SERVICE_KEY);
    stubFetchForTracking(trackingPayload);
    const order = await dataSource.getOrderByNumber("AA-12345", "+8801712345678");
    expect(order?.orderNumber).toBe("12345");
    expect(order?.status).toBe("confirmed");
    expect(order?.lines).toHaveLength(1);
    expect(order?.lines[0]?.productSlug).toBe("");
    const trackingCall = fetchCalls.find((call) => call.url.includes(CUSTOMER_TRACK_ORDER_RPC));
    expect(trackingCall).toBeDefined();
    expect(trackingCall?.url).toBe(`${STAGING_URL}/rest/v1/rpc/${CUSTOMER_TRACK_ORDER_RPC}`);
    expect(JSON.parse(trackingCall?.init.body ?? "{}")).toEqual({
      p_order_number: 12345,
      p_phone: "01712345678",
    });
  });

  it("returns null on a phone mismatch", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", FAKE_SERVICE_KEY);
    stubFetchForTracking(null);
    expect(await dataSource.getOrderByNumber("AA-12345", "01712345678")).toBeNull();
    expect(fetchCalls.some((call) => call.url.includes(CUSTOMER_TRACK_ORDER_RPC))).toBe(true);
  });
});

describe("adapter: signed-in own order still works without a phone", () => {
  it("returns the own order with no phone and no tracking call", async () => {
    signedIn();
    setTable("orders", { data: orderRow, error: null });
    setTable("order_items", { data: [itemRow], error: null });
    const order = await dataSource.getOrderByNumber("AA-12345");
    expect(order?.orderNumber).toBe("12345");
    expect(order?.status).toBe("confirmed");
    const eqCalls = queryCalls.filter((call) => call.table === "orders" && call.method === "eq");
    expect(eqCalls).toContainEqual({ table: "orders", method: "eq", args: ["user_id", USER_ID] });
    expect(eqCalls).toContainEqual({ table: "orders", method: "eq", args: ["order_number", 12345] });
    expect(fetchCalls.some((call) => call.url.includes(CUSTOMER_TRACK_ORDER_RPC))).toBe(false);
  });

  it("does not return another's order without the matching phone", async () => {
    signedIn();
    setTable("orders", { data: null, error: null });
    expect(await dataSource.getOrderByNumber("AA-12345")).toBeNull();
    expect(fetchCalls.some((call) => call.url.includes(CUSTOMER_TRACK_ORDER_RPC))).toBe(false);
  });

  it("falls through to the phone path for another's order with the matching phone", async () => {
    signedIn();
    setTable("orders", { data: null, error: null });
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", FAKE_SERVICE_KEY);
    stubFetchForTracking(trackingPayload);
    const order = await dataSource.getOrderByNumber("AA-12345", "01712345678");
    expect(order?.orderNumber).toBe("12345");
  });
});

describe("track-order form pins (no disabled button, no unavailable copy)", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const form = readFileSync(
    join(testDir, "..", "src", "components", "account", "TrackOrderForm.tsx"),
    "utf8",
  );

  it("has no disabled Track button and no unavailable notice", () => {
    expect(form).not.toContain("currently unavailable");
    const submitLine = form.split("\n").find((line) => line.includes('type="submit"'));
    expect(submitLine).toBeDefined();
    expect(submitLine).not.toContain("disabled");
    expect(submitLine).toContain("loading={pending}");
  });

  it("requires the phone and validates it before calling the action", () => {
    const phoneLine = form.split("\n").find((line) => line.includes('id="track-phone"'));
    expect(phoneLine).toBeDefined();
    expect(phoneLine).toContain('label="Phone Number"');
    expect(phoneLine).not.toContain("(optional)");
    expect(phoneLine).toContain("required");
    expect(form).toContain("isValidBdPhone");
    expect(form).toContain("getOrderByNumberAction(orderNumber, phone)");
  });
});

describe("guest tracking migration pins (authored-only SQL)", () => {
  const sql = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "supabase",
      "migrations",
      "20261119000500_customer_track_order_by_phone.sql",
    ),
    "utf8",
  );

  it("adds only the service-role-only tracking function", () => {
    expect(sql).toContain("create function public.customer_track_order_by_phone(p_order_number integer, p_phone text)");
    expect(sql).toContain("security definer");
    expect(sql).toContain("private.normalize_bd_phone");
    expect(sql).toContain("revoke all on function public.customer_track_order_by_phone(integer, text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.customer_track_order_by_phone(integer, text) to service_role");
    expect(sql.match(/create function/gi)).toHaveLength(1);
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/alter table/i);
  });

  it("returns only the customer-safe columns (no note, no user id, no SKU)", () => {
    expect(sql).toContain("'payment_method', o.payment_method");
    expect(sql).toContain("'order', jsonb_build_object(");
    expect(sql).toContain("'items', (");
    expect(sql).not.toContain("'note',");
    expect(sql).not.toContain("'user_id',");
    expect(sql).not.toContain("'sku',");
    expect(sql).not.toContain("'tracking_code',");
    expect(sql).not.toContain("'consignment_id',");
  });
});

describe("guest tracking rate-limit migration pins (authored-only SQL)", () => {
  const sql = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "supabase",
      "migrations",
      "20261119001200_guest_tracking_rate_limit.sql",
    ),
    "utf8",
  );

  it("reuses the checkout rate ledger with a separate 'track' action", () => {
    expect(sql).toContain("private.consume_checkout_rate('track', 'order:' || p_order_number::text, interval '1 hour', 10)");
    expect(sql).toContain("private.consume_checkout_rate('track', 'phone:' || v_phone, interval '1 hour', 30)");
    expect(sql).toContain("check (action in ('start', 'write', 'place', 'track'))");
  });

  it("keeps the lookup service-role-only with the same payload and null-on-miss behaviour", () => {
    expect(sql).toContain("create or replace function public.customer_track_order_by_phone(p_order_number integer, p_phone text)");
    expect(sql).toContain("security definer");
    expect(sql).toContain("revoke all on function public.customer_track_order_by_phone(integer, text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.customer_track_order_by_phone(integer, text) to service_role");
    expect(sql).not.toContain("'note',");
    expect(sql).not.toContain("'user_id',");
    expect(sql).not.toContain("'sku',");
  });

  it("drops STABLE (the rate-limit write is a side effect a STABLE function cannot do)", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.customer_track_order_by_phone"));
    expect(fn).not.toMatch(/returns jsonb language plpgsql stable/i);
    expect(fn).toMatch(/returns jsonb language plpgsql security definer/i);
  });

  it("adds no table, no policy, and no other function", () => {
    expect(sql.match(/create or replace function/gi)).toHaveLength(1);
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/create policy/i);
  });
});
