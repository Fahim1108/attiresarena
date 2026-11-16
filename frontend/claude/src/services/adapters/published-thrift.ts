import "server-only";
import { publicSupabaseConfiguration } from "@/lib/supabase-public";
import { isProductionStorefront } from "@/lib/storefront-policy";
import projects from "@/config/supabase-projects.json";
import intake from "@/data/inventory/thrift-shirts.json";
import {
  FEED_DIAGNOSTIC_PREFIX,
  MAX_PUBLISHED_FEED_ROWS,
  deriveFeedUnavailable,
  mergeStorefrontFeed,
  projectPublishedAdminProduct,
  supabaseRefFromUrl,
  type StorefrontFeedHealth,
} from "@/lib/catalog-publication";
import type { Product, Review } from "@/types";

type PublicConfig = NonNullable<
  ReturnType<typeof publicSupabaseConfiguration>
>;

/**
 * Storefront feed reads (Admin Panel v2, owner item 4).
 *
 * Two sources, fetched in parallel by readPublishedFeed:
 *   1. published_thrift_catalogue — the strict allowlist feed. Its
 *      per-row validation below is UNCHANGED: one bad row is skipped,
 *      the rest still render. One deleted product removes at most one
 *      product. Do not restructure this filtering.
 *   2. published_admin_catalogue — admin-published products (migration
 *      20261115000800). Rows are projected per-row by
 *      projectPublishedAdminProduct; one bad row is skipped, the rest
 *      still render.
 *
 * FAILURE SIGNAL: the old read() collapsed every data-call failure
 * into a silent []. These readers return { products, ok } instead, log
 * every failure server-side with FEED_DIAGNOSTIC_PREFIX (path + reason
 * only — never secrets, PII, response bodies, or row contents), and
 * let the catalogue adapter propagate `catalogueUnavailable` so
 * listing pages can render "catalogue unavailable" instead of
 * "0 products". A successful call that returns zero rows is NOT a
 * failure: it is a genuinely empty catalogue.
 */

const THRIFT_CATALOGUE_PATH = "/rest/v1/rpc/published_thrift_catalogue";
const PUBLISHED_ADMIN_PATH = "/rest/v1/rpc/published_admin_catalogue";
const REVIEWS_PATH = "/rest/v1/product_reviews";

type FeedReadResult =
  | { ok: true; rows: unknown[] }
  | { ok: false; reason: string };

function logFeedFailure(label: string, reason: string): void {
  console.error(`${FEED_DIAGNOSTIC_PREFIX} ${label} failed: ${reason}`);
}

/**
 * Which data source this deployment reads. The ref/hostname is not a
 * secret; the key is never touched here. `envProjectRef` is parsed
 * from the raw environment URL (whatever it points at), while
 * `expectedProjectRef` is what this deployment type should read — a
 * mismatch between them is diagnosable on the admin products page.
 */
function dataSourceRefs(configuration: PublicConfig | null): {
  projectRef: string | null;
  envProjectRef: string | null;
  expectedProjectRef: string | null;
} {
  return {
    projectRef: configuration ? supabaseRefFromUrl(configuration.url) : null,
    envProjectRef: supabaseRefFromUrl(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    expectedProjectRef: isProductionStorefront()
      ? projects.production
      : projects.staging,
  };
}

async function readRows(
  configuration: PublicConfig | null,
  path: string,
  method: "GET" | "POST",
  body?: string,
  logLabel: string = path,
): Promise<FeedReadResult> {
  if (!configuration) {
    logFeedFailure(logLabel, "not-configured");
    return { ok: false, reason: "not-configured" };
  }
  try {
    const response = await fetch(configuration.url + path, {
      method,
      ...(body === undefined ? {} : { body }),
      headers: {
        apikey: configuration.key,
        ...(configuration.key.startsWith("eyJ")
          ? { Authorization: `Bearer ${configuration.key}` }
          : {}),
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const reason = `http-${response.status}`;
      logFeedFailure(logLabel, reason);
      return { ok: false, reason };
    }
    const result: unknown = await response.json();
    // A literal null is a successful empty aggregate: PostgREST scalar
    // functions return null when the aggregate has no rows. Both feed
    // RPCs COALESCE to [], so this is defensive only — never a failure.
    if (result === null) return { ok: true, rows: [] };
    if (!Array.isArray(result)) {
      logFeedFailure(logLabel, "invalid-response");
      return { ok: false, reason: "invalid-response" };
    }
    return { ok: true, rows: result };
  } catch {
    logFeedFailure(logLabel, "request-failed");
    return { ok: false, reason: "request-failed" };
  }
}

function projectThriftRow(row: unknown): Product | null {
  if (!row || typeof row !== "object") return null;
  // Every field access below is typeof-guarded; the cast only recovers
  // the index signature (the legacy code relied on `any[]` rows).
  const r = row as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.variant_id !== "string" ||
    typeof r.slug !== "string" ||
    typeof r.name !== "string" ||
    typeof r.size !== "string" ||
    !r.size.trim() ||
    r.size.toUpperCase() === "N/A" ||
    typeof r.color !== "string" ||
    typeof r.image_path !== "string" ||
    !/^\/inventory\/thrift-shirts\/AA-SHIRT-\d{3}-front\.jpg$/.test(r.image_path) ||
    typeof r.price_minor !== "number" ||
    !Number.isSafeInteger(r.price_minor) ||
    r.price_minor < 0 ||
    typeof r.in_stock !== "boolean" ||
    typeof r.created_at !== "string"
  )
    return null;
  // Until generic media/publication management is verified, only the supplied
  // physical intake identities may be sold. QA/new arbitrary records fail closed.
  const source = intake.find((item) => item.source_id.toLowerCase() === r.slug);
  if (
    !source ||
    source.image_path !== r.image_path ||
    r.reviewOnly === true ||
    r.is_test === true ||
    (r.status !== undefined && r.status !== "published") ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.variant_id) ||
    !Number.isFinite(Date.parse(r.created_at)) ||
    ["NA", "UNKNOWN"].includes(r.size.trim().toUpperCase()) ||
    !r.color.trim()
  )
    return null;
  const image = { src: r.image_path, alt: r.name };
  const variant = {
    id: r.variant_id,
    sku: typeof r.sku === "string" ? r.sku : r.variant_id,
    size: r.size,
    colorId: "fixed",
    stock: r.in_stock ? 1 : 0,
  };
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: "published",
    apparelSizing: true,
    fixedVariantId: r.variant_id,
    categoryId: "cat-shirts",
    brandId: "",
    price: r.price_minor / 100,
    colors: [{ id: "fixed", name: r.color, hex: "#6B0202" }],
    sizes: [r.size],
    variants: [variant],
    imagesByColor: { fixed: [image] },
    defaultImages: [image],
    description: typeof r.description === "string" ? r.description : "",
    shortDescription: "",
    details: [],
    badges: [],
    isNewArrival: false,
    isFeatured: false,
    isBestSeller: false,
    rating: { average: 0, count: 0 },
    createdAt: r.created_at,
    tags: [],
    sizeGuideId: "tops",
  };
}

/** Allowlist feed with its success signal. Products are identical to the legacy publishedShirts() output. */
export async function readThriftFeed(
  configuration: PublicConfig | null = publicSupabaseConfiguration(),
): Promise<{ products: Product[]; ok: boolean; error: string | null }> {
  const read = await readRows(configuration, THRIFT_CATALOGUE_PATH, "POST");
  if (!read.ok) return { products: [], ok: false, error: read.reason };
  const products: Product[] = [];
  let skipped = 0;
  for (const row of read.rows) {
    const product = projectThriftRow(row);
    if (!product) {
      skipped += 1;
      continue;
    }
    products.push(product);
  }
  if (skipped > 0) {
    // Counts only: never row contents.
    console.error(
      `${FEED_DIAGNOSTIC_PREFIX} ${THRIFT_CATALOGUE_PATH}: kept ${products.length}, skipped ${skipped} invalid rows`,
    );
  }
  return { products, ok: true, error: null };
}

/** Legacy entry point: same products as before, failures now logged by readThriftFeed. */
export async function publishedShirts(): Promise<Product[]> {
  return (await readThriftFeed()).products;
}

/** Published admin products with their success signal. Unapplied migration 008 surfaces as ok:false (HTTP 404), never as a crash. */
export async function readAdminFeed(
  configuration: PublicConfig | null = publicSupabaseConfiguration(),
): Promise<{ products: Product[]; ok: boolean; error: string | null }> {
  const read = await readRows(
    configuration,
    PUBLISHED_ADMIN_PATH,
    "POST",
    JSON.stringify({ page_offset: 0, page_limit: MAX_PUBLISHED_FEED_ROWS }),
  );
  // read.ok is false whenever configuration is null; the second check
  // keeps the not-configured reason explicit for the health signal.
  // The config is still needed for the RPC fetch itself — only URL
  // building no longer takes it (the projector emits same-origin
  // delivery URLs now).
  if (!read.ok || !configuration) return { products: [], ok: false, error: read.ok ? "not-configured" : read.reason };
  const products: Product[] = [];
  let skipped = 0;
  for (const row of read.rows.slice(0, MAX_PUBLISHED_FEED_ROWS)) {
    const product = projectPublishedAdminProduct(row);
    if (!product) {
      skipped += 1;
      continue;
    }
    products.push(product);
  }
  if (skipped > 0) {
    console.error(
      `${FEED_DIAGNOSTIC_PREFIX} ${PUBLISHED_ADMIN_PATH}: kept ${products.length}, skipped ${skipped} invalid rows`,
    );
  }
  return { products, ok: true, error: null };
}

export interface PublishedFeedRead extends StorefrontFeedHealth {
  allowlist: Product[];
  published: Product[];
  feedUnavailable: boolean;
}

/** Both feed sources in parallel, with per-source health and the merged visible count. Never throws. */
export async function readPublishedFeed(): Promise<PublishedFeedRead> {
  const configuration = publicSupabaseConfiguration();
  const [allowlist, published] = await Promise.all([
    readThriftFeed(configuration),
    readAdminFeed(configuration),
  ]);
  const health: StorefrontFeedHealth = {
    configured: configuration !== null,
    allowlistOk: allowlist.ok,
    publishedOk: published.ok,
    allowlistCount: allowlist.products.length,
    publishedCount: published.products.length,
    visibleCount: mergeStorefrontFeed(allowlist.products, published.products).length,
    ...dataSourceRefs(configuration),
    allowlistError: allowlist.error,
    publishedError: published.error,
  };
  return {
    ...health,
    allowlist: allowlist.products,
    published: published.products,
    feedUnavailable: deriveFeedUnavailable(health),
  };
}

export async function approvedReviews(productId: string): Promise<Review[]> {
  const read = await readRows(
    publicSupabaseConfiguration(),
    REVIEWS_PATH +
      "?select=id,rating,title,body,author_display_name,created_at&status=eq.approved&product_id=eq." +
      encodeURIComponent(productId),
    "GET",
    undefined,
    REVIEWS_PATH,
  );
  if (!read.ok) return [];
  return read.rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    // Every field access below is typeof-guarded; see projectThriftRow.
    const r = row as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.rating !== "number" ||
      r.rating < 1 ||
      r.rating > 5 ||
      typeof r.body !== "string" ||
      typeof r.author_display_name !== "string" ||
      typeof r.created_at !== "string"
    )
      return [];
    return [
      {
        id: r.id,
        productId,
        author: r.author_display_name,
        rating: r.rating,
        title: typeof r.title === "string" ? r.title : "",
        body: r.body,
        createdAt: r.created_at,
        verifiedPurchase: false,
      },
    ];
  });
}
