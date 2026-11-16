import { z } from "zod";

/**
 * Clean SITE_URL origin for customer-auth redirects (OAuth `redirectTo`,
 * email `emailRedirectTo`, password-recovery `redirectTo`). Mirrors the
 * root app's site-url validation: a clean origin, HTTPS except
 * loopback-in-development. Pure given an env record, so the decision is
 * testable without process state.
 *
 * Missing/invalid SITE_URL yields null: auth actions that need a
 * redirect URL fail honestly ("not configured") and never fall back to
 * a Host-derived URL.
 */
export function customerAuthOrigin(env: {
  SITE_URL?: string;
  NODE_ENV?: string;
}): string | null {
  const result = z.url({ protocol: /^https?$/ }).safeParse(env.SITE_URL);
  if (!result.success) return null;
  const url = new URL(result.data);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    return null;
  if (
    url.protocol !== "https:" &&
    !(
      env.NODE_ENV === "development" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    return null;
  return url.origin;
}

export function getCustomerAuthOrigin(): string | null {
  return customerAuthOrigin(process.env);
}
