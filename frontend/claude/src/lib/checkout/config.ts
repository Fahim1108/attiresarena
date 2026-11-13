import "server-only";
import projects from "@/config/supabase-projects.json";
import { isProductionStorefront } from "@/lib/storefront-policy";
import { publicSupabaseConfiguration } from "@/lib/supabase-public";

/** HttpOnly cookie that holds the raw checkout credential. The database stores only its hash. */
export const CHECKOUT_COOKIE = "aa-checkout";

/** Fallback lifetime; the expiry returned by the database (7 days) takes precedence. */
export const CHECKOUT_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * A completed checkout answers a repeat submission with its existing order only when the
 * same items are resubmitted within this window. Otherwise the credential is treated as
 * stale and a new checkout starts, so a later purchase is never mistaken for a retry.
 */
export const DUPLICATE_SUBMISSION_WINDOW_MS = 15 * 60 * 1000;

/**
 * Real ordering is available only on verified Staging, never Production, and only when the
 * order migrations have been applied and STAGING_CHECKOUT_ORDERS=1 is set.
 */
export function checkoutOrdersConfiguration() {
  if (isProductionStorefront() || process.env.STAGING_CHECKOUT_ORDERS !== "1") return null;
  const config = publicSupabaseConfiguration();
  return config && config.url === `https://${projects.staging}.supabase.co` ? config : null;
}

export function checkoutOrdersEnabled(): boolean {
  return checkoutOrdersConfiguration() !== null;
}

/** Never readable by browser JavaScript; sent only over HTTPS on deployments. */
export function checkoutCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/checkout",
    ...(expires && Number.isFinite(expires.getTime()) ? { expires } : { maxAge: CHECKOUT_COOKIE_MAX_AGE_SECONDS }),
  };
}
