import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabaseConfiguration } from "@/lib/supabase-public";

/**
 * Customer Supabase client. Mirrors the staff client shape
 * (src/lib/admin/supabase.ts) with one mandatory difference: its own
 * cookie name, so customer and staff sessions can never overwrite or
 * refresh each other in the same browser.
 *
 * Returns null when the publishable configuration is unavailable;
 * callers render honest "unavailable" behaviour, never crash. Rides
 * publicSupabaseConfiguration() (Preview -> staging, Production ->
 * production) with no staging gate of its own.
 */
export const CUSTOMER_AUTH_COOKIE = "aa-customer-auth";

/**
 * Expire the customer session cookies directly on the response.
 * The SDK's signOut can leave the browser cookie standing: when the
 * stored session can no longer be read (e.g. an expired refresh
 * token makes its session load fail), signOut returns early without
 * removing anything, and when the client itself is unavailable
 * signOut is skipped entirely — in both cases the redirect home
 * still runs and the customer looks signed in. Deleting the cookie
 * — and any chunked `.0`, `.1`, … variants — here is synchronous
 * with the action response, so the browser clears it either way.
 * It is a no-op when the SDK already cleared them, and it touches
 * only the customer cookie, never the staff session.
 */
export async function expireCustomerSessionCookies(): Promise<void> {
  let store;
  try {
    store = await cookies();
  } catch {
    return;
  }
  for (const { name } of store.getAll()) {
    if (name === CUSTOMER_AUTH_COOKIE || name.startsWith(`${CUSTOMER_AUTH_COOKIE}.`)) {
      store.set(name, "", { maxAge: 0, path: "/" });
    }
  }
}

export async function customerClient(writeCookies = false) {
  const config = publicSupabaseConfiguration();
  if (!config) return null;
  let store;
  try {
    store = await cookies();
  } catch {
    // Outside a request scope (static generation, background work):
    // there is no session to read, so fail closed like the
    // unconfigured case instead of throwing.
    return null;
  }
  return createServerClient(config.url, config.key, {
    db: { timeout: 20000, retry: false },
    global: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          cache: "no-store",
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(25000)])
            : AbortSignal.timeout(25000),
        }),
    },
    cookieOptions: {
      name: CUSTOMER_AUTH_COOKIE,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => store.getAll(),
      ...(writeCookies
        ? {
            setAll: (
              values: {
                name: string;
                value: string;
                options: import("@supabase/ssr").CookieOptions;
              }[],
            ) => {
              for (const v of values) store.set(v.name, v.value, v.options);
            },
          }
        : {}),
    },
  });
}

export type CustomerClient = NonNullable<
  Awaited<ReturnType<typeof customerClient>>
>;
