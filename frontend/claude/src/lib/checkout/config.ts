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
 * Ordering runs only when ALL of these hold:
 *  - not a production storefront (VERCEL_ENV / NODE_ENV);
 *  - STAGING_CHECKOUT_ORDERS=1 is set explicitly;
 *  - the Supabase URL is the verified Staging project;
 *  - SUPABASE_SERVICE_ROLE_KEY is present (server-only, never NEXT_PUBLIC_).
 * The database also keeps ordering disabled until its own settings flag is switched on.
 */
export function checkoutOrdersConfiguration(): CheckoutOrdersConfiguration | null {
  if (isProductionStorefront() || process.env.STAGING_CHECKOUT_ORDERS !== "1") return null;
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  if (url !== `https://${projects.staging}.supabase.co`) return null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (serviceKey.length < 20 || serviceKey === process.env.SUPABASE_PUBLISHABLE_KEY) return null;
  return { url, serviceKey };
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
