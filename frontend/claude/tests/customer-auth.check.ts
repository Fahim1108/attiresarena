import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import projects from "@/config/supabase-projects.json";

/**
 * Customer auth suite. All Supabase interaction is mocked: @supabase/ssr
 * returns a configurable fake client, next/headers returns a fake cookie
 * jar, next/navigation's redirect throws a marker, and fetch throws by
 * default so no test can touch the network. Fake keys, UUIDs, and
 * phones only — no real credentials anywhere.
 *
 * NOTE: `customerSession()` (React.cache wrapper) is deliberately never
 * called here: the cached result can persist across tests in one file.
 * The uncached `resolveCustomerSession()` is tested directly, plus the
 * customerClient configuration it reads through.
 */

const mocks = vi.hoisted(() => {
  const auth = {
    getUser: vi.fn(),
    getSession: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    signInWithOAuth: vi.fn(),
    exchangeCodeForSession: vi.fn(),
  };
  return {
    auth,
    createServerClient: vi.fn(),
    from: vi.fn(),
    cookieSet: vi.fn(),
    redirect: vi.fn(),
    cookiesThrow: false,
  };
});

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (mocks.cookiesThrow) throw new Error("`cookies` was called outside a request scope.");
    return { getAll: () => [], set: mocks.cookieSet, get: () => undefined };
  },
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { GET as callbackGet } from "@/app/auth/callback/route";
import {
  deleteCustomerAddressAction,
  registerCustomer,
  requestCustomerPasswordReset,
  saveCustomerAddressAction,
  setNewCustomerPassword,
  signInCustomer,
  signInWithGoogle,
  signOutCustomer,
  updateCustomerProfile,
} from "@/lib/customer/actions";
import {
  deleteCustomerAddress,
  projectCustomerAddress,
  readCustomerAddresses,
  saveCustomerAddress,
} from "@/lib/customer/addresses";
import {
  CUSTOMER_ORDER_COLUMNS,
  ORDER_LINE_FALLBACK_IMAGE,
  orderMediaMap,
  parseCustomerOrderNumber,
  projectCustomerOrder,
  readCustomerOrderByNumber,
  readCustomerOrders,
} from "@/lib/customer/orders";
import { customerAuthOrigin, getCustomerAuthOrigin } from "@/lib/customer/origin";
import {
  allowlistedCustomerDestination,
  CUSTOMER_CALLBACK_DESTINATIONS,
  customerCallbackDestination,
} from "@/lib/customer/redirects";
import {
  metadataDisplayName,
  metadataPhone,
  profileSyncPatch,
  readCustomerProfile,
  resolveCustomerSession,
  syncCustomerProfileFromMetadata,
} from "@/lib/customer/session";
import { CUSTOMER_AUTH_COOKIE, customerClient } from "@/lib/customer/supabase";
import {
  customerAddressSchema,
  customerEmailSchema,
  customerNewPasswordSchema,
  customerPhoneSchema,
  customerProfileSchema,
  customerRegisterSchema,
  customerSignInSchema,
  CUSTOMER_PASSWORD_SCHEMA,
  GOOGLE_IDENTITY_CONFLICT_MESSAGE,
  isAlreadyRegisteredError,
  isIdentityConflictText,
  looksLikeBdPhone,
} from "@/lib/customer/validation";
import { placeCheckoutOrder, rpcFor, saveCheckoutProgress } from "@/services/checkout";
import { dataSource } from "@/services/adapters";

const STAGING_URL = `https://${projects.staging}.supabase.co`;
const FAKE_PUBLISHABLE_KEY = "sb_publishable_fake_test_key_1234567890";
const FAKE_SERVICE_KEY = `eyJ${"x".repeat(40)}`;
const USER_ID = "11111111-2222-4333-8444-555555555555";
const ADDRESS_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VARIANT_ID = "99999999-8888-4777-8666-555555555555";

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
  query.update = chain("update");
  query.insert = chain("insert");
  query.delete = chain("delete");
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

function signedIn(userOverrides: Record<string, unknown> = {}) {
  mocks.auth.getUser.mockResolvedValue({ data: { user: fakeUser(userOverrides) }, error: null });
  mocks.auth.getSession.mockResolvedValue({
    data: { session: { access_token: "fake-customer-access-token" } },
    error: null,
  });
}

function stubCustomerEnv() {
  vi.stubEnv("SUPABASE_URL", STAGING_URL);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", FAKE_PUBLISHABLE_KEY);
  vi.stubEnv("SITE_URL", "https://preview.test.invalid");
  // Pin the Vercel branch-origin inputs to empty so an ambient VERCEL_ENV /
  // VERCEL_BRANCH_URL (e.g. Vercel CI) can never leak into tests that read
  // the origin through getCustomerAuthOrigin(); tests that need preview
  // values stub them explicitly after this runs.
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL_BRANCH_URL", "");
}

function stubCheckoutEnv() {
  stubCustomerEnv();
  vi.stubEnv("STAGING_CHECKOUT_ORDERS", "1");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", FAKE_SERVICE_KEY);
}

function redirectDestination(thrown: unknown): string {
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  const prefix = "__redirect__:";
  if (!message.startsWith(prefix)) throw new Error(`expected a redirect, got: ${message}`);
  return message.slice(prefix.length);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookiesThrow = false;
  queryCalls.length = 0;
  tableQueues.clear();
  mocks.redirect.mockImplementation((url: string): never => {
    throw new Error(`__redirect__:${url}`);
  });
  mocks.createServerClient.mockImplementation(() => ({ auth: mocks.auth, from: mocks.from }));
  mocks.from.mockImplementation((table: string) => makeQuery(table));
  mocks.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: null });
  mocks.auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
  mocks.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mocks.auth.updateUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.auth.signOut.mockResolvedValue({ error: null });
  mocks.auth.signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: "" }, error: null });
  mocks.auth.exchangeCodeForSession.mockResolvedValue({ data: { user: null, session: null }, error: null });
  stubCustomerEnv();
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

describe("customer callback destinations (exact-match allowlist)", () => {
  it("allows exactly the documented destinations, including the reset page", () => {
    expect(CUSTOMER_CALLBACK_DESTINATIONS).toEqual([
      "/account",
      "/account/orders",
      "/account/addresses",
      "/account/reset-password",
      "/checkout",
      "/cart",
      "/shop",
      "/",
    ]);
    for (const destination of CUSTOMER_CALLBACK_DESTINATIONS) {
      expect(allowlistedCustomerDestination(destination)).toBe(destination);
      expect(customerCallbackDestination(destination)).toBe(destination);
    }
  });

  it("rejects absolute, protocol-relative, backslash, and query-smuggling values", () => {
    for (const value of [
      "https://evil.test/account",
      "//evil.test/account",
      "\\\\evil.test\\account",
      "/account?next=/admin",
      "/account#section",
      "/account/",
      "/account/orders?x=1",
      "/admin",
      "/account/password",
      "",
      "account",
      " /account",
      "/account ",
    ]) {
      expect(allowlistedCustomerDestination(value)).toBeUndefined();
      expect(customerCallbackDestination(value)).toBe("/account");
    }
  });

  it("defaults to /account for missing or non-string values", () => {
    expect(customerCallbackDestination(undefined)).toBe("/account");
    expect(customerCallbackDestination(null)).toBe("/account");
    expect(allowlistedCustomerDestination(undefined)).toBeUndefined();
    expect(allowlistedCustomerDestination(null)).toBeUndefined();
  });
});

describe("customer auth origin (Preview branch URL, then SITE_URL)", () => {
  const BRANCH_HOST =
    "attires-arena-frontend-preview-git-fea-9734c3-fahim-s-projects1.vercel.app";
  const UNIQUE_HOST =
    "attires-arena-frontend-preview-pqupcdtzf-fahim-s-projects1.vercel.app";
  const OLD_BRANCH_URL =
    "https://attires-arena-frontend-preview-git-fea-6ecbe9-fahim-s-projects1.vercel.app";
  it("accepts a clean https origin and strips a trailing slash", () => {
    expect(customerAuthOrigin({ SITE_URL: "https://preview.test.invalid" })).toBe("https://preview.test.invalid");
    expect(customerAuthOrigin({ SITE_URL: "https://preview.test.invalid/" })).toBe("https://preview.test.invalid");
    expect(customerAuthOrigin({ SITE_URL: "https://example.com:8443" })).toBe("https://example.com:8443");
    expect(customerAuthOrigin({ SITE_URL: "  https://example.com  " })).toBe("https://example.com");
  });

  it("rejects missing, empty, or malformed values", () => {
    expect(customerAuthOrigin({})).toBeNull();
    expect(customerAuthOrigin({ SITE_URL: "" })).toBeNull();
    expect(customerAuthOrigin({ SITE_URL: "not-a-url" })).toBeNull();
    expect(customerAuthOrigin({ SITE_URL: "example.com" })).toBeNull();
    expect(customerAuthOrigin({ SITE_URL: "ftp://example.com" })).toBeNull();
    expect(customerAuthOrigin({ SITE_URL: "https://user:pass@example.com" })).toBeNull();
  });

  it("rejects origins carrying a path, query, or fragment", () => {
    expect(customerAuthOrigin({ SITE_URL: "https://example.com/shop" })).toBeNull();
    expect(customerAuthOrigin({ SITE_URL: "https://example.com?x=1" })).toBeNull();
    expect(customerAuthOrigin({ SITE_URL: "https://example.com#top" })).toBeNull();
  });

  it("rejects http except loopback in development", () => {
    expect(customerAuthOrigin({ SITE_URL: "http://example.com" })).toBeNull();
    expect(customerAuthOrigin({ SITE_URL: "http://example.com", NODE_ENV: "development" })).toBeNull();
    expect(customerAuthOrigin({ SITE_URL: "http://localhost:3000" })).toBeNull();
    expect(customerAuthOrigin({ SITE_URL: "http://localhost:3000", NODE_ENV: "development" })).toBe(
      "http://localhost:3000",
    );
    expect(customerAuthOrigin({ SITE_URL: "http://127.0.0.1:3000", NODE_ENV: "development" })).toBe(
      "http://127.0.0.1:3000",
    );
    expect(customerAuthOrigin({ SITE_URL: "http://[::1]:3000", NODE_ENV: "development" })).toBe(
      "http://[::1]:3000",
    );
  });

  it("reads the live environment through getCustomerAuthOrigin", () => {
    expect(getCustomerAuthOrigin()).toBe("https://preview.test.invalid");
    vi.stubEnv("SITE_URL", "");
    expect(getCustomerAuthOrigin()).toBeNull();
    vi.stubEnv("SITE_URL", "https://example.com/path");
    expect(getCustomerAuthOrigin()).toBeNull();
  });

  it("prefers the Preview branch URL over SITE_URL in preview", () => {
    // The reported bug: SITE_URL names the OLD branch while the
    // deployment is the NEW branch — the branch URL must win, so the
    // OAuth callback returns to the branch the user is actually on.
    expect(
      customerAuthOrigin({
        SITE_URL: OLD_BRANCH_URL,
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: BRANCH_HOST,
      }),
    ).toBe(`https://${BRANCH_HOST}`);
    expect(
      customerAuthOrigin({
        SITE_URL: "https://example.com",
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: BRANCH_HOST,
      }),
    ).toBe(`https://${BRANCH_HOST}`);
    expect(
      customerAuthOrigin({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: BRANCH_HOST }),
    ).toBe(`https://${BRANCH_HOST}`);
    expect(
      customerAuthOrigin({
        SITE_URL: "https://example.com",
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: UNIQUE_HOST,
      }),
    ).toBe(`https://${UNIQUE_HOST}`);
    // Surrounding whitespace is tolerated, mirroring SITE_URL.
    expect(
      customerAuthOrigin({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: `  ${BRANCH_HOST}  ` }),
    ).toBe(`https://${BRANCH_HOST}`);
    // Hostnames are case-insensitive: an uppercase branch value (including
    // an uppercase .VERCEL.APP suffix) normalizes to the lowercase origin.
    expect(
      customerAuthOrigin({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: BRANCH_HOST.toUpperCase() }),
    ).toBe(`https://${BRANCH_HOST}`);
  });

  it("ignores the branch URL outside preview", () => {
    const site = "https://example.com";
    expect(
      customerAuthOrigin({ SITE_URL: site, VERCEL_ENV: "production", VERCEL_BRANCH_URL: BRANCH_HOST }),
    ).toBe(site);
    expect(customerAuthOrigin({ SITE_URL: site, VERCEL_BRANCH_URL: BRANCH_HOST })).toBe(site);
    expect(
      customerAuthOrigin({ SITE_URL: site, VERCEL_ENV: "development", VERCEL_BRANCH_URL: BRANCH_HOST }),
    ).toBe(site);
    expect(
      customerAuthOrigin({ SITE_URL: site, VERCEL_ENV: "Preview", VERCEL_BRANCH_URL: BRANCH_HOST }),
    ).toBe(site);
    // Production with a branch URL but no SITE_URL stays unconfigured.
    expect(
      customerAuthOrigin({ VERCEL_ENV: "production", VERCEL_BRANCH_URL: BRANCH_HOST }),
    ).toBeNull();
  });

  it("falls back to SITE_URL for an invalid branch URL in preview", () => {
    const site = "https://example.com";
    for (const branchUrl of [
      "",
      "   ",
      `https://${BRANCH_HOST}`,
      `${BRANCH_HOST}/auth/callback`,
      `${BRANCH_HOST}?x=1`,
      `${BRANCH_HOST}#top`,
      `user@${BRANCH_HOST}`,
      `${BRANCH_HOST}:8443`,
      `${BRANCH_HOST}\\evil`,
      "foo bar.vercel.app",
      "evil.example.com",
      "attires-arena-frontend-preview-git-fea-9734c3-fahim-s-projects1.vercel.app.evil.com",
      "attires-arena-frontend-preview-git-fea-9734c3-fahim-s-projects1.vercel.appx",
      "vercel.app",
    ]) {
      expect(
        customerAuthOrigin({ SITE_URL: site, VERCEL_ENV: "preview", VERCEL_BRANCH_URL: branchUrl }),
      ).toBe(site);
    }
  });

  it("returns null when neither source is usable", () => {
    expect(customerAuthOrigin({})).toBeNull();
    expect(customerAuthOrigin({ VERCEL_ENV: "preview" })).toBeNull();
    expect(customerAuthOrigin({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "" })).toBeNull();
    expect(
      customerAuthOrigin({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "evil.example.com" }),
    ).toBeNull();
    expect(
      customerAuthOrigin({
        SITE_URL: "https://example.com/path",
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: `${BRANCH_HOST}/auth/callback`,
      }),
    ).toBeNull();
  });

  it("reads the Preview branch URL through getCustomerAuthOrigin", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_BRANCH_URL", BRANCH_HOST);
    expect(getCustomerAuthOrigin()).toBe(`https://${BRANCH_HOST}`);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(getCustomerAuthOrigin()).toBe("https://preview.test.invalid");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_BRANCH_URL", "evil.example.com");
    expect(getCustomerAuthOrigin()).toBe("https://preview.test.invalid");
    vi.stubEnv("VERCEL_BRANCH_URL", "");
    vi.stubEnv("SITE_URL", "");
    expect(getCustomerAuthOrigin()).toBeNull();
  });
});

describe("customer schemas (email-only, 8–128 passwords, BD phone)", () => {
  it("accepts a valid email and rejects phone-shaped or malformed input", () => {
    expect(customerEmailSchema.safeParse("customer@example.com").success).toBe(true);
    expect(customerEmailSchema.safeParse("01712345678").success).toBe(false);
    expect(customerEmailSchema.safeParse("+8801712345678").success).toBe(false);
    expect(customerEmailSchema.safeParse("not-an-email").success).toBe(false);
    expect(customerEmailSchema.safeParse("").success).toBe(false);
  });

  it("enforces 8–128 chars on password creation and 1–128 on sign-in", () => {
    expect(CUSTOMER_PASSWORD_SCHEMA.safeParse("1234567").success).toBe(false);
    expect(CUSTOMER_PASSWORD_SCHEMA.safeParse("12345678").success).toBe(true);
    expect(CUSTOMER_PASSWORD_SCHEMA.safeParse("x".repeat(128)).success).toBe(true);
    expect(CUSTOMER_PASSWORD_SCHEMA.safeParse("x".repeat(129)).success).toBe(false);
    expect(customerRegisterSchema.safeParse({ fullName: "A B", email: "a@b.co", password: "short", phone: "01712345678" }).success).toBe(
      false,
    );
    expect(
      customerRegisterSchema.safeParse({
        fullName: "A B",
        email: "a@b.co",
        password: "long-enough",
        phone: "01712345678",
      }).success,
    ).toBe(true);
    expect(customerNewPasswordSchema.safeParse({ password: "short" }).success).toBe(false);
    expect(customerNewPasswordSchema.safeParse({ password: "long-enough" }).success).toBe(true);
    // Sign-in accepts existing shorter passwords: the creation policy
    // must never lock out an account created under an older policy.
    expect(customerSignInSchema.safeParse({ email: "a@b.co", password: "123456" }).success).toBe(true);
    expect(customerSignInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(customerSignInSchema.safeParse({ email: "a@b.co", password: "x".repeat(129) }).success).toBe(false);
  });

  it("normalizes BD phones to the strict 01[3-9] form and rejects the rest", () => {
    expect(customerPhoneSchema.parse("01712345678")).toBe("01712345678");
    expect(customerPhoneSchema.parse("+8801712345678")).toBe("01712345678");
    expect(customerPhoneSchema.parse("8801712345678")).toBe("01712345678");
    expect(customerPhoneSchema.parse("0171 234 5678")).toBe("01712345678");
    expect(customerPhoneSchema.parse("0171-234-5678")).toBe("01712345678");
    // Phone is required at registration and on saved addresses: the
    // strict form has no empty case.
    expect(customerPhoneSchema.safeParse("").success).toBe(false);
    expect(customerPhoneSchema.safeParse("01212345678").success).toBe(false);
    expect(customerPhoneSchema.safeParse("0171234567").success).toBe(false);
    expect(customerPhoneSchema.safeParse("017123456789").success).toBe(false);
    expect(customerPhoneSchema.safeParse("880171234567").success).toBe(false);
    expect(looksLikeBdPhone("01712345678")).toBe(true);
    expect(looksLikeBdPhone("+8801712345678")).toBe(true);
    expect(looksLikeBdPhone("customer@example.com")).toBe(false);
    expect(looksLikeBdPhone("12345")).toBe(false);
  });

  it("validates profile updates and address rows against divisions", () => {
    expect(customerProfileSchema.safeParse({ fullName: "  ", phone: "01712345678" }).success).toBe(false);
    expect(customerProfileSchema.safeParse({ fullName: "A".repeat(121), phone: "01712345678" }).success).toBe(false);
    expect(customerProfileSchema.safeParse({ fullName: "Fahim", phone: "01234567890" }).success).toBe(false);
    expect(customerProfileSchema.safeParse({ fullName: "Fahim", phone: "01712345678" }).success).toBe(true);
    const address = {
      id: "",
      label: "Home",
      fullName: "Fahim",
      phone: "01712345678",
      division: "Dhaka",
      district: "Dhaka",
      area: "Dhanmondi",
      addressLine: "House 1, Road 1",
      isDefault: true,
    };
    expect(customerAddressSchema.safeParse(address).success).toBe(true);
    expect(customerAddressSchema.safeParse({ ...address, district: "Chattogram" }).success).toBe(false);
    expect(customerAddressSchema.safeParse({ ...address, division: "Nowhere" }).success).toBe(false);
    expect(customerAddressSchema.safeParse({ ...address, id: "not-a-uuid" }).success).toBe(false);
    expect(customerAddressSchema.safeParse({ ...address, id: ADDRESS_ID }).success).toBe(true);
    expect(customerAddressSchema.safeParse({ ...address, addressLine: "short" }).success).toBe(false);
    expect(customerAddressSchema.safeParse({ ...address, phone: "" }).success).toBe(false);
  });

  it("classifies identity-conflict and already-registered errors", () => {
    expect(isIdentityConflictText("identity already exists")).toBe(true);
    expect(isIdentityConflictText("User already registered")).toBe(true);
    expect(isIdentityConflictText("account already exists")).toBe(true);
    expect(isIdentityConflictText("user_already_exists")).toBe(true);
    expect(isIdentityConflictText("network error")).toBe(false);
    expect(isIdentityConflictText("invalid credentials")).toBe(false);
    expect(isAlreadyRegisteredError({ message: "User already registered" })).toBe(true);
    expect(isAlreadyRegisteredError({ code: "user_already_exists", message: "conflict" })).toBe(true);
    expect(isAlreadyRegisteredError({ message: "invalid credentials" })).toBe(false);
    expect(isAlreadyRegisteredError({ message: "user already exists" })).toBe(false);
    expect(isAlreadyRegisteredError({})).toBe(false);
    expect(GOOGLE_IDENTITY_CONFLICT_MESSAGE).toContain("Sign in with your password");
  });
});

describe("customer client configuration", () => {
  it("uses its own cookie name, distinct from the staff session cookie", () => {
    expect(CUSTOMER_AUTH_COOKIE).toBe("aa-customer-auth");
    expect(CUSTOMER_AUTH_COOKIE).not.toBe("aa-admin-auth");
  });

  it("creates the SSR client with the publishable config and hardened cookies", async () => {
    const client = await customerClient();
    expect(client).not.toBeNull();
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = mocks.createServerClient.mock.calls[0] as [
      string,
      string,
      {
        cookieOptions: Record<string, unknown>;
        cookies: { getAll: () => unknown[]; setAll?: unknown };
      },
    ];
    expect(url).toBe(STAGING_URL);
    expect(key).toBe(FAKE_PUBLISHABLE_KEY);
    expect(options.cookieOptions).toMatchObject({
      name: "aa-customer-auth",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    expect(options.cookies.getAll()).toEqual([]);
    expect(options.cookies.setAll).toBeUndefined();
  });

  it("writes cookies only when asked, through the Next cookie store", async () => {
    await customerClient(true);
    const [, , options] = mocks.createServerClient.mock.calls[0] as [
      string,
      string,
      { cookies: { setAll: (values: Array<{ name: string; value: string; options: object }>) => void } },
    ];
    options.cookies.setAll([{ name: "aa-customer-auth.0", value: "fake", options: {} }]);
    expect(mocks.cookieSet).toHaveBeenCalledWith("aa-customer-auth.0", "fake", {});
  });

  it("returns null without configuration and never builds a client", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    expect(await customerClient()).toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("rejects a service-role-shaped key", async () => {
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", `eyJhbGciOiJIUzI1NiJ9.${payload}.fake-signature`);
    expect(await customerClient()).toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("fails closed when cookies() throws outside a request scope", async () => {
    mocks.cookiesThrow = true;
    expect(await customerClient()).toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});

describe("customer session resolution (getUser-only)", () => {
  function fakeAuthClient(result: {
    user: User | null;
    error: { message: string } | null;
  }) {
    return {
      auth: {
        getUser: async () => ({
          data: { user: result.user },
          error: result.error as never,
        }),
      },
    };
  }

  it("resolves a live non-anonymous user", async () => {
    const client = fakeAuthClient({ user: fakeUser(), error: null });
    const resolved = await resolveCustomerSession(client);
    expect(resolved?.user.id).toBe(USER_ID);
    expect(resolved?.client).toBe(client);
  });

  it("rejects errors, missing users, and anonymous users", async () => {
    expect(await resolveCustomerSession(fakeAuthClient({ user: null, error: { message: "boom" } }))).toBeNull();
    expect(await resolveCustomerSession(fakeAuthClient({ user: null, error: null }))).toBeNull();
    expect(
      await resolveCustomerSession(fakeAuthClient({ user: fakeUser({ is_anonymous: true }), error: null })),
    ).toBeNull();
  });
});

describe("profile read + metadata sync (fill empty only, never overwrite)", () => {
  it("reads display name and phone, falling back when the phone column is missing", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    setTable("profiles", { data: { display_name: "Fahim", phone: "01712345678" }, error: null });
    expect(await readCustomerProfile(client, USER_ID)).toEqual({ displayName: "Fahim", phone: "01712345678" });
    const firstSelect = queryCalls.find((call) => call.method === "select");
    expect(firstSelect?.args).toEqual(["display_name, phone"]);

    queryCalls.length = 0;
    setTable(
      "profiles",
      { data: null, error: { message: "column profiles.phone does not exist" } },
      { data: { display_name: "Fahim" }, error: null },
    );
    expect(await readCustomerProfile(client, USER_ID)).toEqual({ displayName: "Fahim", phone: "" });
    expect(queryCalls.filter((call) => call.method === "select").map((call) => call.args[0])).toEqual([
      "display_name, phone",
      "display_name",
    ]);

    setTable(
      "profiles",
      { data: null, error: { message: "boom" } },
      { data: null, error: { message: "boom" } },
    );
    expect(await readCustomerProfile(client, USER_ID)).toEqual({ displayName: "", phone: "" });
  });

  it("derives metadata name/phone with normalization and caps", () => {
    expect(metadataDisplayName({ full_name: "  Fahim Uddin  " })).toBe("Fahim Uddin");
    expect(metadataDisplayName({ name: "Google Name" })).toBe("Google Name");
    expect(metadataDisplayName({ full_name: "First", name: "Second" })).toBe("First");
    expect(metadataDisplayName({ full_name: "x".repeat(200) })).toBe("x".repeat(120));
    expect(metadataDisplayName({ full_name: 42 })).toBe("");
    expect(metadataDisplayName(undefined)).toBe("");
    expect(metadataPhone({ phone: "+8801712345678" })).toBe("01712345678");
    expect(metadataPhone({ phone: "not-a-phone" })).toBe("");
    expect(metadataPhone({})).toBe("");
    expect(metadataPhone(null)).toBe("");
  });

  it("patches only empty fields and never copies anything else", () => {
    const metadata = { full_name: "Meta Name", phone: "01712345678", role: "admin" };
    expect(profileSyncPatch(null, metadata)).toEqual({ display_name: "Meta Name", phone: "01712345678" });
    expect(profileSyncPatch({ display_name: "Existing", phone: null }, metadata)).toEqual({
      phone: "01712345678",
    });
    expect(profileSyncPatch({ display_name: "", phone: "01812345678" }, metadata)).toEqual({
      display_name: "Meta Name",
    });
    expect(profileSyncPatch({ display_name: "Existing", phone: "01812345678" }, metadata)).toEqual({});
    expect(profileSyncPatch({ display_name: "   ", phone: "  " }, metadata)).toEqual({
      display_name: "Meta Name",
      phone: "01712345678",
    });
    expect(profileSyncPatch(null, {})).toEqual({});
  });

  it("syncs a missing row via insert, then fills the phone separately", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    setTable("profiles", { data: null, error: null });
    await syncCustomerProfileFromMetadata(
      client,
      fakeUser({ user_metadata: { full_name: "Meta Name", phone: "+8801712345678" } }),
    );
    const insert = queryCalls.find((call) => call.method === "insert");
    expect(insert?.args).toEqual([{ id: USER_ID, display_name: "Meta Name" }]);
    const update = queryCalls.find((call) => call.method === "update");
    expect(update?.args).toEqual([{ phone: "01712345678" }]);
  });

  it("syncs an existing empty row with split name/phone writes and leaves filled rows alone", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    setTable("profiles", { data: { display_name: "", phone: null }, error: null });
    await syncCustomerProfileFromMetadata(
      client,
      fakeUser({ user_metadata: { full_name: "Meta Name", phone: "01712345678" } }),
    );
    expect(queryCalls.filter((call) => call.method === "update").map((call) => call.args[0])).toEqual([
      { display_name: "Meta Name" },
      { phone: "01712345678" },
    ]);

    queryCalls.length = 0;
    setTable("profiles", { data: { display_name: "Existing", phone: "01812345678" }, error: null });
    await syncCustomerProfileFromMetadata(
      client,
      fakeUser({ user_metadata: { full_name: "Meta Name", phone: "01712345678" } }),
    );
    expect(queryCalls.some((call) => call.method === "update")).toBe(false);
  });

  it("keeps the display-name write when the phone write fails (missing phone column)", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    setTable(
      "profiles",
      { data: { display_name: "", phone: null }, error: null },
      { data: null, error: null },
      { data: null, error: { message: "column profiles.phone does not exist" } },
    );
    await expect(
      syncCustomerProfileFromMetadata(
        client,
        fakeUser({ user_metadata: { full_name: "Meta Name", phone: "01712345678" } }),
      ),
    ).resolves.toBeUndefined();
    expect(queryCalls.filter((call) => call.method === "update").map((call) => call.args[0])).toEqual([
      { display_name: "Meta Name" },
      { phone: "01712345678" },
    ]);
  });

  it("never throws when the sync read fails", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    setTable(
      "profiles",
      { data: null, error: { message: "boom" } },
      { data: null, error: { message: "boom" } },
    );
    await expect(
      syncCustomerProfileFromMetadata(client, fakeUser({ user_metadata: { full_name: "Meta" } })),
    ).resolves.toBeUndefined();
  });
});

describe("customer order projection (no sku, no cost, no courier)", () => {
  const ORDER_ID = "22222222-3333-4444-8555-666666666666";
  const PRODUCT_ID = "44444444-5555-4666-8777-888888888888";
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
  const media = new Map([
    [PRODUCT_ID, { slug: "check-shirt", image: { src: "/img/check.jpg", alt: "Check shirt" } }],
  ]);

  it("selects snapshot columns only and caps history at 50", () => {
    const columns = CUSTOMER_ORDER_COLUMNS.split(",");
    for (const forbidden of ["sku", "user_id", "cost_minor", "courier", "tracking_code", "consignment_id"]) {
      expect(columns).not.toContain(forbidden);
    }
    expect(CUSTOMER_ORDER_COLUMNS).toContain("placed_at");
  });

  it("projects money, timeline, lines, and media from a valid row", () => {
    const order = projectCustomerOrder(orderRow, [itemRow], media);
    expect(order?.orderNumber).toBe("12345");
    expect(order?.status).toBe("confirmed");
    expect(order?.summary).toEqual({
      itemCount: 1,
      subtotal: 1500,
      discount: 0,
      deliveryCharge: 60,
      total: 1560,
    });
    expect(order?.timeline).toEqual([
      { status: "pending", label: "Pending", at: "2026-11-16T10:00:00.000Z" },
      { status: "confirmed", label: "Confirmed" },
    ]);
    expect(order?.lines).toEqual([
      {
        productId: PRODUCT_ID,
        productSlug: "check-shirt",
        name: "Check shirt",
        image: { src: "/img/check.jpg", alt: "Check shirt" },
        colorName: "Blue",
        size: "M",
        quantity: 1,
        unitPrice: 1500,
      },
    ]);
    expect(order?.shippingAddress).toMatchObject({ fullName: "Fahim", division: "Dhaka", label: "" });
    expect(order).not.toHaveProperty("courier");
  });

  it("keeps a pending order to a single timeline event", () => {
    const order = projectCustomerOrder({ ...orderRow, status: "pending" }, [itemRow], media);
    expect(order?.timeline).toEqual([{ status: "pending", label: "Pending", at: "2026-11-16T10:00:00.000Z" }]);
  });

  it("rejects unknown statuses and null order numbers", () => {
    expect(projectCustomerOrder({ ...orderRow, status: "mystery-status" }, [itemRow], media)).toBeNull();
    expect(projectCustomerOrder({ ...orderRow, status: "shipped " }, [itemRow], media)).toBeNull();
    expect(projectCustomerOrder({ ...orderRow, order_number: null }, [itemRow], media)).toBeNull();
    expect(projectCustomerOrder({ ...orderRow, total_minor: "156000" }, [itemRow], media)).toBeNull();
  });

  it("skips bad item rows and other orders' items, and falls back for unpublished products", () => {
    const order = projectCustomerOrder(
      orderRow,
      [itemRow, { nope: true }, { ...itemRow, id: "55555555-6666-4777-8888-999999999999", order_id: VARIANT_ID }],
      new Map(),
    );
    expect(order?.lines).toHaveLength(1);
    expect(order?.lines[0]?.image).toEqual({ ...ORDER_LINE_FALLBACK_IMAGE, alt: "Check shirt" });
    expect(order?.lines[0]?.productSlug).toBe("");
    expect(ORDER_LINE_FALLBACK_IMAGE.src).toBe("/brand/logo-maroon.png");
  });

  it("builds the media map from feed products with a cover image only", () => {
    const map = orderMediaMap([
      { id: PRODUCT_ID, slug: "check-shirt", defaultImages: [{ src: "/img/check.jpg", alt: "Check shirt" }] },
      { id: VARIANT_ID, slug: "no-photo", defaultImages: [] },
    ] as never);
    expect(map.get(PRODUCT_ID)).toEqual({ slug: "check-shirt", image: { src: "/img/check.jpg", alt: "Check shirt" } });
    expect(map.has(VARIANT_ID)).toBe(false);
  });

  it("parses exactly five-digit order numbers in range", () => {
    expect(parseCustomerOrderNumber("12345")).toBe(12345);
    expect(parseCustomerOrderNumber(" 12345 ")).toBe(12345);
    expect(parseCustomerOrderNumber("10000")).toBe(10000);
    expect(parseCustomerOrderNumber("99999")).toBe(99999);
    expect(parseCustomerOrderNumber("01234")).toBeNull();
    expect(parseCustomerOrderNumber("1234")).toBeNull();
    expect(parseCustomerOrderNumber("123456")).toBeNull();
    expect(parseCustomerOrderNumber("12a45")).toBeNull();
    expect(parseCustomerOrderNumber("")).toBeNull();
  });

  it("reads own orders with an explicit user_id filter and newest-first cap", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    setTable("orders", { data: [orderRow], error: null });
    setTable("order_items", { data: [itemRow], error: null });
    const orders = await readCustomerOrders(client, USER_ID, media);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.orderNumber).toBe("12345");
    const eqCalls = queryCalls.filter((call) => call.table === "orders" && call.method === "eq");
    expect(eqCalls).toContainEqual({ table: "orders", method: "eq", args: ["user_id", USER_ID] });
    const limitCalls = queryCalls.filter((call) => call.table === "orders" && call.method === "limit");
    expect(limitCalls).toContainEqual({ table: "orders", method: "limit", args: [50] });
  });

  it("fails closed on order read failures", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      setTable("orders", { data: null, error: { message: "boom" } });
      expect(await readCustomerOrders(client, USER_ID, media)).toEqual([]);
      setTable("orders", { data: [orderRow], error: null });
      setTable("order_items", { data: null, error: { message: "boom" } });
      expect(await readCustomerOrders(client, USER_ID, media)).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("reads one own order by number and returns null for others' numbers", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    setTable("orders", { data: orderRow, error: null });
    setTable("order_items", { data: [itemRow], error: null });
    const order = await readCustomerOrderByNumber(client, USER_ID, 12345, media);
    expect(order?.orderNumber).toBe("12345");
    const eqCalls = queryCalls.filter((call) => call.table === "orders" && call.method === "eq");
    expect(eqCalls).toContainEqual({ table: "orders", method: "eq", args: ["user_id", USER_ID] });
    expect(eqCalls).toContainEqual({ table: "orders", method: "eq", args: ["order_number", 12345] });

    queryCalls.length = 0;
    setTable("orders", { data: null, error: null });
    expect(await readCustomerOrderByNumber(client, USER_ID, 54321, media)).toBeNull();
  });
});

describe("customer address CRUD (own-row, default clearing scoped)", () => {
  const addressRow = {
    id: ADDRESS_ID,
    user_id: USER_ID,
    label: "Home",
    full_name: "Fahim",
    phone: "01712345678",
    division: "Dhaka",
    district: "Dhaka",
    area: "Dhanmondi",
    address_line: "House 1, Road 1",
    is_default: true,
    created_at: "2026-11-16T10:00:00.000Z",
    updated_at: "2026-11-16T10:00:00.000Z",
  };
  const addressInput = customerAddressSchema.parse({
    id: "",
    label: "Home",
    fullName: "Fahim",
    phone: "01712345678",
    division: "Dhaka",
    district: "Dhaka",
    area: "Dhanmondi",
    addressLine: "House 1, Road 1",
    isDefault: true,
  });

  it("projects rows and rejects invalid ones", () => {
    expect(projectCustomerAddress(addressRow)).toEqual({
      id: ADDRESS_ID,
      label: "Home",
      fullName: "Fahim",
      phone: "01712345678",
      division: "Dhaka",
      district: "Dhaka",
      area: "Dhanmondi",
      addressLine: "House 1, Road 1",
      isDefault: true,
    });
    expect(projectCustomerAddress({ ...addressRow, id: "not-a-uuid" })).toBeNull();
    expect(projectCustomerAddress(null)).toBeNull();
  });

  it("reads own addresses default-first and yields [] on failure", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    setTable("customer_addresses", { data: [addressRow], error: null });
    const addresses = await readCustomerAddresses(client, USER_ID);
    expect(addresses).toHaveLength(1);
    expect(queryCalls).toContainEqual({
      table: "customer_addresses",
      method: "eq",
      args: ["user_id", USER_ID],
    });
    expect(queryCalls).toContainEqual({
      table: "customer_addresses",
      method: "order",
      args: ["is_default", { ascending: false }],
    });

    setTable("customer_addresses", { data: null, error: { message: "relation does not exist" } });
    expect(await readCustomerAddresses(client, USER_ID)).toEqual([]);
  });

  it("inserts a new default address after clearing other defaults for the same user only", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    setTable(
      "customer_addresses",
      { data: null, error: null },
      { data: addressRow, error: null },
    );
    const result = await saveCustomerAddress(client, USER_ID, addressInput);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(ADDRESS_ID);
    const update = queryCalls.find((call) => call.method === "update");
    expect(update?.args).toEqual([{ is_default: false }]);
    const eqCalls = queryCalls.filter((call) => call.method === "eq");
    expect(eqCalls).toContainEqual({ table: "customer_addresses", method: "eq", args: ["user_id", USER_ID] });
    expect(eqCalls).toContainEqual({ table: "customer_addresses", method: "eq", args: ["is_default", true] });
    const insert = queryCalls.find((call) => call.method === "insert");
    expect(insert?.args[0]).toMatchObject({ user_id: USER_ID, label: "Home", is_default: true });
    // The clear runs before the insert.
    expect(queryCalls.findIndex((call) => call.method === "update")).toBeLessThan(
      queryCalls.findIndex((call) => call.method === "insert"),
    );
  });

  it("updates an existing address scoped to id + user, and reports a missing row", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    const edit = { ...addressInput, id: ADDRESS_ID, isDefault: false };
    setTable("customer_addresses", { data: { ...addressRow, is_default: false }, error: null });
    const result = await saveCustomerAddress(client, USER_ID, edit);
    expect(result.ok).toBe(true);
    expect(queryCalls.some((call) => call.method === "insert")).toBe(false);
    const eqCalls = queryCalls.filter((call) => call.method === "eq");
    expect(eqCalls).toContainEqual({ table: "customer_addresses", method: "eq", args: ["id", ADDRESS_ID] });
    expect(eqCalls).toContainEqual({ table: "customer_addresses", method: "eq", args: ["user_id", USER_ID] });

    queryCalls.length = 0;
    setTable("customer_addresses", { data: null, error: null });
    const missing = await saveCustomerAddress(client, USER_ID, edit);
    expect(missing).toEqual({
      ok: false,
      reason: "validation",
      message: "This address no longer exists.",
    });
  });

  it("fails honestly when clearing defaults fails", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    setTable("customer_addresses", { data: null, error: { message: "boom" } });
    const result = await saveCustomerAddress(client, USER_ID, addressInput);
    expect(result.ok).toBe(false);
    expect(queryCalls.some((call) => call.method === "insert")).toBe(false);
  });

  it("deletes scoped to id + user, validates the UUID, and stays idempotent", async () => {
    const client = (await customerClient()) as NonNullable<Awaited<ReturnType<typeof customerClient>>>;
    setTable("customer_addresses", { data: null, error: null });
    expect((await deleteCustomerAddress(client, USER_ID, ADDRESS_ID)).ok).toBe(true);
    expect(queryCalls).toContainEqual({ table: "customer_addresses", method: "delete", args: [] });
    expect(queryCalls).toContainEqual({ table: "customer_addresses", method: "eq", args: ["id", ADDRESS_ID] });
    expect(queryCalls).toContainEqual({ table: "customer_addresses", method: "eq", args: ["user_id", USER_ID] });

    queryCalls.length = 0;
    const invalid = await deleteCustomerAddress(client, USER_ID, "not-a-uuid");
    expect(invalid).toEqual({
      ok: false,
      reason: "validation",
      message: "This address no longer exists.",
    });
    expect(queryCalls).toHaveLength(0);

    setTable("customer_addresses", { data: null, error: { message: "boom" } });
    const failed = await deleteCustomerAddress(client, USER_ID, ADDRESS_ID);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.reason).toBe("error");
  });
});

describe("customer server actions", () => {
  it("signs in with email + password only and rejects phone-shaped identifiers", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({
      data: { user: fakeUser(), session: { access_token: "fake" } },
      error: null,
    });
    const result = await signInCustomer({ email: "customer@example.com", password: "correct horse" });
    expect(result.ok).toBe(true);
    expect(mocks.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "customer@example.com",
      password: "correct horse",
    });

    const phone = await signInCustomer({ email: "01712345678", password: "whatever123" });
    expect(phone.ok).toBe(false);
    if (!phone.ok) {
      expect(phone.reason).toBe("validation");
      expect(phone.message).toBe("Use your email address to sign in. Mobile sign-in is not available.");
    }
    const bad = await signInCustomer({ email: "not-an-email", password: "x" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).not.toContain("01712345678");
  });

  it("returns a generic message on sign-in failure and never leaks the error", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials", code: "invalid_credentials" },
    });
    const result = await signInCustomer({ email: "customer@example.com", password: "wrong-password" });
    expect(result).toEqual({
      ok: false,
      reason: "error",
      message: "Could not sign you in. Check your email and password.",
    });
  });

  it("reports not-connected when Supabase is unconfigured", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    const result = await signInCustomer({ email: "customer@example.com", password: "correct horse" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_connected");
    expect(mocks.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("registers with metadata transport only and writes the profile on an immediate session", async () => {
    mocks.auth.signUp.mockResolvedValue({
      data: { user: fakeUser(), session: { access_token: "fake" } },
      error: null,
    });
    const result = await registerCustomer({
      fullName: "Fahim Uddin",
      email: "customer@example.com",
      phone: "+8801712345678",
      password: "correct horse",
    });
    expect(result).toEqual({ ok: true, data: { signedIn: true } });
    expect(mocks.auth.signUp).toHaveBeenCalledWith({
      email: "customer@example.com",
      password: "correct horse",
      options: {
        emailRedirectTo: "https://preview.test.invalid/auth/callback",
        data: { full_name: "Fahim Uddin", phone: "01712345678" },
      },
    });
    const updates = queryCalls.filter((call) => call.table === "profiles" && call.method === "update");
    expect(updates.map((call) => call.args[0])).toEqual([
      { display_name: "Fahim Uddin" },
      { phone: "01712345678" },
    ]);
  });

  it("treats already-registered and confirmation-on sign-ups identically (no enumeration)", async () => {
    mocks.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered", code: "user_already_exists" },
    });
    const duplicate = await registerCustomer({
      fullName: "Fahim",
      email: "taken@example.com",
      phone: "01712345678",
      password: "correct horse",
    });
    expect(duplicate).toEqual({ ok: true, data: { signedIn: false } });

    mocks.auth.signUp.mockResolvedValue({
      data: { user: fakeUser({ email: "fresh@example.com" }), session: null },
      error: null,
    });
    const fresh = await registerCustomer({
      fullName: "Fahim",
      email: "fresh@example.com",
      phone: "01712345678",
      password: "correct horse",
    });
    expect(fresh).toEqual({ ok: true, data: { signedIn: false } });
  });

  it("pins the current confirmation-off registration differential (S2, pending dashboard fact)", async () => {
    // Current behavior only: with email confirmation OFF a fresh
    // sign-up returns signedIn:true while an existing email returns
    // signedIn:false. No behavior change until the dashboard
    // "Confirm email" setting is confirmed live.
    mocks.auth.signUp.mockResolvedValue({
      data: { user: fakeUser(), session: { access_token: "fake" } },
      error: null,
    });
    const fresh = await registerCustomer({
      fullName: "Fahim",
      email: "fresh@example.com",
      phone: "01712345678",
      password: "correct horse",
    });
    expect(fresh).toEqual({ ok: true, data: { signedIn: true } });

    mocks.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered", code: "user_already_exists" },
    });
    const duplicate = await registerCustomer({
      fullName: "Fahim",
      email: "taken@example.com",
      phone: "01712345678",
      password: "correct horse",
    });
    expect(duplicate).toEqual({ ok: true, data: { signedIn: false } });
  });

  it("fails registration honestly without an origin and on other sign-up errors", async () => {
    vi.stubEnv("SITE_URL", "");
    const noOrigin = await registerCustomer({
      fullName: "Fahim",
      email: "customer@example.com",
      phone: "01712345678",
      password: "correct horse",
    });
    expect(noOrigin.ok).toBe(false);
    if (!noOrigin.ok) expect(noOrigin.reason).toBe("not_connected");
    expect(mocks.auth.signUp).not.toHaveBeenCalled();

    vi.stubEnv("SITE_URL", "https://preview.test.invalid");
    mocks.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Database error saving new user", code: "unexpected_failure" },
    });
    const failed = await registerCustomer({
      fullName: "Fahim",
      email: "customer@example.com",
      phone: "01712345678",
      password: "correct horse",
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.message).not.toContain("Database error");
  });

  it("always returns the same reset outcome and points the link at the reset page", async () => {
    mocks.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "User not found", code: "user_not_found" },
    });
    const result = await requestCustomerPasswordReset({ email: "nobody@example.com" });
    expect(result.ok).toBe(true);
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith("nobody@example.com", {
      redirectTo: "https://preview.test.invalid/auth/callback?next=/account/reset-password",
    });

    const phone = await requestCustomerPasswordReset({ email: "01712345678" });
    expect(phone.ok).toBe(false);
    if (!phone.ok) {
      expect(phone.message).toBe(
        "Use your email address to reset your password. Mobile password reset is not available.",
      );
    }
  });

  it("sets a new password only with a live session (D10 trust-session gate)", async () => {
    const noSession = await setNewCustomerPassword({ password: "brand new password" });
    expect(noSession).toEqual({
      ok: false,
      reason: "error",
      message: "Your sign-in expired. Please sign in again.",
    });
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();

    signedIn();
    const updated = await setNewCustomerPassword({ password: "brand new password" });
    expect(updated.ok).toBe(true);
    expect(mocks.auth.updateUser).toHaveBeenCalledWith({ password: "brand new password" });

    mocks.auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "expired", code: "otp_expired" },
    });
    const failed = await setNewCustomerPassword({ password: "brand new password" });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.message).toContain("Request a new reset link");

    const short = await setNewCustomerPassword({ password: "short" });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.reason).toBe("validation");
  });

  it("signs out the customer scope only and redirects home", async () => {
    signedIn();
    let thrown: unknown;
    try {
      await signOutCustomer();
    } catch (error) {
      thrown = error;
    }
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(redirectDestination(thrown)).toBe("/");
  });

  it("updates the profile only when signed in, writing name then phone separately", async () => {
    const noSession = await updateCustomerProfile({ fullName: "Fahim", phone: "01712345678" });
    expect(noSession.ok).toBe(false);
    expect(queryCalls).toHaveLength(0);

    signedIn();
    setTable("profiles", { data: null, error: null }, { data: null, error: null });
    const updated = await updateCustomerProfile({ fullName: "Fahim Uddin", phone: "+8801812345678" });
    expect(updated).toEqual({ ok: true, data: undefined });
    const updates = queryCalls.filter((call) => call.table === "profiles" && call.method === "update");
    expect(updates.map((call) => call.args[0])).toEqual([
      { display_name: "Fahim Uddin" },
      { phone: "01812345678" },
    ]);
    expect(queryCalls).toContainEqual({ table: "profiles", method: "eq", args: ["id", USER_ID] });
  });

  it("returns success with a notice when the name saves but the phone write fails", async () => {
    signedIn();
    setTable(
      "profiles",
      { data: null, error: null },
      { data: null, error: { message: "column profiles.phone does not exist" } },
    );
    const result = await updateCustomerProfile({ fullName: "Fahim Uddin", phone: "01712345678" });
    expect(result).toEqual({
      ok: true,
      data: undefined,
      message: "Your name was saved, but your mobile number could not be saved. Please try saving it again.",
    });
    expect(queryCalls.filter((call) => call.method === "update").map((call) => call.args[0])).toEqual([
      { display_name: "Fahim Uddin" },
      { phone: "01712345678" },
    ]);
  });

  it("fails honestly without attempting the phone write when the name write fails", async () => {
    signedIn();
    setTable("profiles", { data: null, error: { message: "boom" } });
    const result = await updateCustomerProfile({ fullName: "Fahim Uddin", phone: "01712345678" });
    expect(result).toEqual({
      ok: false,
      reason: "error",
      message: "Could not save your profile. Please try again.",
    });
    expect(queryCalls.filter((call) => call.method === "update")).toHaveLength(1);
  });

  it("routes address actions through the session check", async () => {
    const address = {
      id: "",
      label: "Home",
      fullName: "Fahim",
      phone: "01712345678",
      division: "Dhaka",
      district: "Dhaka",
      area: "Dhanmondi",
      addressLine: "House 1, Road 1",
      isDefault: false,
    };
    const noSession = await saveCustomerAddressAction(address);
    expect(noSession.ok).toBe(false);
    expect(queryCalls).toHaveLength(0);
    const noSessionDelete = await deleteCustomerAddressAction(ADDRESS_ID);
    expect(noSessionDelete.ok).toBe(false);

    signedIn();
    setTable(
      "customer_addresses",
      { data: { id: ADDRESS_ID, user_id: USER_ID, label: "Home", full_name: "Fahim", phone: "01712345678", division: "Dhaka", district: "Dhaka", area: "Dhanmondi", address_line: "House 1, Road 1", is_default: false, created_at: "2026-11-16T10:00:00.000Z", updated_at: "2026-11-16T10:00:00.000Z" }, error: null },
    );
    const saved = await saveCustomerAddressAction(address);
    expect(saved.ok).toBe(true);

    const badAddress = await saveCustomerAddressAction({ ...address, division: "Nowhere" });
    expect(badAddress.ok).toBe(false);
    if (!badAddress.ok) expect(badAddress.reason).toBe("validation");
  });
});

describe("Google sign-in action", () => {
  function googleForm(next?: string): FormData {
    const form = new FormData();
    if (next !== undefined) form.set("next", next);
    return form;
  }

  it("requests exactly the minimal scopes with skipBrowserRedirect and redirects to the auth URL", async () => {
    mocks.auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "google", url: "https://auth.test.invalid/authorize?x=1" },
      error: null,
    });
    let thrown: unknown;
    try {
      await signInWithGoogle(null, googleForm("/account/orders"));
    } catch (error) {
      thrown = error;
    }
    expect(redirectDestination(thrown)).toBe("https://auth.test.invalid/authorize?x=1");
    expect(mocks.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://preview.test.invalid/auth/callback?next=%2Faccount%2Forders",
        scopes: "openid email profile",
        skipBrowserRedirect: true,
      },
    });
  });

  it("falls back to /account for a non-allowlisted next", async () => {
    mocks.auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "google", url: "https://auth.test.invalid/authorize" },
      error: null,
    });
    try {
      await signInWithGoogle(null, googleForm("https://evil.test/account"));
    } catch {
      // redirect thrown; the redirectTo assertion below is the point.
    }
    expect(mocks.auth.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo: "https://preview.test.invalid/auth/callback?next=%2Faccount",
        }),
      }),
    );
  });

  it("returns the identity-conflict message without linking, and a generic message otherwise", async () => {
    mocks.auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "google", url: "" },
      error: { message: "identity already exists", code: "identity_already_exists" },
    });
    const conflict = await signInWithGoogle(null, googleForm());
    expect(conflict).toEqual({ message: GOOGLE_IDENTITY_CONFLICT_MESSAGE });

    mocks.auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "google", url: "" },
      error: { message: "provider is not enabled", code: "validation_failed" },
    });
    const generic = await signInWithGoogle(null, googleForm());
    expect(generic?.message).toContain("Google sign-in is not available right now");
    expect(generic?.message).not.toContain("provider is not enabled");
  });

  it("is unavailable without an origin or configuration", async () => {
    vi.stubEnv("SITE_URL", "");
    const noOrigin = await signInWithGoogle(null, googleForm());
    expect(noOrigin?.message).toContain("Google sign-in is not available right now");
    expect(mocks.auth.signInWithOAuth).not.toHaveBeenCalled();

    vi.stubEnv("SITE_URL", "https://preview.test.invalid");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    const noConfig = await signInWithGoogle(null, googleForm());
    expect(noConfig?.message).toContain("Google sign-in is not available right now");
  });
});

describe("/auth/callback route", () => {
  function callbackRequest(query: string): NextRequest {
    return new NextRequest(new URL(`https://preview.test.invalid/auth/callback${query}`));
  }

  it("exchanges a code once and 303s to the allowlisted destination with no-store", async () => {
    signedIn();
    const response = await callbackGet(callbackRequest("?code=fake-pkce-code&next=/account/orders"));
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/account/orders");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(mocks.auth.exchangeCodeForSession).toHaveBeenCalledWith("fake-pkce-code");
    // Profile sync ran (missing row -> insert) without blocking the redirect.
    expect(queryCalls.some((call) => call.table === "profiles" && call.method === "insert")).toBe(true);
  });

  it("keeps the reset-password destination and defaults evil next values to /account", async () => {
    signedIn();
    const reset = await callbackGet(callbackRequest("?code=fake-code&next=/account/reset-password"));
    expect(reset.status).toBe(303);
    expect(reset.headers.get("Location")).toBe("/account/reset-password");

    const evil = await callbackGet(callbackRequest("?code=fake-code&next=https://evil.test/account"));
    expect(evil.headers.get("Location")).toBe("/account");

    const missing = await callbackGet(callbackRequest("?code=fake-code"));
    expect(missing.headers.get("Location")).toBe("/account");
  });

  it("400s on a missing, overlong, or unexchangeable code without leaking detail", async () => {
    const missing = await callbackGet(callbackRequest("?next=/account"));
    expect(missing.status).toBe(400);
    expect(await missing.text()).toBe("Invalid or unavailable authentication link.");
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.auth.exchangeCodeForSession).not.toHaveBeenCalled();

    const overlong = await callbackGet(callbackRequest(`?code=${"x".repeat(2049)}`));
    expect(overlong.status).toBe(400);
    expect(mocks.auth.exchangeCodeForSession).not.toHaveBeenCalled();

    mocks.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "code expired", code: "flow_state_expired" },
    });
    const expired = await callbackGet(callbackRequest("?code=fake-code"));
    expect(expired.status).toBe(400);
    const expiredText = await expired.text();
    expect(expiredText).toBe("This link is invalid or expired. Please request a new link.");
    expect(expiredText).not.toContain("flow_state_expired");
  });

  it("400s without configuration and never exchanges", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    const response = await callbackGet(callbackRequest("?code=fake-code"));
    expect(response.status).toBe(400);
    expect(mocks.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects anonymous sessions and signs them out locally", async () => {
    mocks.auth.getUser.mockResolvedValue({
      data: { user: fakeUser({ is_anonymous: true }) },
      error: null,
    });
    const response = await callbackGet(callbackRequest("?code=fake-code"));
    expect(response.status).toBe(400);
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("classifies provider errors without echoing provider text", async () => {
    const conflict = await callbackGet(
      callbackRequest("?error=server_error&error_description=identity+already+exists"),
    );
    expect(conflict.status).toBe(400);
    expect(await conflict.text()).toBe(GOOGLE_IDENTITY_CONFLICT_MESSAGE);

    const generic = await callbackGet(callbackRequest("?error=access_denied&error_description=denied+by+user"));
    expect(generic.status).toBe(400);
    expect(await generic.text()).toBe("This link is invalid or expired. Please request a new link.");
    expect(mocks.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("D1 checkout transport (customer JWT vs guest service-role)", () => {
  const CHECKOUT_TOKEN = "a".repeat(64);
  const orderInput = {
    customer: { fullName: "Fahim", phone: "01712345678" },
    items: [{ variantId: VARIANT_ID, quantity: 1 }],
    address: { division: "Dhaka", district: "Dhaka", area: "Dhanmondi", addressLine: "House 1, Road 1" },
    paymentMethod: "cod",
  };
  const progressInput = {
    customer: { fullName: "Fahim", phone: "01712345678" },
    items: [{ variantId: VARIANT_ID, quantity: 1 }],
  };

  type FetchCall = { url: string; headers: Record<string, string>; body: unknown };
  const fetchCalls: FetchCall[] = [];
  let routes: Record<string, { status: number; body: unknown }> = {};

  function installFetch() {
    fetchCalls.length = 0;
    const fakeFetch = vi.fn(async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
      fetchCalls.push({
        url,
        headers: { ...(init.headers ?? {}) },
        body: init.body ? (JSON.parse(init.body) as unknown) : undefined,
      });
      const name = url.split("/rpc/")[1] ?? "";
      const route = routes[name] ?? { status: 500, body: { code: "unknown" } };
      return {
        ok: route.status >= 200 && route.status < 300,
        status: route.status,
        json: async () => route.body,
      };
    });
    vi.stubGlobal("fetch", fakeFetch);
    return fakeFetch;
  }

  function successRoutes(): Record<string, { status: number; body: unknown }> {
    return {
      start_checkout_session: { status: 200, body: { token: CHECKOUT_TOKEN, expires_at: "2026-11-17T00:00:00.000Z" } },
      set_checkout_items: { status: 200, body: {} },
      place_checkout_order: {
        status: 200,
        body: {
          order_number: 12345,
          total_minor: 156000,
          placed_at: "2026-11-16T10:00:00.000Z",
          already_placed: false,
          items: [{ variant_id: VARIANT_ID, quantity: 1 }],
        },
      },
    };
  }

  it("keeps the guest transport byte-identical to before (service key, same args)", async () => {
    stubCheckoutEnv();
    routes = successRoutes();
    installFetch();
    const result = await placeCheckoutOrder(orderInput);
    expect(result).toEqual({ ok: true, data: { orderNumber: "12345", total: 1560 } });
    expect(fetchCalls.map((call) => call.url.split("/rpc/")[1])).toEqual([
      "start_checkout_session",
      "set_checkout_items",
      "place_checkout_order",
    ]);
    for (const call of fetchCalls) {
      expect(call.headers).toEqual({
        apikey: FAKE_SERVICE_KEY,
        Authorization: `Bearer ${FAKE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      });
    }
    const startBody = fetchCalls[0]?.body as Record<string, unknown>;
    expect(startBody.customer_name).toBe("Fahim");
    expect(startBody.phone).toBe("01712345678");
    expect(startBody.email).toBeNull();
    expect(startBody.client_key).toMatch(/^[0-9a-f]{64}$/);
    const placeBody = fetchCalls[2]?.body as Record<string, unknown>;
    expect(placeBody.payment_method).toBe("cod");
    expect(placeBody.client_key).toBe(startBody.client_key);
  });

  it("uses the customer JWT + publishable key when signed in, with identical RPC args", async () => {
    stubCheckoutEnv();
    routes = successRoutes();
    installFetch();
    signedIn();
    const result = await placeCheckoutOrder(orderInput);
    expect(result).toEqual({ ok: true, data: { orderNumber: "12345", total: 1560 } });
    expect(fetchCalls).toHaveLength(3);
    for (const call of fetchCalls) {
      expect(call.headers).toEqual({
        apikey: FAKE_PUBLISHABLE_KEY,
        Authorization: "Bearer fake-customer-access-token",
        "Content-Type": "application/json",
      });
      expect(JSON.stringify(call)).not.toContain(FAKE_SERVICE_KEY);
    }
    const startBody = fetchCalls[0]?.body as Record<string, unknown>;
    expect(startBody).toMatchObject({ customer_name: "Fahim", phone: "01712345678", email: null });
    expect(startBody.client_key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("saves progress under the customer credential too", async () => {
    stubCheckoutEnv();
    routes = successRoutes();
    installFetch();
    signedIn();
    const result = await saveCheckoutProgress(progressInput);
    expect(result).toEqual({ ok: true, data: { saved: true } });
    expect(fetchCalls.map((call) => call.url.split("/rpc/")[1])).toEqual([
      "start_checkout_session",
      "set_checkout_items",
    ]);
    for (const call of fetchCalls) {
      expect(call.headers.Authorization).toBe("Bearer fake-customer-access-token");
    }
  });

  it("fails honestly on a 401 under the customer credential and never falls back", async () => {
    stubCheckoutEnv();
    routes = { start_checkout_session: { status: 401, body: { code: "PGRST301" } } };
    installFetch();
    signedIn();
    const result = await placeCheckoutOrder(orderInput);
    expect(result).toEqual({
      ok: false,
      reason: "error",
      message: "Your sign-in expired. Please sign in again, then place your order.",
    });
    // One attempt only, under the customer credential: no service-role retry.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.headers.Authorization).toBe("Bearer fake-customer-access-token");
  });

  it("keeps a guest 401 generic (no expired-session message for guests)", async () => {
    stubCheckoutEnv();
    routes = { start_checkout_session: { status: 401, body: { code: "PGRST301" } } };
    installFetch();
    const result = await placeCheckoutOrder(orderInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("sign-in expired");
      expect(result.reason).toBe("not_connected");
    }
  });

  it("fails honestly when a validated session has no access token, without calling the RPCs", async () => {
    stubCheckoutEnv();
    routes = successRoutes();
    const fakeFetch = installFetch();
    mocks.auth.getUser.mockResolvedValue({ data: { user: fakeUser() }, error: null });
    mocks.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await placeCheckoutOrder(orderInput);
    expect(result).toEqual({
      ok: false,
      reason: "error",
      message: "Your sign-in expired. Please sign in again, then place your order.",
    });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("reports not-connected when the checkout gates are closed", async () => {
    // Default env has no STAGING_CHECKOUT_ORDERS flag.
    const result = await placeCheckoutOrder(orderInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_connected");
  });

  it("rpcFor: guest headers, customer headers, 401 callback, and network failures", async () => {
    routes = { probe_rpc: { status: 200, body: { ok: true } } };
    installFetch();
    const config = { url: STAGING_URL, serviceKey: FAKE_SERVICE_KEY };

    const guest = rpcFor(config);
    const guestResult = await guest<{ ok: boolean }>("probe_rpc", { a: 1 });
    expect(guestResult).toEqual({ ok: true, data: { ok: true } });
    expect(fetchCalls[0]?.headers.Authorization).toBe(`Bearer ${FAKE_SERVICE_KEY}`);

    fetchCalls.length = 0;
    let authFailed = 0;
    const customer = rpcFor(
      config,
      { apikey: FAKE_PUBLISHABLE_KEY, accessToken: "fake-customer-access-token" },
      () => {
        authFailed += 1;
      },
    );
    const customerResult = await customer<{ ok: boolean }>("probe_rpc", { a: 1 });
    expect(customerResult.ok).toBe(true);
    expect(fetchCalls[0]?.headers).toEqual({
      apikey: FAKE_PUBLISHABLE_KEY,
      Authorization: "Bearer fake-customer-access-token",
      "Content-Type": "application/json",
    });
    expect(authFailed).toBe(0);

    routes = { probe_rpc: { status: 401, body: { code: "PGRST301" } } };
    const denied = await customer("probe_rpc", { a: 1 });
    expect(denied).toEqual({ ok: false, code: "PGRST301" });
    expect(authFailed).toBe(1);

    const guestDenied = await guest("probe_rpc", { a: 1 });
    expect(guestDenied).toEqual({ ok: false, code: "PGRST301" });
    expect(authFailed).toBe(1);

    routes = { probe_rpc: { status: 400, body: { code: "CK001" } } };
    const refused = await customer("probe_rpc", { a: 1 });
    expect(refused).toEqual({ ok: false, code: "CK001" });
    expect(authFailed).toBe(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<never> => {
        throw new Error("offline");
      }),
    );
    const network = await customer("probe_rpc", { a: 1 });
    expect(network).toEqual({ ok: false, code: "network" });
  });
});

describe("regression pins (unavailable slices stay unavailable, no mock data)", () => {
  it("keeps newsletter/contact/storefront-draft/media/upload not_connected", async () => {
    const newsletter = await dataSource.subscribeNewsletter("customer@example.com");
    expect(newsletter.ok).toBe(false);
    if (!newsletter.ok) expect(newsletter.reason).toBe("not_connected");
    const contact = await dataSource.submitContactForm({
      name: "Fahim",
      email: "customer@example.com",
      subject: "Hello",
      message: "Hello",
    });
    expect(contact.ok).toBe(false);
    if (!contact.ok) expect(contact.reason).toBe("not_connected");
    const draft = await dataSource.saveStorefrontDraft({} as never);
    expect(draft.ok).toBe(false);
    if (!draft.ok) expect(draft.reason).toBe("not_connected");
    const publish = await dataSource.publishStorefrontSettings({} as never);
    expect(publish.ok).toBe(false);
    if (!publish.ok) expect(publish.reason).toBe("not_connected");
    const upload = await dataSource.uploadMedia({ name: "photo.jpg", type: "image/jpeg", size: 100 });
    expect(upload.ok).toBe(false);
    if (!upload.ok) expect(upload.reason).toBe("not_connected");
    // None of them touched the database.
    expect(queryCalls).toHaveLength(0);
  });

  it("returns no mock customer or mock orders when signed out", async () => {
    expect(await dataSource.getCurrentCustomer()).toBeNull();
    expect(await dataSource.getOrders()).toEqual([]);
    expect(await dataSource.getOrderByNumber("12345", "01700000000")).toBeNull();
  });

  it("keeps the track-order guest path disabled", async () => {
    // getOrderByNumber without a session yields null even with a phone
    // number supplied: there is no guest order lookup.
    expect(await dataSource.getOrderByNumber("12345", "01712345678")).toBeNull();
    expect(queryCalls).toHaveLength(0);
  });
});

describe("source pins (diff hygiene: no forbidden strings, no secrets, no new gates)", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const srcDir = join(testDir, "..", "src");
  const customerLibFiles = [
    "origin.ts",
    "redirects.ts",
    "validation.ts",
    "supabase.ts",
    "session.ts",
    "orders.ts",
    "addresses.ts",
    "actions.ts",
  ].map((file) => join(srcDir, "lib", "customer", file));
  const newFiles = [
    ...customerLibFiles,
    join(srcDir, "services", "adapters", "customer.ts"),
    join(srcDir, "services", "checkout.ts"),
    join(srcDir, "components", "account", "AuthForms.tsx"),
    join(srcDir, "components", "account", "GoogleSignInButton.tsx"),
    join(srcDir, "components", "account", "ProfileForm.tsx"),
    join(srcDir, "app", "auth", "callback", "route.ts"),
  ];
  const readAll = (files: string[]) => files.map((file) => readFileSync(file, "utf8")).join("\n");

  it("contains zero occurrences of the non-database order status", () => {
    // The string is built at runtime so this test file itself does not
    // put the forbidden status into the diff.
    const forbiddenStatus = ["Process", "ing"].join("");
    expect(readAll(newFiles)).not.toContain(forbiddenStatus);
    expect(readFileSync(join(testDir, "..", "src", "proxy.ts"), "utf8")).not.toContain(forbiddenStatus);
  });

  it("never redefines has_permission and never calls linkIdentity", () => {
    const body = readAll(customerLibFiles);
    expect(body).not.toContain("has_permission");
    expect(body).not.toContain("linkIdentity(");
    expect(body).not.toContain(".linkIdentity");
    expect(readAll(newFiles)).not.toContain("create function");
  });

  it("contains no secret material, no service-role reads, and no Draft/Missing-Information surface", () => {
    const body = readAll(newFiles);
    for (const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "sb_publishable_",
      "sb_secret_",
      "BEGIN PRIVATE KEY",
      "Missing Information",
    ]) {
      expect(body).not.toContain(forbidden);
    }
    expect(readAll(customerLibFiles).toLowerCase()).not.toContain("draft");
  });

  it("adds no staging gate and no direct storefront-policy import", () => {
    const body = readAll(customerLibFiles);
    expect(body).not.toContain("STAGING_");
    expect(body).not.toContain("storefront-policy");
    expect(body).toContain("publicSupabaseConfiguration");
  });

  it("keeps the auth origin free of request-derived state", () => {
    const origin = readFileSync(join(srcDir, "lib", "customer", "origin.ts"), "utf8");
    expect(origin).not.toContain("headers");
    expect(origin).not.toContain("Host");
    expect(origin).not.toContain("next/headers");
    // actions.ts builds every redirectTo from getCustomerAuthOrigin and
    // must never switch to a request-derived origin either.
    const actions = readFileSync(join(srcDir, "lib", "customer", "actions.ts"), "utf8");
    expect(actions).not.toContain("headers");
    expect(actions).not.toContain("Host");
    expect(actions).not.toContain("next/headers");
  });

  it("uses reset-specific phone copy and a non-empty login password pre-check", () => {
    const forms = readFileSync(join(srcDir, "components", "account", "AuthForms.tsx"), "utf8");
    expect(forms).toContain("Mobile password reset is not available.");
    expect(forms).toContain("Mobile sign-in is not available.");
    expect(forms).not.toContain("password.length < 6");
    expect(forms).toContain("password.length === 0");
  });

  it("pins the Google scopes and forbids extra OAuth params", () => {
    const actions = readFileSync(join(srcDir, "lib", "customer", "actions.ts"), "utf8");
    expect(actions.match(/scopes: "openid email profile"/g)).toHaveLength(1);
    expect(actions).toContain("skipBrowserRedirect: true");
    expect(actions).not.toContain("queryParams");
    expect(actions).not.toContain("offline");
  });

  it("keeps the proxy branch order: 404 gate, /product/, /admin, then /account + /auth", () => {
    const proxy = readFileSync(join(srcDir, "proxy.ts"), "utf8");
    const adminBranch = proxy.indexOf('startsWith("/admin")');
    const customerBranch = proxy.indexOf('startsWith("/account/")');
    const productCheck = proxy.indexOf('startsWith("/product/")');
    expect(productCheck).toBeGreaterThan(-1);
    expect(adminBranch).toBeGreaterThan(productCheck);
    expect(customerBranch).toBeGreaterThan(adminBranch);
    expect(proxy).toContain("aa-customer-auth");
    expect(proxy).toContain("aa-admin-auth");
    expect(proxy).toContain("/auth/");
    expect(proxy).toContain("Cache-Control");
    expect(proxy).toContain('_next/static|_next/image|favicon.ico');
  });

  it("documents SITE_URL in .env.example without a value", () => {
    const envExample = readFileSync(join(testDir, "..", ".env.example"), "utf8");
    expect(envExample).toContain("SITE_URL=");
    const siteUrlLine = envExample.split("\n").find((line) => line.startsWith("SITE_URL="));
    expect(siteUrlLine).toBe("SITE_URL=");
    expect(envExample).toContain("/auth/callback");
  });

  it("surfaces the server success-with-notice message in the profile form (S1)", () => {
    const profileForm = readFileSync(join(srcDir, "components", "account", "ProfileForm.tsx"), "utf8");
    expect(profileForm).toContain('setMessage(r.message ?? "Profile updated.")');
  });
});

describe("customer addresses migration (authored-only SQL pins)", () => {
  const migrationPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "supabase",
    "migrations",
    "20261116000700_customer_addresses.sql",
  );
  const sql = readFileSync(migrationPath, "utf8");
  const body = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("creates only the customer_addresses table with RLS and own-row policies", () => {
    expect(body).toContain("create table public.customer_addresses");
    expect(body.match(/create table/gi)).toHaveLength(1);
    expect(body).toContain("enable row level security");
    expect(body.match(/create policy/gi)).toHaveLength(4);
    for (const policy of [
      "customer_addresses_own_read",
      "customer_addresses_own_insert",
      "customer_addresses_own_update",
      "customer_addresses_own_delete",
    ]) {
      expect(body).toContain(policy);
    }
    expect(body).toContain("references auth.users(id) on delete cascade");
    expect(body).toContain("create index");
    expect(body).toContain("where is_default");
    expect(body).toContain("phone text not null");
    expect(body).toContain("^01[3-9][0-9]{8}$");
    for (const division of [
      "Barishal",
      "Chattogram",
      "Dhaka",
      "Khulna",
      "Mymensingh",
      "Rajshahi",
      "Rangpur",
      "Sylhet",
    ]) {
      expect(body).toContain(division);
    }
  });

  it("adds only the profiles.phone column with the minimal grant extension", () => {
    expect(body).toContain("alter table public.customer_addresses enable row level security");
    expect(body).toContain("alter table public.profiles add column phone");
    expect(body.match(/alter table/gi)).toHaveLength(2);
    expect(body).toContain("grant insert (phone), update (phone)");
    expect(body).toContain("touch_updated_at");
  });

  it("contains no roles, permissions, RPC, function, or checkout changes", () => {
    for (const forbidden of [
      "has_permission",
      "create function",
      "create or replace function",
      "create role",
      "checkout",
      "insert into",
      "update public.",
      "delete from",
      "drop ",
      "service_role",
    ]) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("states the S6 parse-check requirement and the authored-only terms in its header", () => {
    for (const term of [
      "S6 PARSE-CHECK REQUIRED",
      "NEVER apply blind",
      "STAGING project",
      "schema-drift check",
      "Production apply needs separate approval",
    ]) {
      expect(sql).toContain(term);
    }
  });
});
