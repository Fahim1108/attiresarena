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
