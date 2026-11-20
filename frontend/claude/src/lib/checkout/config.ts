import "server-only";
import projects from "@/config/supabase-projects.json";
import { isProductionStorefront } from "@/lib/storefront-policy";

/** HttpOnly cookie that holds the raw checkout credential. The database stores only its hash. */
export const CHECKOUT_COOKIE = "aa-checkout";

/** Fallback lifetime; the expiry returned by the database (7 days) takes precedence. */
export const CHECKOUT_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface CheckoutOrdersConfiguration {
  url: string;
  /**
   * Server-only trusted credential. The database refuses anonymous callers for every checkout
   * RPC, so guests can only act through this server. It is read from a server-only variable and
   * is never returned to the browser.
   */
  serviceKey: string;
}

/**
 * Ordering runs only when ALL of these hold, on exactly one of two paths:
 *  - Staging/Preview: not a production storefront; STAGING_CHECKOUT_ORDERS=1
 *    is set explicitly; the Supabase URL is the verified Staging project.
 *  - Production: a production storefront; PRODUCTION_CHECKOUT_ORDERS=1 is set
 *    explicitly (Production scope); the Supabase URL is the verified
 *    Production project.
 * Both paths additionally require SUPABASE_SERVICE_ROLE_KEY (server-only,
 * never NEXT_PUBLIC_, at least 20 characters, different from the publishable
 * key). Neither flag enables the other path, and neither flag can enable
 * ordering against the wrong project: a staging flag on production, or a
 * production flag on a Preview, both return null. "Production storefront"
 * follows isProductionStorefront(): VERCEL_ENV=production, or a production
 * Node run with VERCEL_ENV unset — the latter still needs the explicit flag,
 * the pinned production URL, and a valid service key, so it is opt-in too.
 * The database keeps ordering disabled until its own settings flag is
 * switched on: the checkout RPCs refuse with CK008 while orders_enabled is
 * false, on either project. This code can therefore never enable ordering by
 * itself — the owner must also flip orders_enabled in the database.
 */
export function checkoutOrdersConfiguration(): CheckoutOrdersConfiguration | null {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (serviceKey.length < 20 || serviceKey === process.env.SUPABASE_PUBLISHABLE_KEY) return null;
  if (isProductionStorefront()) {
    if (process.env.PRODUCTION_CHECKOUT_ORDERS !== "1") return null;
    if (url !== `https://${projects.production}.supabase.co`) return null;
    return { url, serviceKey };
  }
  if (process.env.STAGING_CHECKOUT_ORDERS !== "1") return null;
  if (url !== `https://${projects.staging}.supabase.co`) return null;
  return { url, serviceKey };
}

export function checkoutOrdersEnabled(): boolean {
  return checkoutOrdersConfiguration() !== null;
}

/**
 * Trusted server credential for the guest order-tracking lookup
 * (public.customer_track_order_by_phone, migration
 * 20261119000500). Same credential rules as checkout — server-only
 * SUPABASE_SERVICE_ROLE_KEY, pinned project URL — but deliberately
 * NOT gated by the checkout-orders flags: tracking must keep working
 * when ordering is switched off, and switching ordering on must never
 * silently enable tracking. Returns null when the credential is
 * unavailable; callers fail closed (order not found), never crash.
 */
export function trackingRpcConfiguration(): CheckoutOrdersConfiguration | null {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (serviceKey.length < 20 || serviceKey === process.env.SUPABASE_PUBLISHABLE_KEY) return null;
  if (url !== `https://${isProductionStorefront() ? projects.production : projects.staging}.supabase.co`) return null;
  return { url, serviceKey };
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
