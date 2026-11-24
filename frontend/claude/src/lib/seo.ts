import type { Metadata, MetadataRoute } from "next";

/**
 * Pure SEO resolvers shared by the root layout metadata, `app/robots.ts`,
 * `app/sitemap.ts`, per-page `generateMetadata`, and `next.config.ts`.
 *
 * This module has NO runtime imports on purpose: `next.config.ts` imports
 * the header/redirect builders from it, and the config loader must never
 * pull in server-only code, settings schemas, or request state. Every
 * function here is pure given its inputs, so the environment matrix is
 * unit-testable without process state.
 *
 * ENVIRONMENT RULE (binding): Preview/dev deployments are NEVER indexable,
 * regardless of the stored admin toggles. Production indexing follows the
 * stored `seo_robots` toggle, failing closed (noindex) when the toggle is
 * unset or malformed. Private pages are noindex in EVERY environment (see
 * PRIVATE_PAGE_ROBOTS and the per-page exports). Canonicals always use
 * the apex base, never a Preview branch URL.
 *
 * The ONLY runtime environment input is the production-vs-not check below,
 * which mirrors `isProductionStorefront()` in `./storefront-policy`. The
 * BUILD-TIME header/redirect builders are the one exception: they branch
 * on `VERCEL_ENV === "production"` ONLY (see `isProductionBuildEnv`),
 * because Next forces `NODE_ENV=production` during every build. Fixture
 * gating (`CLAUDE_DESIGN_PREVIEW` / `reviewInventoryEnabled`) and request
 * data (host, cookies, query) must NEVER feed these decisions.
 */

export interface SeoEnv {
  VERCEL_ENV?: string;
  NODE_ENV?: string;
}

/** Pure form of `isProductionStorefront()`: production iff Vercel says so, or a production Node run with no Vercel env. */
export function isProductionEnv(env: SeoEnv): boolean {
  return (
    env.VERCEL_ENV === "production" ||
    (env.NODE_ENV === "production" && !env.VERCEL_ENV)
  );
}

export interface SeoRobotsInput {
  index: boolean;
  follow: boolean;
}

export interface IndexingPolicy {
  /** Meta robots for PUBLIC pages. Private pages ignore this (always noindex). */
  metaRobots: SeoRobotsInput;
  /** robots.txt posture: "allow" serves Allow + private disallows + sitemap ref; "disallow-all" serves Disallow: / with no sitemap ref. */
  robotsTxt: "allow" | "disallow-all";
  /** Whether a non-empty sitemap may be served at all. */
  sitemapAllowed: boolean;
}

/**
 * One resolver for every indexing surface. Off-production, the stored
 * toggle is IGNORED (fail closed). On production, an unset/malformed
 * toggle (null) also fails closed. Only production + stored index:true
 * opens crawling and the sitemap; follow stays per-toggle.
 */
export function resolveIndexingPolicy(input: {
  isProduction: boolean;
  robots: SeoRobotsInput | null;
}): IndexingPolicy {
  if (!input.isProduction) {
    return {
      metaRobots: { index: false, follow: false },
      robotsTxt: "disallow-all",
      sitemapAllowed: false,
    };
  }
  const robots = input.robots ?? { index: false, follow: false };
  return {
    metaRobots: { index: robots.index, follow: robots.follow },
    robotsTxt: robots.index ? "allow" : "disallow-all",
    sitemapAllowed: robots.index,
  };
}

// ---------------------------------------------------------------------------
// Private-path set (defined once, shared by headers, robots.txt, and pages)
// ---------------------------------------------------------------------------

/** Robots directive shared by every private page/layout. Noindex ALWAYS, in every environment, regardless of the stored toggle. */
export const PRIVATE_PAGE_ROBOTS: SeoRobotsInput = {
  index: false,
  follow: false,
};

/**
 * Robots directive for filtered/search/sorted/paginated listing variants:
 * the variant URL itself must not be indexed (the clean listing URL is the
 * canonical), but links on it (to products) are still followed so the
 * variant never hides products from discovery.
 */
export const LISTING_VARIANT_ROBOTS: SeoRobotsInput = {
  index: false,
  follow: true,
};

/**
 * Header `source` patterns for the private set. `:path*` matches the bare
 * segment too (zero or more segments), so `/admin/:path*` covers `/admin`,
 * `/admin/`, and everything below it. `/auth/:path*` covers the OAuth
 * callback, which must never be crawled.
 */
export const SEO_PRIVATE_HEADER_SOURCES: readonly string[] = [
  "/admin/:path*",
  "/account/:path*",
  "/auth/:path*",
  "/cart",
  "/checkout",
  "/wishlist",
  "/track-order",
  "/motion-preview",
  "/loader-preview",
];

/**
 * robots.txt disallow entries for the same set. Disallow lines are prefix
 * matches: the bare form (`/admin`) covers the tree, and the trailing-slash
 * form is listed alongside it so the intent reads explicitly. Exact paths
 * (cart, checkout, ...) have no children to cover.
 */
export const SEO_PRIVATE_ROBOTS_DISALLOW: readonly string[] = [
  "/admin",
  "/admin/",
  "/account",
  "/account/",
  "/auth",
  "/auth/",
  "/cart",
  "/checkout",
  "/wishlist",
  "/track-order",
  "/motion-preview",
  "/loader-preview",
];

/**
 * AI-search crawler / token names allowed explicitly in robots.txt when
 * indexing is ON (AI-search readiness). Every token was verified against
 * vendor documentation (2026-11-19): GPTBot / OAI-SearchBot /
 * ChatGPT-User (OpenAI — training, ChatGPT search, live user fetch),
 * ClaudeBot / Claude-SearchBot / Claude-User (Anthropic — same three
 * jobs), PerplexityBot / Perplexity-User (Perplexity — search, live
 * fetch), Google-Extended / Applebot-Extended (robots.txt product
 * tokens, not crawlers — they govern whether already-crawled content
 * may be used for Gemini / Apple AI training), CCBot (Common Crawl —
 * the open dataset many AI trainers use), meta-externalagent (Meta —
 * vendor token is lowercase), Meta-WebIndexer (Meta — search indexer;
 * allowing it helps Meta AI cite and link to the content),
 * meta-externalfetcher (Meta — user-triggered fetcher; Meta says it
 * may bypass robots.txt, listed for explicitness only). No other bot
 * names are listed: tokens that could not be verified against vendor
 * docs are left out rather than guessed. The AI group repeats the
 * private disallows (see buildRobots): a bot matching its own group
 * uses ONLY that group's rules, so an Allow-only AI group would
 * accidentally open private paths to AI crawlers. When indexing is OFF
 * or off-production, the disallow-all group covers AI bots too —
 * nothing changes there.
 */
export const AI_SEARCH_BOT_USER_AGENTS: readonly string[] = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "meta-externalagent",
  "Meta-WebIndexer",
  "meta-externalfetcher",
];

// ---------------------------------------------------------------------------
// next.config.ts builders (build-time env ONLY — no stored toggles exist here)
// ---------------------------------------------------------------------------

export interface SeoHeaderEntry {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

/**
 * Build-time production check for `next.config.ts` ONLY: `VERCEL_ENV`
 * must literally be `production`. This deliberately differs from
 * `isProductionEnv`: Next forces `NODE_ENV=production` during every
 * build, so NODE_ENV cannot distinguish a Preview build from a
 * production build, and an unset/unknown VERCEL_ENV must fail closed to
 * the global noindex header. Runtime decisions (meta robots, robots.txt,
 * sitemap) keep using `isProductionStorefront()` semantics.
 */
export function isProductionBuildEnv(env: SeoEnv): boolean {
  return env.VERCEL_ENV === "production";
}

/**
 * Content-Security-Policy allowlist, verified against the code that
 * actually runs (2026-11-21 security fix):
 * - script-src: Next.js inline bootstrap scripts + the Meta Pixel
 *   snippet (connect.facebook.net) + Google Analytics (googletagmanager.com).
 *   'unsafe-inline' is required by Next.js inline scripts and by the
 *   Pixel/GA bootstrap snippets in MarketingScripts.
 * - img-src / connect-src: Supabase (*.supabase.co, https + wss) for data
 *   and media, plus GA (*.google-analytics.com) and Pixel (facebook.com)
 *   beacons. blob:/data: cover locally-generated images (QR / previews).
 * - frame-src: the admin same-origin appearance-preview iframe + the
 *   privacy-enhanced YouTube embed (youtube-nocookie.com) on product
 *   pages. frame-ancestors 'none' matches the existing X-Frame-Options:
 *   DENY posture.
 * - Owner custom code (admin slots) still runs when it is inline;
 *   third-party hosts it pulls in are blocked unless allowlisted here —
 *   an owner pasting a chat widget or another tracker must ask for its
 *   host to be added.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://connect.facebook.net https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://*.google-analytics.com https://www.facebook.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.google-analytics.com https://www.facebook.com https://connect.facebook.net",
  "font-src 'self' data:",
  "frame-src 'self' https://www.youtube-nocookie.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

function securityHeaders(): Array<{ key: string; value: string }> {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
    // No `preload`: the domain is not submitted to the HSTS preload list,
    // and preload would lock every subdomain into HTTPS permanently.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  ];
}

/**
 * Header table for `next.config.ts`. Production builds (VERCEL_ENV ===
 * "production", the ONLY build-time signal) scope the X-Robots-Tag to
 * the private paths (security headers stay global); every other build —
 * Preview, development, unset, or unknown — keeps the historical global
 * noindex entry byte-identically (fail closed when the build environment
 * is unknown). The private-path entries come AFTER the broad entry so
 * the last-wins header-override rule can never resurrect a global
 * noindex on them — the broad entry carries no X-Robots-Tag at all on
 * production builds.
 */
export function buildSeoHeaders(env: SeoEnv): SeoHeaderEntry[] {
  if (isProductionBuildEnv(env)) {
    return [
      { source: "/:path*", headers: securityHeaders() },
      ...SEO_PRIVATE_HEADER_SOURCES.map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  }
  return [
    {
      source: "/:path*",
      headers: [
        ...securityHeaders(),
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
  ];
}

export interface SeoRedirectEntry {
  source: string;
  destination: string;
  permanent: boolean;
  has?: Array<{ type: "host"; value: string }>;
}

/**
 * Redirect table for `next.config.ts`. The legacy taxonomy redirect is
 * unconditional. The www → apex host redirect is included ONLY in
 * production builds (VERCEL_ENV === "production") AND is host-scoped to
 * `www.attiresarena.com`, so a Preview branch host can never match it
 * even if the entry were present. It matches the apex canonicals (SEO-5).
 * No trailing-slash rule: its interplay with the proxy gate is untested
 * (flagged follow-up).
 */
export function buildSeoRedirects(env: SeoEnv): SeoRedirectEntry[] {
  const redirects: SeoRedirectEntry[] = [
    {
      source: "/admin/taxonomy",
      destination: "/admin/catalogue",
      permanent: true,
    },
  ];
  if (isProductionBuildEnv(env)) {
    redirects.push({
      source: "/:path*",
      destination: "https://attiresarena.com/:path*",
      permanent: true,
      has: [{ type: "host", value: "www.attiresarena.com" }],
    });
  }
  return redirects;
}

// ---------------------------------------------------------------------------
// Canonical base + absolute URLs (apex always, never a Preview branch URL)
// ---------------------------------------------------------------------------

/** Parse an absolute http(s) URL; null for anything else (same fail-safe as the old local parser in store-settings). */
export function parseAbsoluteHttpUrl(value: string | null): string | null {
  if (value === null || !/^https?:\/\//.test(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical base: a valid stored `seo_canonical_base_url`
 * wins, anything else falls back to the static apex URL. The result has
 * no trailing slash so `canonicalUrl` can join paths with exactly one.
 */
export function resolveCanonicalBase(
  stored: string | null,
  fallback: string,
): string {
  const parsed = parseAbsoluteHttpUrl(stored);
  const base = parsed ?? fallback;
  return base.replace(/\/+$/, "") || fallback;
}

/** Resolve the canonical base from a stored-settings record (trimmed, fail-safe). */
export function resolveSeoBaseUrl(
  settings: Record<string, unknown> | null | undefined,
  fallback: string,
): string {
  const stored = settings?.["seo_canonical_base_url"];
  const text =
    typeof stored === "string" && stored.trim() ? stored.trim() : null;
  return resolveCanonicalBase(text, fallback);
}

/** Absolute canonical/sitemap URL: base + clean path (no query string ever). */
export function canonicalUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${base}${clean}`;
}

// ---------------------------------------------------------------------------
// Per-page SEO overrides (SEO-6) — stored seo_page_overrides, read via getStorefrontContent
// ---------------------------------------------------------------------------

export type SeoPageSlug = "home" | "shop" | "about" | "contact";

/**
 * Parse one page's stored override. Empty/whitespace values degrade to
 * "no override" for that field (same fail-safe philosophy as settingText),
 * so a half-filled override never blanks a title or description.
 */
export function parsePageSeoOverride(
  value: unknown,
  slug: SeoPageSlug,
): { title?: string; description?: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = (value as Record<string, unknown>)[slug];
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : undefined;
  const description =
    typeof record.description === "string" && record.description.trim()
      ? record.description.trim()
      : undefined;
  if (title === undefined && description === undefined) return null;
  return { ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) };
}

/** Stored Twitter card when valid, else null (caller picks the page default). */
export function resolveTwitterCard(
  settings: Record<string, unknown> | null | undefined,
): "summary" | "summary_large_image" | null {
  const value = settings?.["seo_twitter_card"];
  if (value === "summary" || value === "summary_large_image") return value;
  return null;
}

// ---------------------------------------------------------------------------
// Product/category SEO fields (SEO-7) — ONE render rule, TWO write caps
// ---------------------------------------------------------------------------

/**
 * Write-cap asymmetry, documented once: legacy thrift-intake rows cap SEO
 * text at 70/160 chars (migration 20261028000300 + IntakeEditor), while
 * admin-panel products/categories cap at 160/320 (+500 keywords). The
 * write caps are UNCHANGED in this build. The render rule below treats
 * both identically and truncates only SEO-sourced values at the wider
 * caps, so every value legal under either write cap renders in full and
 * fallback output (no SEO data) is byte-identical to before.
 *
 * LIVE DATA: the feed RPCs return SEO columns only once migration
 * 20261119001100 (authored, NOT applied — gated approval still needed)
 * lands. Until then the type fields + projector passthrough + this
 * resolver stand ready and every page falls back byte-identically.
 * Category SEO additionally flows through the new public
 * `published_categories` read path in the same migration, merged onto
 * the static category config by exact slug match.
 */
export interface EntitySeoInput {
  seoTitle?: string | null;
  seoDescription?: string | null;
  /** Admin-panel products only: thrift rows have no keywords column. Never invent. */
  metaKeywords?: string | null;
}

export interface ResolvedEntitySeo {
  title: string;
  description: string;
  keywords?: string[];
}

/** Single render rule: trimmed seo_* else name/description; keywords from admin-panel shape only. */
export function resolveEntitySeo(
  input: EntitySeoInput,
  fallback: { name: string; description: string },
): ResolvedEntitySeo {
  const seoTitle =
    typeof input.seoTitle === "string" && input.seoTitle.trim()
      ? input.seoTitle.trim()
      : null;
  const seoDescription =
    typeof input.seoDescription === "string" && input.seoDescription.trim()
      ? input.seoDescription.trim()
      : null;
  const keywordsValue =
    typeof input.metaKeywords === "string" ? input.metaKeywords : null;
  const keywords = keywordsValue
    ? keywordsValue
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  return {
    title: seoTitle ? seoTitle.slice(0, 160) : fallback.name,
    description: seoDescription
      ? seoDescription.slice(0, 320)
      : fallback.description,
    ...(keywords.length > 0 ? { keywords } : {}),
  };
}

/**
 * Lenient SEO-field extraction for feed-row projectors. SEO is an
 * enhancement, never a reason to drop a row: invalid/absent values yield
 * nulls. Thrift call sites pass `keywords: false` (no keywords column);
 * admin-panel call sites pass `keywords: true`.
 */
export function extractRowSeoFields(
  row: Record<string, unknown>,
  options: { keywords: boolean },
): {
  seoTitle: string | null;
  seoDescription: string | null;
  metaKeywords: string | null;
} {
  const pick = (key: string): string | null => {
    const value = row[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };
  return {
    seoTitle: pick("seo_title"),
    seoDescription: pick("seo_description"),
    metaKeywords: options.keywords ? pick("meta_keywords") : null,
  };
}

// ---------------------------------------------------------------------------
// Search Console verification (SEO-11) — render-only in this build
// ---------------------------------------------------------------------------

/**
 * Parse a stored `google_search_console_verification` value. Rendered via
 * Next.js `verification: { google }` when present. The setting key is in
 * the code allowlist (SETTING_KEYS + SEO_EXTENDED_SCHEMA) and the DB
 * allowlist (migration 20261119000400, authored — saving fails until
 * that migration is applied). Tokens are long opaque strings: trimmed,
 * ≤500 chars, no whitespace or markup-significant characters. Never
 * render an empty verification.
 */
export function parseGoogleVerification(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (
    !token ||
    token.length > 500 ||
    /\s/.test(token) ||
    /[<>"']/.test(token)
  ) {
    return null;
  }
  return token;
}

// ---------------------------------------------------------------------------
// Listing parameter variants (SEO-12)
// ---------------------------------------------------------------------------

/** URL vocabulary written by parseProductQuery/toSearchParams. Any of these present (non-empty) makes a listing URL a filter/search/sort/page variant. */
export const LISTING_PARAM_KEYS: readonly string[] = [
  "q",
  "category",
  "brand",
  "sizes",
  "shirt",
  "collection",
  "available",
  "min",
  "max",
  "sort",
  "offers",
  "page",
];

/** True when the search params carry any recognized listing parameter. Unrecognized params (e.g. utm_*) do not count. */
export function hasListingParams(
  searchParams: Record<string, string | string[] | undefined>,
): boolean {
  return LISTING_PARAM_KEYS.some((key) => {
    const value = searchParams[key];
    if (value === undefined) return false;
    const values = Array.isArray(value) ? value : [value];
    return values.some((entry) => entry.trim() !== "");
  });
}

// ---------------------------------------------------------------------------
// Sitemap entries (SEO-2) — pure builder; the route file supplies live data
// ---------------------------------------------------------------------------

export interface SitemapToggles {
  includeShop: boolean;
  includeCategories: boolean;
  includePolicies: boolean;
  includeProducts: boolean;
}

export interface SitemapEntry {
  url: string;
  lastModified?: string;
  priority?: number;
}

/**
 * Build sitemap entries. Home + about + contact + FAQ are ALWAYS included
 * (no toggle covers them and excluding the homepage would be absurd);
 * shop/categories/policies/products honour their toggles (null toggles =
 * all off). Categories: available ones only — coming-soon categories are
 * by design, not indexable listings. Products: reviewOnly fixtures are
 * EXCLUDED (never advertise design-review copies). Product lastModified
 * is updated_at when the feed returns it (migration 20261119001100),
 * else the first-publication/creation date; category lastModified is
 * updated_at when the category read path returns it, else omitted.
 * Never `new Date()`. changeFrequency is omitted (Google ignores it).
 * Priorities are static and modest. Brands, collections, listing
 * indexes, private paths, and query-string URLs are deliberately
 * excluded.
 */
export function buildSitemapEntries(input: {
  baseUrl: string;
  toggles: SitemapToggles | null;
  products: Array<{ slug: string; createdAt: string; updatedAt?: string; reviewOnly?: boolean }>;
  categories: Array<{ slug: string; available?: boolean; updatedAt?: string }>;
  policySlugs: string[];
}): SitemapEntry[] {
  const toggles = input.toggles ?? {
    includeShop: false,
    includeCategories: false,
    includePolicies: false,
    includeProducts: false,
  };
  const url = (path: string) => canonicalUrl(input.baseUrl, path);
  const entries: SitemapEntry[] = [
    { url: url("/"), priority: 1 },
    { url: url("/about"), priority: 0.5 },
    { url: url("/contact"), priority: 0.5 },
    { url: url("/faq"), priority: 0.5 },
  ];
  if (toggles.includeShop) {
    entries.push({ url: url("/shop"), priority: 0.8 });
  }
  if (toggles.includeCategories) {
    for (const category of input.categories) {
      if (category.available !== true) continue;
      const lastModified = parsableSitemapDate(category.updatedAt);
      entries.push({
        url: url(`/category/${category.slug}`),
        ...(lastModified ? { lastModified } : {}),
        priority: 0.8,
      });
    }
  }
  if (toggles.includePolicies) {
    for (const slug of input.policySlugs) {
      entries.push({ url: url(`/${slug}`), priority: 0.4 });
    }
  }
  if (toggles.includeProducts) {
    for (const product of input.products) {
      if (product.reviewOnly === true) continue;
      const lastModified =
        parsableSitemapDate(product.updatedAt) ??
        parsableSitemapDate(product.createdAt);
      entries.push({
        url: url(`/product/${product.slug}`),
        ...(lastModified ? { lastModified } : {}),
        priority: 0.6,
      });
    }
  }
  return entries;
}

/** A parsable ISO date string, else undefined (never throws, never `new Date()`). */
function parsableSitemapDate(value: string | undefined): string | undefined {
  return value !== undefined && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

// ---------------------------------------------------------------------------
// llms.txt (AI-search readiness) — pure builder; the route files supply live data
// ---------------------------------------------------------------------------

/** Minimal no-content response while indexing is off or off-production: the store name + an explicit statement, no links, no products. Sitemap-consistent in the sense that matters — nothing is advertised while indexing is off. */
export const LLMS_TXT_OFF_TEXT = `# Attires Arena\n\n> Search indexing is off for this store.\n`;

export interface LlmsTxtInput {
  baseUrl: string;
  /** False when indexing is off or off-production: the minimal response above. */
  allowed: boolean;
  products: Array<{
    slug: string;
    name: string;
    /** Whole BDT (Money). Rendered as-is, never invented. */
    price: number;
    description?: string;
    reviewOnly?: boolean;
  }>;
  categories: Array<{ slug: string; name: string; available?: boolean }>;
  /**
   * Sitemap inclusion toggles, passed through by the llms loader
   * (src/lib/llms.ts) from parseSeoSitemap — the same keys the sitemap
   * route honours. Omitted = include (existing callers/tests keep
   * listing); explicit false omits that whole section. The loader
   * passes `?? false`, so unparsable/missing toggles list neither
   * products nor categories — the same null = all-off rule as
   * buildSitemapEntries.
   */
  includeProducts?: boolean;
  includeCategories?: boolean;
  /** llms-full.txt: adds each product's real description line. */
  full?: boolean;
}

/**
 * Build llms.txt (or llms-full.txt with full: true). Same slug universe
 * as the sitemap: real published products/categories only, reviewOnly
 * fixtures excluded, available-only categories. The sitemap inclusion
 * toggles gate this file too (review fix S1): includeProducts /
 * includeCategories off omits that whole section, so llms.txt can
 * never advertise what the owner chose to leave out of the sitemap.
 * The summary and delivery lines use the owner's own target phrases
 * (Fahim, 2026-11-19): "Best thrift collection in Bangladesh", thrift
 * at reasonable prices, delivery across Bangladesh including Barishal
 * division (Barishal is in the checkout address data,
 * src/data/bangladesh.ts — no shop location is claimed). No other
 * marketing copy is written here.
 */
export function buildLlmsTxt(input: LlmsTxtInput): string {
  if (!input.allowed) return LLMS_TXT_OFF_TEXT;
  const url = (path: string) => canonicalUrl(input.baseUrl, path);
  const lines: string[] = [
    "# Attires Arena",
    "",
    "> Best thrift collection in Bangladesh. Individual thrift shirts at reasonable prices, delivered across Bangladesh.",
    "",
    "Delivery is available across Bangladesh, including Barishal division, with Cash on Delivery.",
    "",
    "## Pages",
    "",
    `- [Home](${url("/")})`,
    `- [Shop](${url("/shop")})`,
    `- [About](${url("/about")})`,
    `- [Contact](${url("/contact")})`,
    `- [FAQ](${url("/faq")})`,
    "",
  ];
  if (input.includeCategories !== false) {
    lines.push("## Categories", "");
    for (const category of input.categories) {
      if (category.available !== true) continue;
      lines.push(`- [${category.name}](${url(`/category/${category.slug}`)})`);
    }
    lines.push("");
  }
  if (input.includeProducts !== false) {
    lines.push("## Products", "");
    for (const product of input.products) {
      if (product.reviewOnly === true) continue;
      lines.push(
        `- [${product.name}](${url(`/product/${product.slug}`)}) — BDT ${product.price}`,
      );
      if (input.full) {
        const description =
          typeof product.description === "string"
            ? product.description.trim()
            : "";
        if (description) lines.push(`  ${description.slice(0, 320)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// robots.txt object (SEO-3) — pure builder; the route file supplies policy
// ---------------------------------------------------------------------------

/** robots.txt: disallow-all with NO sitemap ref unless the policy allows crawling; otherwise Allow + private disallows + sitemap ref, with an explicit AI-crawler group (same Allow, same private disallows — see AI_SEARCH_BOT_USER_AGENTS). */
export function buildRobots(input: {
  policy: IndexingPolicy;
  baseUrl: string;
}): MetadataRoute.Robots {
  if (input.policy.robotsTxt === "disallow-all") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...SEO_PRIVATE_ROBOTS_DISALLOW],
      },
      {
        userAgent: [...AI_SEARCH_BOT_USER_AGENTS],
        allow: "/",
        disallow: [...SEO_PRIVATE_ROBOTS_DISALLOW],
      },
    ],
    sitemap: canonicalUrl(input.baseUrl, "/sitemap.xml"),
  };
}

// ---------------------------------------------------------------------------
// Shared page metadata (SEO-5/9/10) — canonicals, OG, Twitter per page
// ---------------------------------------------------------------------------

/** og:locale matches the existing <html lang="en">. */
export const SEO_OG_LOCALE = "en_US";

/**
 * Measured dimensions of the default OG image `/brand/logo-badge.jpg`
 * (540×540 JPEG, probed 2026-11-17). Only the default badge carries
 * dimensions — product/category image dimensions are unknown and must
 * never be guessed.
 */
export const DEFAULT_OG_IMAGE_SIZE = { width: 540, height: 540 } as const;

/**
 * Measured dimensions of the homepage share image `/brand/og-home.jpg`
 * (1200×630 JPEG, center-cropped 2026-11-24 from the check-shirts
 * category photo Fahim chose on 2026-11-19 — white check + maroon check
 * folded shirts). Only the homepage uses it: Google picked the Belt
 * category tile as the search-result thumbnail because the global
 * default is the small logo badge, so the homepage carries a real shirt
 * photo as its share image instead. A stored `seo_og_image_url` still
 * wins over it (see `resolveHomeOgImage`).
 */
export const HOME_OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** Homepage-only share image (see above). The alt describes the photo, nothing invented. */
export const HOME_OG_IMAGE = {
  url: "/brand/og-home.jpg",
  width: HOME_OG_IMAGE_SIZE.width,
  height: HOME_OG_IMAGE_SIZE.height,
  alt: "Two folded check thrift shirts — white check and maroon check",
} as const;

export interface PageMetadataInput {
  siteName: string;
  /** Clean path, no query string (e.g. "/shop"). Canonical + OG url resolve against metadataBase, so the apex base always wins. */
  path: string;
  /** Plain string goes through the `%s | Site` title template; `{ absolute }` replaces the whole title (home overrides only). */
  title: string | { absolute: string };
  description?: string;
  /** Page-specific OG/Twitter image. Omit to use `defaultImage`. Width/height are emitted when known (homepage photo only) — never guessed for product/category images. */
  image?: { url: string; width?: number; height?: number; alt?: string } | null;
  /**
   * Resolved global default image (stored `seo_og_image_url` or the logo
   * badge — see `resolveDefaultOgImage`). REQUIRED: Next.js REPLACES the
   * layout's openGraph object when a page defines its own, so a page that
   * omits images would silently drop the default share image everywhere.
   * Every page must emit a complete OG set.
   */
  defaultImage: { url: string; width?: number; height?: number; alt?: string };
  /** OG/Twitter title override (home only: the stored `seo_og_title` wins over the page title for sharing). */
  ogTitle?: string;
  /** OG/Twitter description override (home only: the stored `seo_og_description`). */
  ogDescription?: string;
  twitterCard?: "summary" | "summary_large_image";
  /** Explicit robots only (param variants, demo brands). Omit to inherit the layout policy. */
  robots?: SeoRobotsInput;
  keywords?: string[];
}

/**
 * Full per-page metadata: title, description, canonical, OG (siteName,
 * title, description, url, locale, type, image), Twitter card. OG/Twitter
 * titles use the FULL rendered title (template applied), matching what
 * the tab shows. The image is ALWAYS emitted (page image or the resolved
 * default) because a page-level openGraph replaces the layout's.
 */
export function buildPageMetadata(input: PageMetadataInput): Metadata {
  const fullTitle =
    typeof input.title === "string"
      ? `${input.title} | ${input.siteName}`
      : input.title.absolute;
  const shareTitle = input.ogTitle ?? fullTitle;
  const shareDescription = input.ogDescription ?? input.description;
  const image = input.image ?? null;
  const ogImages = image
    ? [
        {
          url: image.url,
          ...(image.width ? { width: image.width } : {}),
          ...(image.height ? { height: image.height } : {}),
          ...(image.alt ? { alt: image.alt } : {}),
        },
      ]
    : [input.defaultImage];
  const shareImageUrl = image ? image.url : input.defaultImage.url;
  return {
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.keywords && input.keywords.length > 0
      ? { keywords: input.keywords }
      : {}),
    ...(input.robots ? { robots: input.robots } : {}),
    alternates: { canonical: input.path },
    openGraph: {
      siteName: input.siteName,
      title: shareTitle,
      ...(shareDescription ? { description: shareDescription } : {}),
      url: input.path,
      locale: SEO_OG_LOCALE,
      type: "website",
      images: ogImages,
    },
    twitter: {
      card: input.twitterCard ?? "summary_large_image",
      title: shareTitle,
      ...(shareDescription ? { description: shareDescription } : {}),
      images: [shareImageUrl],
    },
  };
}

/**
 * Resolve the global default share image from stored settings: a valid
 * absolute `seo_og_image_url` wins (unknown dimensions — never guessed,
 * no alt claimed); otherwise the logo badge with its measured dimensions
 * and the site name as alt. Shared by the layout and every page so the
 * default is identical everywhere.
 */
export function resolveDefaultOgImage(
  settings: Record<string, unknown> | null | undefined,
  logoBadge: string,
  siteName: string,
): { url: string; width?: number; height?: number; alt?: string } {
  const stored = settings?.["seo_og_image_url"];
  const text =
    typeof stored === "string" && stored.trim() ? stored.trim() : null;
  const parsed = parseAbsoluteHttpUrl(text);
  if (parsed) return { url: parsed };
  return {
    url: logoBadge,
    width: DEFAULT_OG_IMAGE_SIZE.width,
    height: DEFAULT_OG_IMAGE_SIZE.height,
    alt: siteName,
  };
}

/**
 * Resolve the homepage share image: the check-shirts photo
 * (`HOME_OG_IMAGE`), unless a stored absolute `seo_og_image_url` is set
 * — the stored URL still wins (existing behaviour) and the caller then
 * falls back to the resolved default by passing no page image (null).
 * Relative/invalid stored values are ignored by `resolveDefaultOgImage`,
 * so the shirt photo still applies for them.
 */
export function resolveHomeOgImage(
  settings: Record<string, unknown> | null | undefined,
): typeof HOME_OG_IMAGE | null {
  const stored = settings?.["seo_og_image_url"];
  const text =
    typeof stored === "string" && stored.trim() ? stored.trim() : null;
  return parseAbsoluteHttpUrl(text) ? null : HOME_OG_IMAGE;
}

/** Parse the stored global `seo_keywords` (comma-split, trimmed, capped at 20); empty when unset. */
export function resolveGlobalKeywords(
  settings: Record<string, unknown> | null | undefined,
): string[] {
  const value = settings?.["seo_keywords"];
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Merge global + page-specific keywords, deduplicated, capped at 20.
 * Pages that define `keywords` replace the layout's, so page-specific
 * keywords must carry the globals along or the globals silently vanish.
 */
export function mergeSeoKeywords(
  globalKeywords: string[],
  pageKeywords: string[] | undefined,
): string[] {
  return [...new Set([...globalKeywords, ...(pageKeywords ?? [])])].slice(0, 20);
}

// ---------------------------------------------------------------------------
// JSON-LD builders (SEO-4) — plain data; the JsonLd component stringifies
// ---------------------------------------------------------------------------

/** Organization (+sameAs from stored social links only — never invented handles). `description` is the stored `seo_default_description` when set, else the owner-approved site description (brand.ts, Fahim's target phrases, 2026-11-19). */
export function organizationJsonLd(input: {
  name: string;
  url: string;
  logoUrl: string;
  sameAs: string[];
  description?: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    url: input.url,
    logo: input.logoUrl,
    ...(input.description ? { description: input.description } : {}),
    ...(input.sameAs.length > 0 ? { sameAs: input.sameAs } : {}),
  };
}

/**
 * Product (+offers, +aggregateRating ONLY when real approved reviews
 * exist). Price is whole BDT (Money); availability comes from real
 * variant stock. No SKU is ever emitted. VideoObject is deliberately
 * NOT built: only a video ID exists, no honest title/description/date.
 */
export function productJsonLd(input: {
  name: string;
  description: string;
  imageUrls: string[];
  url: string;
  price: number;
  inStock: boolean;
  brandName?: string | null;
  reviews: Array<{ rating: number }>;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrls.length > 0 ? { image: input.imageUrls } : {}),
    ...(input.brandName
      ? { brand: { "@type": "Brand", name: input.brandName } }
      : {}),
    offers: {
      "@type": "Offer",
      price: input.price,
      priceCurrency: "BDT",
      availability: input.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: input.url,
    },
  };
  if (input.reviews.length > 0) {
    const average =
      input.reviews.reduce((sum, review) => sum + review.rating, 0) /
      input.reviews.length;
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Math.round(average * 10) / 10,
      reviewCount: input.reviews.length,
    };
  }
  return data;
}

/** BreadcrumbList from fully-resolved absolute items (name + url). */
export function breadcrumbJsonLd(
  items: Array<{ name: string; url: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** FAQPage from the static FAQ content (same source the page renders). */
export function faqJsonLd(
  groups: Array<{ items: Array<{ q: string; a: string }> }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: groups.flatMap((group) =>
      group.items.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    ),
  };
}
