/**
 * Storefront publication: pure projection + merge rules for admin-published
 * products (Admin Panel v2, owner item 4).
 *
 * This module is PURE (no server-only imports, no fetch, no Supabase): the
 * feed adapter (services/adapters/published-thrift.ts) fetches rows and the
 * tests exercise every rule here. Keep it that way.
 *
 * QUALIFICATION RULE (enforced twice: by the database RPC
 * published_admin_catalogue AND by the projector below — either layer
 * alone is enough to keep an unqualified row off the storefront):
 *   1. products.is_published is true AND products.status is 'published'.
 *      Merely setting a product Active in the admin panel (status only)
 *      does NOT publish it; publication is an explicit, audited action.
 *   2. The product has a category, and that category is visible
 *      (categories.published is true).
 *   3. The product has at least one product_media row.
 *   4. The product has at least one ACTIVE variant with a price above ৳0,
 *      and total available stock across active variants is above 0 at
 *      publish time. (The feed still lists a published product whose
 *      stock later reaches 0 — as Sold Out — exactly like the thrift feed.)
 *   5. Thrift-intake products are EXCLUDED: they publish through garment
 *      verification and the existing allowlist feed, never through here.
 *
 * MERGE RULE (see mergeStorefrontFeed): the strict allowlist feed wins.
 * Allowlist rows come first, in their existing order; published admin
 * products follow, skipping any row whose id OR slug collides with an
 * allowlist row (or with an earlier admin row). Nothing is ever removed
 * from the allowlist feed by this module.
 *
 * IMAGE STRATEGY (see migration 20261115000800): NO signed URLs on the
 * public feed and NO byte copies. The bucket stays private; an ADDITIVE
 * Storage SELECT policy lets anyone read an object ONLY while it is
 * linked to a product that is currently published (checked per request
 * by the definer function is_published_admin_product_media).
 * Unpublishing revokes image access, with no stale copies to clean up.
 * The projector builds same-origin delivery URLs
 * (/api/product-media/<owner>/<file>); the route handler behind them
 * streams bytes through the Storage endpoint that evaluates access
 * policies, using the public anon configuration — the bucket's public
 * URL endpoint never evaluates policies and cannot serve a private
 * bucket, so it must never be used here. The policy — not URL
 * obscurity — is the enforcement, and the delivery route re-checks
 * publication on every cache miss (successes cache for 60 seconds).
 * Paths are UUID-based, and a path that does not match the bucket's
 * `<uuid>/<uuid>.<ext>` shape is dropped.
 *
 * COST SAFETY: the RPC never returns cost fields, the projector never
 * reads them, and variant SKUs are never projected (the storefront
 * variant `sku` field carries the variant id, which the cart already
 * uses as the line identity). Cost prices cannot leak through the feed.
 *
 * DIAGNOSABILITY: the adapter logs feed failures server-side with
 * FEED_DIAGNOSTIC_PREFIX, and the failure signal propagates: the feed
 * adapter reports per-source success, the catalogue adapter exposes
 * `catalogueUnavailable` on listing results, and listing pages render an
 * honest "catalogue unavailable" state instead of "0 products" when the
 * data call itself fails. A genuinely empty catalogue (both data calls
 * succeed, zero rows) still renders the normal empty states. No
 * internals ever leak to the public storefront — the pages see one
 * boolean, the logs carry path + reason only (no secrets, no PII, no
 * response bodies, no row contents).
 *
 * FAILURE MODEL (verified in code; the per-row filtering was already
 * correct and is NOT restructured): each RPC row is validated and
 * projected independently, so one bad row — or one deleted product —
 * removes at most that one product. Whole-feed emptiness happens ONLY
 * when a data call itself fails (unconfigured project-ref check, HTTP
 * error, invalid response, network/timeout). That collapse used to be
 * silent (the adapter returned []); it is now logged and signalled.
 * The feed is UNAVAILABLE only when BOTH sources fail (or the config
 * check fails); one working source still renders its products.
 *
 * RPC MECHANICS (parent-verified from migration 20261026000100):
 * published_thrift_catalogue is a plain SQL aggregate that COALESCEs
 * to '[]' — it CANNOT error on empty data, it returns '[]' when
 * nothing matches. So "0 products" with a successful data call means
 * no rows matched in the database that deployment reads (genuine
 * empty), while "catalogue unavailable" means the call failed at the
 * transport/RPC-existence level (function/table missing, wrong
 * project, network). The adapter distinguishes exactly these two
 * cases: HTTP 200 + array (possibly empty) is success; anything else
 * is a diagnosable failure with a reason (http-<status>,
 * invalid-response, request-failed, not-configured).
 *
 * DATA-SOURCE SURFACING: StorefrontFeedHealth carries the effective
 * project ref, the environment's project ref, and the expected ref,
 * plus the last error kind per source. The admin products page shows
 * them (staff-only; refs/hostnames are not secrets, keys are never
 * included) so an operator can see WHICH database a deployment is
 * actually reading and whether it matches the expected project.
 * The server feed path was proven byte-identical between a working
 * and a 0-product deployment, which is why this surfacing — not
 * another feed rewrite — is the diagnostic that matters.
 *
 * COLLAPSE POINTS THAT REMAIN (documented, not fixed here): product
 * detail pages still 404 when the feed fails (getProductBySlug has no
 * failure channel); the /categories index still shows "coming soon"
 * for shirts on feed failure; header navigation classifications
 * (getStorefrontSettings) silently empty. Each needs the same
 * optional-flag pattern applied to its own return type — a follow-up,
 * deliberately not bundled into this change.
 *
 * SHIRTS-ONLY DESIGN INTENT (owner-confirmed): ONLY the Shirts
 * category lists products; Pants, Sneakers, Belt, Wallet and Watches
 * show "coming soon" BY DESIGN, and homepage coming-soon states for
 * non-shirt sections are correct, not defects. This module preserves
 * that intent: published admin products join the general catalogue
 * surfaces (/shop, homepage listings, search, product pages — the
 * Shirts display behavior) and NEVER make a non-shirt category page
 * list products. Admin products keep their database category UUID as
 * categoryId, which matches no static storefront category; the
 * listing filter (catalog-query.ts) and the category availability
 * check (owner-catalogue.ts getCategories) treat such a product as a
 * shirt, so /category/shirts lists the merged browsable catalogue
 * (allowlist UNION admin-published) — the owner decision of
 * 2026-11-19, after /category/shirts showed "Coming Soon" while
 * /shop listed 22 admin-published shirts.
 */

import { isCatalogStoragePath } from "@/lib/admin/catalog-variants";
import { canonicalSize } from "@/lib/catalogue-dimensions";
import { extractRowSeoFields } from "@/lib/seo";
import { isYoutubeVideoId } from "@/lib/youtube-video";
import type {
  ColorOption,
  Product,
  ProductBadge,
  ProductImage,
  ProductVariant,
} from "@/types";

/** Stable server-log prefix for storefront-feed failures (no secrets/PII). */
export const FEED_DIAGNOSTIC_PREFIX = "[attiresarena:storefront-feed]";

/** Upper bound on published admin rows read for one feed render. */
export const MAX_PUBLISHED_FEED_ROWS = 100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SAFE_PRICE_MINOR = 9007199254740991;
const PLACEHOLDER_SIZES = new Set(["N/A", "NA", "UNKNOWN"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isSafePrice(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_SAFE_PRICE_MINOR
  );
}

function isParsableDate(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value))
  );
}

function isTextList(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every(
      (v) => typeof v === "string" && v.length > 0 && v.length <= maxLength,
    )
  );
}

/** Deterministic, URL-safe color key: "Navy Blue" -> "navy-blue". */
function colorIdFor(colorName: string, taken: ReadonlySet<string>): string {
  const base =
    colorName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "color";
  if (!taken.has(base)) return base;
  for (let n = 2; n <= 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${taken.size + 1}`;
}

export interface PublishedAdminVariantRow {
  id: string;
  size: string;
  color: string;
  price_minor: number;
  sale_price_minor: number | null;
  available: number;
}

export interface PublishedAdminMediaRow {
  path: string;
  alt: string;
}

export interface PublishedAdminRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category_id: string | null;
  highlights: string[];
  tags: string[];
  badges: string[];
  created_at: string;
  published_at: string | null;
  /** YouTube video ID from products.youtube_video_id (migration 014); null/absent when no video. */
  youtube_video_id: string | null;
  /**
   * Stored SEO fields from products.seo_title/seo_description/meta_keywords.
   * Null/absent until the follow-up RPC extension returns them; lenient
   * like the video ID — SEO is an enhancement, never a reason to drop a row.
   */
  seo_title: string | null;
  seo_description: string | null;
  meta_keywords: string | null;
  variants: PublishedAdminVariantRow[];
  media: PublishedAdminMediaRow[];
}

function parseVariantRow(value: unknown): PublishedAdminVariantRow | null {
  if (!isRecord(value)) return null;
  const size = typeof value.size === "string" ? value.size.trim() : "";
  const color = typeof value.color === "string" ? value.color.trim() : "";
  const sale = value.sale_price_minor ?? null;
  if (
    !isUuid(value.id) ||
    size.length < 1 ||
    size.length > 40 ||
    PLACEHOLDER_SIZES.has(size.toUpperCase()) ||
    color.length < 1 ||
    color.length > 80 ||
    !isSafePrice(value.price_minor) ||
    (sale !== null && !isSafePrice(sale)) ||
    (sale !== null &&
      typeof value.price_minor === "number" &&
      sale > value.price_minor) ||
    typeof value.available !== "number" ||
    !Number.isSafeInteger(value.available) ||
    value.available < 0
  ) {
    return null;
  }
  return {
    id: value.id,
    size,
    color,
    price_minor: value.price_minor,
    sale_price_minor: sale,
    available: value.available,
  };
}

function parseMediaRow(value: unknown): PublishedAdminMediaRow | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.path !== "string" ||
    !isCatalogStoragePath(value.path) ||
    typeof value.alt !== "string" ||
    value.alt.length > 300
  ) {
    return null;
  }
  return { path: value.path, alt: value.alt };
}

/**
 * Validate one RPC row strictly. Returns null for any violation: the row
 * is dropped from the feed (fail-closed) while other rows still project.
 */
export function parsePublishedAdminRow(value: unknown): PublishedAdminRow | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const categoryId = value.category_id ?? null;
  const publishedAt = value.published_at ?? null;
  // Video is an enhancement, never a reason to drop a product: only a
  // valid 11-character ID survives; anything else degrades to no video.
  // The field is absent entirely until migration 014 is applied.
  const youtubeVideoId = isYoutubeVideoId(value.youtube_video_id)
    ? value.youtube_video_id
    : null;
  // SEO fields are likewise lenient: absent/invalid degrades to nulls and
  // the product still projects. The fields are absent entirely until the
  // follow-up RPC extension returns them.
  const seo = extractRowSeoFields(value, { keywords: true });
  if (
    !isUuid(value.id) ||
    typeof value.slug !== "string" ||
    value.slug.length > 160 ||
    !SLUG_PATTERN.test(value.slug) ||
    name.length < 1 ||
    name.length > 200 ||
    typeof value.description !== "string" ||
    value.description.length > 20000 ||
    (categoryId !== null && !isUuid(categoryId)) ||
    !isTextList(value.highlights, 20, 200) ||
    !isTextList(value.tags, 20, 40) ||
    !isTextList(value.badges, 5, 40) ||
    !isParsableDate(value.created_at) ||
    (publishedAt !== null && !isParsableDate(publishedAt)) ||
    !Array.isArray(value.variants) ||
    value.variants.length < 1 ||
    value.variants.length > 100 ||
    !Array.isArray(value.media) ||
    value.media.length < 1 ||
    value.media.length > 20
  ) {
    return null;
  }
  const variants: PublishedAdminVariantRow[] = [];
  for (const raw of value.variants) {
    const parsed = parseVariantRow(raw);
    if (!parsed) return null;
    variants.push(parsed);
  }
  const media: PublishedAdminMediaRow[] = [];
  for (const raw of value.media) {
    const parsed = parseMediaRow(raw);
    if (parsed) media.push(parsed);
  }
  // Image requirement: at least one usable image must survive validation.
  if (media.length === 0) return null;
  return {
    id: value.id,
    slug: value.slug,
    name,
    description: value.description,
    category_id: categoryId,
    highlights: value.highlights,
    tags: value.tags,
    badges: value.badges,
    created_at: value.created_at,
    published_at: publishedAt,
    youtube_video_id: youtubeVideoId,
    seo_title: seo.seoTitle,
    seo_description: seo.seoDescription,
    meta_keywords: seo.metaKeywords,
    variants,
    media,
  };
}

/**
 * Build a same-origin delivery URL for a published product image.
 * Returns null for a malformed storage path. The delivery route
 * (app/api/product-media) streams the bytes through the Storage
 * endpoint that evaluates access policies: unpublished/unlinked
 * objects stay private, and the policy — not this URL shape —
 * decides whether the bytes are actually readable.
 */
export function publishedMediaUrl(storagePath: string): string | null {
  if (!isCatalogStoragePath(storagePath)) return null;
  const [owner, object] = storagePath.split("/");
  if (!owner || !object) return null;
  return `/api/product-media/${encodeURIComponent(owner)}/${encodeURIComponent(object)}`;
}

const ADMIN_BADGE_MAP: Record<string, ProductBadge | null> = {
  "New Arrival": "new",
  "Best Seller": "bestseller",
  "Featured Product": null,
  "Premium Collection": null,
  "Free Delivery": null,
};

/**
 * Project one validated RPC row to a storefront Product. Returns null
 * when the row fails validation or no image URL can be built.
 */
export function projectPublishedAdminProduct(row: unknown): Product | null {
  const parsed = parsePublishedAdminRow(row);
  if (!parsed) return null;
  const images: ProductImage[] = [];
  for (const medium of parsed.media) {
    const src = publishedMediaUrl(medium.path);
    if (src) images.push({ src, alt: medium.alt || parsed.name });
  }
  if (images.length === 0) return null;

  const colors: ColorOption[] = [];
  const colorIds = new Map<string, string>();
  const takenIds = new Set<string>();
  for (const variant of parsed.variants) {
    if (colorIds.has(variant.color)) continue;
    const id = colorIdFor(variant.color, takenIds);
    takenIds.add(id);
    colorIds.set(variant.color, id);
    // No per-color swatch data exists in the database; the feed uses the
    // brand primary for every swatch, exactly like the thrift projection.
    colors.push({ id, name: variant.color, hex: "#6B0202" });
  }
  const sizes: string[] = [];
  const seenSizes = new Set<string>();
  for (const variant of parsed.variants) {
    if (seenSizes.has(variant.size)) continue;
    seenSizes.add(variant.size);
    sizes.push(variant.size);
  }
  const variants: ProductVariant[] = parsed.variants.map((variant) => ({
    id: variant.id,
    // Never the database SKU: the variant id is the cart line identity.
    sku: variant.id,
    colorId: colorIds.get(variant.color) ?? "color",
    size: variant.size,
    price: (variant.sale_price_minor ?? variant.price_minor) / 100,
    stock: variant.available,
  }));
  const effectivePrices = parsed.variants.map(
    (v) => v.sale_price_minor ?? v.price_minor,
  );
  const regularPrices = parsed.variants.map((v) => v.price_minor);
  const price = Math.min(...effectivePrices) / 100;
  const minRegular = Math.min(...regularPrices) / 100;
  const compareAtPrice = minRegular > price ? minRegular : undefined;

  const badges: ProductBadge[] = [];
  for (const badge of parsed.badges) {
    const mapped = ADMIN_BADGE_MAP[badge];
    if (mapped && !badges.includes(mapped)) badges.push(mapped);
  }
  if (compareAtPrice !== undefined && !badges.includes("sale")) {
    badges.push("sale");
  }
  const imagesByColor: Record<string, ProductImage[]> = {};
  for (const color of colors) imagesByColor[color.id] = images;

  // Apparel sizing is true when ANY variant size is an apparel size:
  // the feed orders variants by (color, size), so the first size may be
  // "One Size" while later variants carry real apparel sizes. Deriving
  // this from the first size only hid such products from Shop-by-Size
  // and canonical size filtering. Main-level sizes are materialized as
  // ordinary variants (see catalog-variants.ts), so they flow through
  // this same derivation with no special case.
  const apparelSizing = sizes.some((s) => canonicalSize(s) !== undefined);

  return {
    id: parsed.id,
    slug: parsed.slug,
    name: parsed.name,
    status: "published",
    apparelSizing,
    categoryId: parsed.category_id ?? "",
    brandId: "",
    price,
    ...(compareAtPrice !== undefined ? { compareAtPrice } : {}),
    colors,
    sizes,
    variants,
    imagesByColor,
    defaultImages: images,
    ...(parsed.youtube_video_id
      ? { youtubeVideoId: parsed.youtube_video_id }
      : {}),
    // SEO passthrough: present only when the RPC returned the fields.
    ...(parsed.seo_title ? { seoTitle: parsed.seo_title } : {}),
    ...(parsed.seo_description
      ? { seoDescription: parsed.seo_description }
      : {}),
    ...(parsed.meta_keywords ? { metaKeywords: parsed.meta_keywords } : {}),
    description: parsed.description,
    shortDescription: parsed.description.slice(0, 160).trim(),
    details: [...parsed.highlights],
    badges,
    isNewArrival: parsed.badges.includes("New Arrival"),
    isFeatured: parsed.badges.includes("Featured Product"),
    isBestSeller: parsed.badges.includes("Best Seller"),
    rating: { average: 0, count: 0 },
    createdAt: parsed.published_at ?? parsed.created_at,
    tags: [...parsed.tags],
    ...(apparelSizing ? { sizeGuideId: "tops" } : {}),
  };
}

/**
 * Merge the two feed sources. Allowlist rows keep their order and always
 * win: an admin row whose id or slug collides with an allowlist row (or
 * with an earlier admin row) is dropped, never duplicated.
 */
export function mergeStorefrontFeed(
  allowlist: readonly Product[],
  adminPublished: readonly Product[],
): Product[] {
  const seenIds = new Set(allowlist.map((p) => p.id));
  const seenSlugs = new Set(allowlist.map((p) => p.slug));
  const merged: Product[] = [...allowlist];
  for (const product of adminPublished) {
    if (seenIds.has(product.id) || seenSlugs.has(product.slug)) continue;
    seenIds.add(product.id);
    seenSlugs.add(product.slug);
    merged.push(product);
  }
  return merged;
}

// ------------------------------------------------------------- feed health

/**
 * Extract the Supabase project ref (the hostname's first label) from a
 * Supabase URL. Returns null for anything that is not an
 * `https://<ref>.supabase.co` URL. The ref/hostname is NOT a secret —
 * it is safe for admin diagnostics and server logs — but keys and
 * credential-bearing URLs must never be derived from or shown with it.
 */
export function supabaseRefFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host.endsWith(".supabase.co")) return null;
    const ref = host.slice(0, -".supabase.co".length);
    return /^[a-z0-9]{20}$/.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

export interface StorefrontFeedHealth {
  /** False when the public Supabase configuration fails its checks. */
  configured: boolean;
  /** True when the allowlist RPC answered successfully. */
  allowlistOk: boolean;
  /** True when the published-admin RPC answered successfully. */
  publishedOk: boolean;
  allowlistCount: number;
  publishedCount: number;
  visibleCount: number;
  /** Project ref the feed actually read (from the resolved config URL). Null when unconfigured. Admin diagnostics only — never a key. */
  projectRef: string | null;
  /** Project ref the deployment environment points at, whether or not the config check passed. Null when no parseable Supabase URL is configured. */
  envProjectRef: string | null;
  /** Project ref this deployment is expected to read (per deployment type). A mismatch with envProjectRef means the deployment reads the wrong project. */
  expectedProjectRef: string | null;
  /** Last failure kind for the allowlist read (e.g. "http-404", "request-failed"), or null when it succeeded. Status/phase only — never bodies. */
  allowlistError: string | null;
  /** Last failure kind for the published-admin read, or null when it succeeded. */
  publishedError: string | null;
}

export type FeedHealthStatus = "ok" | "partial" | "unavailable";

/**
 * Staff-only extension of the feed health read: the whole-catalogue
 * product total, from a head-count read in readStorefrontFeedHealth
 * (catalog-products.ts). Null when the count read fails — the
 * published row still renders. Unpublished = catalogueTotal −
 * publishedCount, i.e. every product NOT in the published-feed
 * result set, so published + unpublished = the whole catalogue.
 */
export interface StorefrontFeedHealthWithCatalogueTotal
  extends StorefrontFeedHealth {
  catalogueTotal: number | null;
}

export function feedHealthStatus(health: StorefrontFeedHealth): FeedHealthStatus {
  if (!health.configured) return "unavailable";
  if (health.allowlistOk && health.publishedOk) return "ok";
  if (!health.allowlistOk && !health.publishedOk) return "unavailable";
  return "partial";
}

/**
 * The storefront failure signal: true ONLY when the catalogue data
 * cannot be read at all — the public config check fails, or BOTH feed
 * sources fail. One working source means the catalogue is available
 * (possibly partial), never "unavailable". Listing pages show the
 * "catalogue unavailable" state only when this is true AND the
 * rendered list is empty, so review/preview products still render
 * normally when present.
 */
export function deriveFeedUnavailable(
  health: Pick<StorefrontFeedHealth, "configured" | "allowlistOk" | "publishedOk">,
): boolean {
  return !health.configured || (!health.allowlistOk && !health.publishedOk);
}
