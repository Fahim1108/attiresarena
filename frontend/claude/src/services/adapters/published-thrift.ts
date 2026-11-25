import "server-only";
import { cache } from "react";
import { publicSupabaseConfiguration } from "@/lib/supabase-public";
import {
  projectReviewPhotoRow,
  reviewPhotoUrl,
} from "@/lib/customer/review-photos";
import { extractRowSeoFields } from "@/lib/seo";
import { isProductionStorefront } from "@/lib/storefront-policy";
import projects from "@/config/supabase-projects.json";
import intake from "@/data/inventory/thrift-shirts.json";
import {
  FEED_DIAGNOSTIC_PREFIX,
  MAX_PUBLISHED_FEED_ROWS,
  deriveFeedUnavailable,
  mergeStorefrontFeed,
  parsePublishedCategoryRow,
  projectPublishedAdminProduct,
  supabaseRefFromUrl,
  type PublishedCategoryRow,
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
const PUBLISHED_CATEGORIES_PATH = "/rest/v1/rpc/published_categories";
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

/** Pure thrift-row projector, exported for tests (the feed reader wraps it with logging). */
export function projectThriftRow(row: unknown): Product | null {
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
  // SEO passthrough: lenient, never a reason to drop a row. Thrift rows
  // carry no keywords column, so keywords are never extracted here. The
  // fields are absent entirely until the follow-up RPC extension returns
  // them; until then every thrift product falls back to name/description.
  const seo = extractRowSeoFields(r, { keywords: false });
  // updated_at is lenient like the SEO fields: a parsable date survives,
  // anything else degrades to absent. The key is missing entirely until
  // migration 20261119001100 is applied.
  const updatedAt =
    typeof r.updated_at === "string" &&
    Number.isFinite(Date.parse(r.updated_at))
      ? r.updated_at
      : undefined;
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
    ...(seo.seoTitle ? { seoTitle: seo.seoTitle } : {}),
    ...(seo.seoDescription ? { seoDescription: seo.seoDescription } : {}),
    description: typeof r.description === "string" ? r.description : "",
    shortDescription: "",
    details: [],
    badges: [],
    isNewArrival: false,
    isFeatured: false,
    isBestSeller: false,
    rating: { average: 0, count: 0 },
    createdAt: r.created_at,
    ...(updatedAt ? { updatedAt } : {}),
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

/** Legacy entry point: same products as before, failures now logged by readThriftFeed.
 * Per-request memo (see readPublishedFeed below): getStorefrontSettings
 * calls this on top of every feed read, so without it the allowlist RPC
 * runs once more per page load for no new data. */
const readThriftFeedCached = cache(async () => readThriftFeed());
export async function publishedShirts(): Promise<Product[]> {
  return (await readThriftFeedCached()).products;
}

/**
 * Published categories with their SEO fields (migration 20261119001100).
 * Any failure — including the pre-migration 404, when the RPC does not
 * exist yet — returns no rows instead of throwing, so the storefront
 * keeps rendering the static category config byte-identically. One bad
 * row is skipped, the rest still merge.
 */
export async function readPublishedCategories(
  configuration: PublicConfig | null = publicSupabaseConfiguration(),
): Promise<{ rows: PublishedCategoryRow[]; ok: boolean; error: string | null }> {
  const read = await readRows(
    configuration,
    PUBLISHED_CATEGORIES_PATH,
    "POST",
  );
  if (!read.ok) return { rows: [], ok: false, error: read.reason };
  const rows: PublishedCategoryRow[] = [];
  for (const row of read.rows) {
    const parsed = parsePublishedCategoryRow(row);
    if (parsed) rows.push(parsed);
  }
  return { rows, ok: true, error: null };
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
const readPublishedFeedUncached = async (): Promise<PublishedFeedRead> => {
  const configuration = publicSupabaseConfiguration();
  // SPEED (round 2): the allowlist RPC ran TWICE per request — once
  // here and once via publishedShirts() (getStorefrontSettings), which
  // uses its own readThriftFeedCached. Both now share that one cached
  // read, so the homepage pays for one allowlist RPC, not two.
  const [allowlist, published] = await Promise.all([
    readThriftFeedCached(),
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
};

/**
 * SPEED: per-request memo of the published feed. The homepage alone
 * reads the feed 5+ times per load (root layout + page + two
 * collections + categories + settings), each read being two Supabase
 * RPC round-trips. React cache() dedupes within ONE request only —
 * the next request re-fetches — so publish/unpublish still shows
 * immediately, and no cross-request stale data is possible. The feed
 * is anonymous public data (no cookies/user input), so sharing it
 * inside one request is safe.
 */
const readPublishedFeedCached = cache(readPublishedFeedUncached);
export async function readPublishedFeed(): Promise<PublishedFeedRead> {
  return readPublishedFeedCached();
}

/**
 * Approved reviews for one product. Two-layer filtering stays: the
 * PostgREST query restricts to status=approved AND the
 * approved_reviews RLS policy (approved + product published) applies
 * on top. Never simplify to one layer.
 *
 * FALLBACK READ (Q8): the first select includes verified_purchase
 * (migration 20261117000100). Before that migration is applied the
 * column does not exist and the select errors — the read then retries
 * once with the pre-migration columns and the badge defaults to
 * false, instead of failing the whole list to []. One deploy works
 * before and after the gated apply; the retry is a single extra
 * request only while the column is missing.
 */
const REVIEWS_SELECT =
  "id,rating,title,body,author_display_name,created_at";
const REVIEWS_SELECT_WITH_VERIFIED = `${REVIEWS_SELECT},verified_purchase`;

function projectApprovedReview(
  row: unknown,
  productId: string,
): Review | null {
  if (!row || typeof row !== "object") return null;
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
    return null;
  return {
    id: r.id,
    productId,
    author: r.author_display_name,
    rating: r.rating,
    title: typeof r.title === "string" ? r.title : "",
    body: r.body,
    createdAt: r.created_at,
    // Absent (pre-migration) means unproven, never inferred.
    verifiedPurchase: r.verified_purchase === true,
  };
}

export async function approvedReviews(productId: string): Promise<Review[]> {
  const configuration = publicSupabaseConfiguration();
  const selects = [REVIEWS_SELECT_WITH_VERIFIED, REVIEWS_SELECT];
  for (const select of selects) {
    const read = await readRows(
      configuration,
      REVIEWS_PATH +
        `?select=${select}&status=eq.approved&product_id=eq.` +
        encodeURIComponent(productId),
      "GET",
      undefined,
      REVIEWS_PATH,
    );
    if (!read.ok) continue;
    const reviews = read.rows.flatMap((row) => {
      const projected = projectApprovedReview(row, productId);
      return projected ? [projected] : [];
    });
    return await withReviewPhotos(configuration, reviews);
  }
  return [];
}

/**
 * Client feedback item 19: attach approved-review photos to the
 * projected reviews. Photos come from product_review_photos
 * (migration 20261124000300); the table's approved-only SELECT
 * policy means the anon read returns photos of approved reviews on
 * published products and nothing else. A failed photo read (including
 * the pre-migration missing table) leaves the reviews photo-less —
 * the list still renders, exactly as before.
 */
const REVIEW_PHOTOS_PATH = "/rest/v1/product_review_photos";

async function withReviewPhotos(
  configuration: PublicConfig | null,
  reviews: Review[],
): Promise<Review[]> {
  if (reviews.length === 0) return reviews;
  const ids = reviews.map((r) => r.id).join(",");
  const read = await readRows(
    configuration,
    REVIEW_PHOTOS_PATH +
      `?select=id,review_id,storage_path,position&review_id=in.(${ids})&order=position.asc`,
    "GET",
    undefined,
    REVIEW_PHOTOS_PATH,
  );
  if (!read.ok) return reviews;
  const byReview = new Map<string, { src: string; alt: string }[]>();
  for (const row of read.rows) {
    const projected = projectReviewPhotoRow(row);
    if (!projected) continue;
    const src = reviewPhotoUrl(projected.storagePath);
    if (!src) continue;
    const list = byReview.get(projected.reviewId) ?? [];
    list.push({ src, alt: "Customer review photo" });
    byReview.set(projected.reviewId, list);
  }
  if (byReview.size === 0) return reviews;
  return reviews.map((review) => {
    const photos = byReview.get(review.id);
    return photos ? { ...review, photos } : review;
  });
}
