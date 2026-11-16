import { z } from "zod";

/**
 * Clean origin for customer-auth redirects (OAuth `redirectTo`, email
 * `emailRedirectTo`, password-recovery `redirectTo`). Precedence:
 *
 * 1. Vercel Preview branch URL: when `VERCEL_ENV` is `preview` and
 *    `VERCEL_BRANCH_URL` parses as a clean `*.vercel.app` hostname,
 *    return `https://$VERCEL_BRANCH_URL`. Vercel sets this variable
 *    server-side per branch deployment, so every new branch Preview
 *    redirects back to itself instead of the single branch baked into
 *    SITE_URL. An invalid value falls through to SITE_URL below.
 * 2. SITE_URL, validated exactly as before: a clean origin, HTTPS
 *    except loopback-in-development, mirroring the root app's
 *    site-url validation.
 * 3. Null ("not configured"): auth actions that need a redirect URL
 *    fail honestly and never fall back to a request-derived URL.
 *
 * Pure given an env record, so the decision is testable without
 * process state. This module never reads the request.
 */
export function customerAuthOrigin(env: {
  SITE_URL?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  VERCEL_BRANCH_URL?: string;
}): string | null {
  if (env.VERCEL_ENV === "preview") {
    const branchOrigin = previewBranchOrigin(env.VERCEL_BRANCH_URL);
    if (branchOrigin) return branchOrigin;
  }
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

/**
 * Branch-URL origin for Vercel Preview deployments. Vercel emits
 * VERCEL_BRANCH_URL as a bare hostname (no scheme, no port): anything
 * carrying a scheme, port, userinfo, path, query, or fragment is
 * rejected outright rather than letting URL parsing silently discard
 * those parts. The hostname must end in `.vercel.app` — Vercel branch
 * URLs are always vercel.app hosts, so the suffix pin bounds the
 * redirect target if the variable ever held an unexpected value.
 * Invalid input yields null so the caller falls back to SITE_URL.
 */
function previewBranchOrigin(branchUrl: string | undefined): string | null {
  if (typeof branchUrl !== "string") return null;
  const host = branchUrl.trim();
  if (!host || /[\s/:?#@\\]/.test(host)) return null;
  let url: URL;
  try {
    url = new URL(`https://${host}`);
  } catch {
    return null;
  }
  if (
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !url.hostname.endsWith(".vercel.app")
  )
    return null;
  return url.origin;
}

export function getCustomerAuthOrigin(): string | null {
  return customerAuthOrigin(process.env);
}
