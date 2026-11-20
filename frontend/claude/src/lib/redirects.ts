import { z } from "zod";

/**
 * Storefront redirect resolution — pure functions, no server-only imports,
 * so this module is safe to run in the Edge runtime (src/proxy.ts) and in
 * unit tests.
 *
 * Data comes from public.resolve_storefront_redirects (migration
 * 20261119000800): the redirect_auto toggle plus every active
 * url_redirects row. Nothing here reads the database directly.
 */

/** One saved redirect, as returned by the RPC. */
export interface RedirectRule {
  source: string;
  target: string;
  code: 301 | 302;
}

/** Everything the proxy needs to decide one request. */
export interface RedirectConfig {
  /** The admin redirect_auto toggle. Off means: never redirect. */
  auto: boolean;
  rules: RedirectRule[];
}

const redirectRuleSchema = z.object({
  source_path: z.string().min(1).max(500),
  target_path: z.string().min(1).max(500),
  code: z.union([z.literal(301), z.literal(302)]),
});

const redirectConfigSchema = z.object({
  auto: z.boolean(),
  redirects: z.array(redirectRuleSchema),
});

/** Parse the RPC payload. Null when malformed — the caller fails open. */
export function parseRedirectConfig(value: unknown): RedirectConfig | null {
  const parsed = redirectConfigSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    auto: parsed.data.auto,
    rules: parsed.data.redirects.map((rule) => ({
      source: rule.source_path,
      target: rule.target_path,
      code: rule.code,
    })),
  };
}

/**
 * Paths a redirect must never touch, even if an admin saves one: the admin
 * panel, API routes, and framework internals. The RPC already excludes
 * these sources; this is the second layer, applied to the request path.
 */
export function isProtectedPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/_vercel/")
  );
}

/**
 * Compare paths ignoring a single trailing slash ("/old/" matches a saved
 * "/old" and vice versa) and ignoring any query string or hash. "/" stays
 * "/".
 */
export function normalizeRedirectPath(pathname: string): string {
  const bare = pathname.split(/[?#]/, 1)[0] ?? "/";
  if (bare.length > 1 && bare.endsWith("/")) return bare.slice(0, -1);
  return bare === "" ? "/" : bare;
}

/**
 * The rule for this path, or null. Null when the toggle is off, when the
 * path is protected, or when no saved source matches.
 */
export function matchRedirect(
  pathname: string,
  config: RedirectConfig,
): RedirectRule | null {
  if (!config.auto) return null;
  const path = normalizeRedirectPath(pathname);
  if (isProtectedPath(path)) return null;
  return (
    config.rules.find(
      (rule) => normalizeRedirectPath(rule.source) === path,
    ) ?? null
  );
}

export interface ResolvedRedirect {
  url: string;
  code: 301 | 302;
}

/**
 * Resolve one request URL to its redirect destination, or null when no
 * redirect applies. The request query string is preserved unless the
 * target carries its own query, which wins. Absolute (http(s)) targets
 * are used as-is; site paths resolve against the request origin.
 */
export function resolveStorefrontRedirect(
  requestUrl: string,
  config: RedirectConfig,
): ResolvedRedirect | null {
  let request: URL;
  try {
    request = new URL(requestUrl);
  } catch {
    return null;
  }
  const rule = matchRedirect(request.pathname, config);
  if (!rule) return null;
  const targetHasQuery = rule.target.includes("?");
  if (/^https?:\/\//i.test(rule.target)) {
    return {
      url:
        !targetHasQuery && request.search
          ? `${rule.target}${request.search}`
          : rule.target,
      code: rule.code,
    };
  }
  const destination = new URL(rule.target, request.origin);
  if (!targetHasQuery && request.search) destination.search = request.search;
  return { url: destination.toString(), code: rule.code };
}

export type RedirectConfigFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

/**
 * Fetch the redirect config from Supabase via the publishable key. Any
 * failure — missing config, non-OK response, malformed payload — returns
 * null, so the caller serves the request normally (fail open).
 */
export async function fetchRedirectConfig(
  supabaseUrl: string,
  publishableKey: string,
  fetchImpl: RedirectConfigFetcher = fetch,
): Promise<RedirectConfig | null> {
  try {
    const response = await fetchImpl(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/resolve_storefront_redirects`,
      {
        method: "POST",
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${publishableKey}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json().catch(() => null);
    return parseRedirectConfig(body);
  } catch {
    return null;
  }
}

export type RedirectConfigLoader = () => Promise<RedirectConfig | null>;

/**
 * Cache a config loader for ttlMs (default 60s) so the proxy does not hit
 * the database on every request. A failed load caches null for the same
 * window — the storefront keeps serving normally and retries after the
 * TTL. `now` is injectable for tests.
 */
export function createCachedRedirectConfig(
  loader: RedirectConfigLoader,
  ttlMs = 60_000,
  now: () => number = Date.now,
): RedirectConfigLoader {
  let cached: { at: number; value: RedirectConfig | null } | null = null;
  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    const value = await loader().catch(() => null);
    cached = { at: now(), value };
    return value;
  };
}
