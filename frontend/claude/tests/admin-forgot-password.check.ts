import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import projects from "@/config/supabase-projects.json";

/**
 * Staff forgot-password suite. All Supabase interaction is mocked:
 * @supabase/ssr returns a configurable fake admin client, next/headers
 * returns a fake cookie jar, and fetch throws by default so no test can
 * touch the network. Fake keys and UUIDs only — no real credentials
 * anywhere.
 *
 * NOTE: `staffSession()` (React.cache wrapper) is deliberately never
 * called here: the cached result can persist across tests in one file.
 * The reset actions do their own getUser + roles check instead.
 */

const mocks = vi.hoisted(() => {
  const auth = {
    getUser: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    exchangeCodeForSession: vi.fn(),
  };
  return {
    auth,
    createServerClient: vi.fn(),
    from: vi.fn(),
    cookieSet: vi.fn(),
    cookieJar: [] as Array<{ name: string; value: string }>,
    cookiesThrow: false,
  };
});

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (mocks.cookiesThrow) throw new Error("`cookies` was called outside a request scope.");
    return { getAll: () => mocks.cookieJar, set: mocks.cookieSet, get: () => undefined };
  },
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`__redirect__:${url}`);
  },
}));

import { GET as staffCallbackGet } from "@/app/admin/auth/callback/route";
import {
  requestStaffPasswordReset,
  setNewStaffPassword,
} from "@/lib/admin/actions";
import { getStaffAuthOrigin, staffAuthOrigin } from "@/lib/admin/origin";
import {
  STAFF_CALLBACK_DESTINATIONS,
  staffCallbackDestination,
  staffNewPasswordSchema,
  staffPasswordResetRequestSchema,
} from "@/lib/admin/validation";

const STAGING_URL = `https://${projects.staging}.supabase.co`;
const FAKE_PUBLISHABLE_KEY = "sb_publishable_fake_test_key_1234567890";
const USER_ID = "11111111-2222-4333-8444-555555555555";
const STAFF_EMAIL = "staff@example.com";

function fakeUser(overrides: Record<string, unknown> = {}): User {
  return {
    id: USER_ID,
    email: STAFF_EMAIL,
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
  const terminal = (): QuerySpec => {
    const queue = tableQueues.get(table);
    if (queue && queue.length > 0) return queue.shift() as QuerySpec;
    return { data: null, error: null };
  };
  query.then = (resolve: (value: QuerySpec) => void, reject?: (reason: unknown) => void) =>
    Promise.resolve(terminal()).then(resolve, reject);
  return query;
}

function setTable(table: string, ...specs: QuerySpec[]) {
  tableQueues.set(table, [...specs]);
}

function formData(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

function stubStaffEnv() {
  vi.stubEnv("SUPABASE_URL", STAGING_URL);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", FAKE_PUBLISHABLE_KEY);
  vi.stubEnv("SITE_URL", "https://preview.test.invalid");
  // Pin the Vercel branch-origin inputs to empty so an ambient
  // VERCEL_ENV / VERCEL_BRANCH_URL (e.g. Vercel CI) can never leak
  // into tests that read the origin through getStaffAuthOrigin();
  // tests that need preview values stub them explicitly after this.
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL_BRANCH_URL", "");
}

function callbackRequest(query: string): NextRequest {
  return new NextRequest(
    new URL(`https://preview.test.invalid/admin/auth/callback${query}`),
  );
}

function signedInStaff() {
  mocks.auth.getUser.mockResolvedValue({
    data: { user: fakeUser() },
    error: null,
  });
  setTable("user_roles", { data: [{ role: "owner" }], error: null });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookiesThrow = false;
  mocks.cookieJar.length = 0;
  queryCalls.length = 0;
  tableQueues.clear();
  mocks.createServerClient.mockImplementation(() => ({
    auth: mocks.auth,
    from: mocks.from,
  }));
  mocks.from.mockImplementation((table: string) => makeQuery(table));
  mocks.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mocks.auth.updateUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.auth.signOut.mockResolvedValue({ error: null });
  mocks.auth.exchangeCodeForSession.mockResolvedValue({
    data: { user: null, session: null },
    error: null,
  });
  stubStaffEnv();
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

describe("staff reset origin", () => {
  it("uses SITE_URL, and the Preview branch URL wins on preview", () => {
    expect(
      staffAuthOrigin({
        SITE_URL: "https://preview.test.invalid",
        VERCEL_ENV: "",
        VERCEL_BRANCH_URL: "",
      }),
    ).toBe("https://preview.test.invalid");
    expect(
      staffAuthOrigin({
        SITE_URL: "https://preview.test.invalid",
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "branch-xyz-fahim-s-projects1.vercel.app",
      }),
    ).toBe("https://branch-xyz-fahim-s-projects1.vercel.app");
    expect(
      staffAuthOrigin({ SITE_URL: "not a url", VERCEL_ENV: "" }),
    ).toBeNull();
  });

  it("reads the origin from process env", () => {
    expect(getStaffAuthOrigin()).toBe("https://preview.test.invalid");
  });
});

describe("staff callback destinations (exact-match allowlist)", () => {
  it("allows only the reset page", () => {
    expect(STAFF_CALLBACK_DESTINATIONS).toEqual(["/admin/reset-password"]);
    expect(staffCallbackDestination("/admin/reset-password")).toBe(
      "/admin/reset-password",
    );
    expect(staffCallbackDestination("/account")).toBe("/admin/reset-password");
    expect(staffCallbackDestination("/admin")).toBe("/admin/reset-password");
    expect(staffCallbackDestination("https://evil.test/admin/reset-password")).toBe(
      "/admin/reset-password",
    );
    expect(staffCallbackDestination(undefined)).toBe("/admin/reset-password");
  });
});

describe("staff reset validation", () => {
  it("rejects bad emails and short passwords", () => {
    expect(
      staffPasswordResetRequestSchema.safeParse({ email: "not-an-email" }).success,
    ).toBe(false);
    expect(
      staffPasswordResetRequestSchema.safeParse({ email: STAFF_EMAIL }).success,
    ).toBe(true);
    expect(staffNewPasswordSchema.safeParse({ password: "short" }).success).toBe(
      false,
    );
    expect(
      staffNewPasswordSchema.safeParse({ password: "long-enough-1" }).success,
    ).toBe(true);
  });
});

describe("requestStaffPasswordReset", () => {
  it("rejects an invalid email without calling Supabase", async () => {
    const result = await requestStaffPasswordReset(
      {},
      formData({ email: "not-an-email" }),
    );
    expect(result.error).toBe("Enter a valid email address.");
    expect(mocks.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("sends the staff reset link for any valid email, same message either way", async () => {
    const result = await requestStaffPasswordReset(
      {},
      formData({ email: STAFF_EMAIL }),
    );
    expect(result.success).toBe(
      "If this email belongs to a staff account, a reset link is on its way. Check your inbox (and spam folder).",
    );
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith(STAFF_EMAIL, {
      redirectTo:
        "https://preview.test.invalid/admin/auth/callback?next=/admin/reset-password",
    });
    expect(result.success).not.toContain(STAFF_EMAIL);
  });

  it("still returns success when Supabase reports the email unknown", async () => {
    mocks.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "User not found", code: "user_not_found" },
    });
    const result = await requestStaffPasswordReset(
      {},
      formData({ email: "nobody@example.com" }),
    );
    expect(result.success).toContain("reset link is on its way");
    expect(result.success).not.toContain("nobody@example.com");
  });

  it("fails honestly when no origin is configured, and when the redirect is rejected", async () => {
    vi.stubEnv("SITE_URL", "not a url");
    const unconfigured = await requestStaffPasswordReset(
      {},
      formData({ email: STAFF_EMAIL }),
    );
    expect(unconfigured.error).toBe(
      "Password reset is not available right now. Try again later.",
    );
    expect(mocks.auth.resetPasswordForEmail).not.toHaveBeenCalled();

    vi.stubEnv("SITE_URL", "https://preview.test.invalid");
    mocks.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "Redirect URL not allowed", code: "validation_failed" },
    });
    const rejected = await requestStaffPasswordReset(
      {},
      formData({ email: STAFF_EMAIL }),
    );
    expect(rejected.error).toBe(
      "Password reset is not configured for this site. Contact the store Owner.",
    );
  });
});

describe("setNewStaffPassword", () => {
  it("rejects a short password without touching the session", async () => {
    const result = await setNewStaffPassword({}, formData({ password: "short" }));
    expect(result.error).toBe("Use a password of 8–128 characters.");
    expect(mocks.auth.getUser).not.toHaveBeenCalled();
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects an expired link without a session", async () => {
    const result = await setNewStaffPassword(
      {},
      formData({ password: "new-password-1" }),
    );
    expect(result.error).toBe(
      "Your reset link has expired. Request a new link and try again.",
    );
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a non-staff session and signs it out", async () => {
    mocks.auth.getUser.mockResolvedValue({
      data: { user: fakeUser() },
      error: null,
    });
    setTable("user_roles", { data: [], error: null });
    const result = await setNewStaffPassword(
      {},
      formData({ password: "new-password-1" }),
    );
    expect(result.error).toBe("This account does not have staff access.");
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("updates the password for a staff session and ends the recovery session", async () => {
    signedInStaff();
    const result = await setNewStaffPassword(
      {},
      formData({ password: "new-password-1" }),
    );
    expect(result.success).toBe(
      "Your password was updated. Sign in with your new password and authenticator code.",
    );
    expect(mocks.auth.updateUser).toHaveBeenCalledWith({
      password: "new-password-1",
    });
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("fails honestly when the update is rejected", async () => {
    signedInStaff();
    mocks.auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "same as old password" },
    });
    const result = await setNewStaffPassword(
      {},
      formData({ password: "new-password-1" }),
    );
    expect(result.error).toBe(
      "Could not update your password. Request a new reset link and try again.",
    );
    expect(mocks.auth.signOut).not.toHaveBeenCalled();
  });
});

describe("staff auth callback", () => {
  it("rejects provider errors, missing codes, and overlong codes", async () => {
    const provider = await staffCallbackGet(
      callbackRequest("?error=access_denied"),
    );
    expect(provider.status).toBe(400);
    expect(mocks.auth.exchangeCodeForSession).not.toHaveBeenCalled();

    const missing = await staffCallbackGet(callbackRequest("?next=/admin/reset-password"));
    expect(missing.status).toBe(400);

    const overlong = await staffCallbackGet(
      callbackRequest(`?code=${"x".repeat(2049)}`),
    );
    expect(overlong.status).toBe(400);
  });

  it("rejects an expired code without a session", async () => {
    mocks.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "code expired" },
    });
    const response = await staffCallbackGet(callbackRequest("?code=fake-code"));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("invalid or expired");
    expect(mocks.auth.getUser).not.toHaveBeenCalled();
  });

  it("signs out a non-staff account and sends it to staff sign-in (denied)", async () => {
    mocks.auth.getUser.mockResolvedValue({
      data: { user: fakeUser() },
      error: null,
    });
    setTable("user_roles", { data: [], error: null });
    const response = await staffCallbackGet(
      callbackRequest("?code=fake-code&next=/admin/reset-password"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin/sign-in?denied=1");
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("sends a staff account to the reset page, and defaults any other destination", async () => {
    signedInStaff();
    const response = await staffCallbackGet(
      callbackRequest("?code=fake-code&next=/admin/reset-password"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin/reset-password");

    signedInStaff();
    const evil = await staffCallbackGet(
      callbackRequest("?code=fake-code&next=https://evil.test/admin"),
    );
    expect(evil.status).toBe(303);
    expect(evil.headers.get("Location")).toBe("/admin/reset-password");
  });
});
