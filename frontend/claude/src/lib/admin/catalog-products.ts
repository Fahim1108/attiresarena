'use server';

/**
 * Catalogue products: server reads + Server Actions for /admin/catalog/products.
 *
 * Production-capable: every write goes through the new admin_create_product /
 * admin_update_product / admin_set_product_status / admin_duplicate_product /
 * admin_delete_product RPCs (migration 20261115000200), which enforce
 * require_admin('catalogue.manage') + MFA in the database. There are NO
 * staging checks here and NO staging-URL checks. Reads use the staff client
 * (RLS) via staffSession. Never import the staging-gated gallery/variant/
 * taxonomy action modules from this file.
 *
 * Status vocabulary: the UI only ever sends 'published' (Active) or
 * 'archived' (Inactive). 'draft' is never accepted from the UI and the
 * RPCs reject it.
 *
 * PUBLICATION (Admin Panel v2, migration 20261115000800): visibility on
 * the public storefront needs BOTH signals — status 'published' AND
 * is_published. admin_publish_product / admin_unpublish_product flip
 * both together (unpublish archives; it never writes 'draft').
 * Setting a published product Inactive pauses its storefront
 * visibility without clearing is_published; setting it Active again
 * resumes it. Published products join the storefront feed (allowlist
 * UNION published admin products — see src/lib/catalog-publication.ts
 * and services/adapters/published-thrift.ts). Visibility is NOT
 * orderability: checkout eligibility is a separate, untouched layer,
 * and the admin UI says so honestly wherever publication is offered.
 *
 * SECONDARY CATEGORIES (migration 20261115000900): products carry a
 * secondary_category_id alongside category_id (the primary). Levels
 * are DERIVED from the parent chain (depth 1 = primary, depth 2 =
 * secondary) — no level is ever stored. The assign RPC + trigger are
 * authoritative: a secondary requires a primary and must belong to
 * it. The v1 create/update RPCs never touch the column, so this module
 * calls admin_assign_product_categories after a successful save and
 * surfaces a retry flag when that call fails.
 *
 * COST VISIBILITY: variant cost prices are stripped server-side for
 * cost-blind roles (see canViewProductCosts in authorization.ts — the
 * single rule, matching the database costs.read permission's union
 * semantics: any cost-viewing role grants visibility). Cost-blind saves
 * are rejected rather than allowed to erase costs.
 *
 * UNAVAILABILITY: listCatalogProducts returns null when the catalogue
 * cannot be read (post-auth only — requireStaff redirects still
 * propagate first). Pages render labelled sample data in that case.
 * Detail reads NEVER throw for data problems and never return sample
 * data: readCatalogProduct returns a discriminated result (ok /
 * not-found / unavailable) plus per-section degradation flags, so the
 * edit page renders an honest error panel or a read-only form instead
 * of the generic error boundary. The same non-throwing discipline
 * applies to readProductMedia and readCategoryOptionsWithStatus.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { staffSession } from "./access";
import {
  actionError,
  actionOk,
  canViewProductCosts,
  requireStaff,
  type AdminActionResult,
  type StaffSession,
} from "./authorization";
import {
  areaRoles,
  MAX_PRODUCT_IMAGES,
  PRODUCT_BADGES,
  productDisplayStatus,
  type ProductDisplayStatus,
} from "./constants";
import { parseMoneyToMinor, slugify } from "./format";
import {
  aggregateVariantStock,
  classifyStock,
  isCatalogStoragePath,
  isValidSlug,
  mergeMainSizes,
  parseTagsInput,
  publicationVisibility,
  validateVariantList,
  variantInputSchema,
  type CatalogListFilters,
  type PublicationVisibility,
  type StockFilter,
  type VariantInput,
  type VariantStockRow,
} from "./catalog-variants";
import { readPublishedFeed } from "../../services/adapters/published-thrift";
import type {
  StorefrontFeedHealthWithCatalogueTotal,
} from "../catalog-publication";
import {
  parseYoutubeVideoInput,
  YOUTUBE_VIDEO_ID_PATTERN,
} from "../youtube-video";

/** Upper bound on rows scanned for one list request (stock/price filters
 *  run in memory over embedded aggregates PostgREST cannot filter by). */
const LIST_FETCH_CAP = 500;

// ------------------------------------------------------------------ helpers

function escapeLike(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Map a PostgREST/RPC error to a safe message. Our RPCs raise authored,
 * user-facing messages; constraint internals are never surfaced.
 */
function rpcErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (
      typeof message === "string" &&
      message.trim().length > 0 &&
      message.length <= 300 &&
      !/constraint|violates|SQLSTATE|relation |function |column |does not exist/i.test(
        message,
      )
    ) {
      return message.trim();
    }
  }
  return fallback;
}

function rpcErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Storefront revalidation for catalogue writes. Same-deployment only:
 * a publish on Preview revalidates Preview, never Production. The
 * storefront renders force-dynamic with no-store feed reads today, so
 * these calls are future-proofing; they become load-bearing if any
 * listing route gains caching. Never revalidates another deployment.
 */
function revalidateStorefront(slug?: string | null): void {
  revalidatePath("/");
  revalidatePath("/shop");
  if (slug) revalidatePath(`/product/${slug}`);
}

// --------------------------------------------------------------------- reads
//
// The list reads are DECOUPLED: the products table is read on its own,
// and each relation (category names, variants, inventory, media) is read
// by a separate query that degrades independently. The previous single
// PostgREST query embedded every relation at once, so any embedded
// relation failure nulled the entire list and the page fell back to
// labelled samples while other pages read real data fine. Now a failed
// relation only degrades its own section (recorded in `degraded`), and
// the products still list. Row validation is per-row and non-throwing:
// a malformed row is skipped and counted, never a page crash.

/** Validate rows one by one; malformed rows are skipped and counted. */
function parseRows<T>(
  data: unknown,
  schema: z.ZodType<T>,
): { rows: T[]; skipped: number } {
  if (!Array.isArray(data)) return { rows: [], skipped: 0 };
  const rows: T[] = [];
  let skipped = 0;
  for (const row of data) {
    const parsed = schema.safeParse(row);
    if (parsed.success) rows.push(parsed.data);
    else skipped += 1;
  }
  return { rows, skipped };
}

/**
 * Read one relation, returning null when the query errors or rejects.
 * A null result degrades only that relation; the caller records it.
 */
async function readRelationRows<T>(
  query: PromiseLike<{ data: unknown; error: unknown }>,
  schema: z.ZodType<T>,
): Promise<T[] | null> {
  let result: { data: unknown; error: unknown };
  try {
    result = await query;
  } catch {
    return null;
  }
  if (result.error) return null;
  return parseRows(result.data, schema).rows;
}

const listBaseRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  category_id: z.uuid().nullable(),
  is_published: z.boolean(),
  published_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  badges: z.array(z.string()),
});

const listBaseRowPrePublicationSchema = listBaseRowSchema.omit({
  is_published: true,
  published_at: true,
});

const listRelationVariantSchema = z.object({
  id: z.uuid(),
  product_id: z.uuid(),
  price_minor: z.number().int().nonnegative(),
  sale_price_minor: z.number().int().nonnegative().nullable(),
  active: z.boolean(),
});

const listRelationInventorySchema = z.object({
  variant_id: z.uuid(),
  on_hand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  // Generated as on_hand - reserved; read as a plain int so a legacy
  // over-reserved row degrades to out-of-stock instead of failing the row.
  available: z.number().int(),
  low_stock_threshold: z.number().int().nonnegative(),
});

const listRelationMediaSchema = z.object({
  product_id: z.uuid(),
  storage_path: z.string(),
  alt_text: z.string(),
  position: z.number().int(),
});

const listRelationCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

export interface CatalogListItem {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "published" | "archived";
  displayStatus: ProductDisplayStatus;
  isPublished: boolean;
  publishedAt: string | null;
  /** Storefront visibility from status + is_published (see publicationVisibility). */
  storefrontVisibility: PublicationVisibility;
  categoryName: string | null;
  /** Display badges (e.g. Best Seller, New Arrival) shown as pills. */
  badges: string[];
  createdAt: string;
  updatedAt: string;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  available: number;
  onHand: number;
  variantCount: number;
  stockFilter: StockFilter;
  thumbnailUrl: string | null;
  thumbnailAlt: string;
}

export interface CatalogListResult {
  items: CatalogListItem[];
  total: number;
  totalPages: number;
  page: number;
  truncated: boolean;
  canManage: boolean;
  /** Relations that failed to load ("categories" | "variants" | "inventory" | "media"). */
  degraded: string[];
  /** Product rows skipped because they failed validation. */
  skippedRows: number;
}

/** Upper bound on relation rows read for one list request. */
const RELATION_FETCH_CAP = 10000;

export async function listCatalogProducts(
  filters: CatalogListFilters,
): Promise<CatalogListResult | null> {
  const session = await requireStaff(areaRoles("catalogue"));
  const canManage = session.roles.some(
    (r) => r === "owner" || r === "product_manager",
  );
  // Base products read only — no embedded relations (see the header note
  // above parseRows). The publication columns arrive with migration 008;
  // the fallback keeps pre-migration databases readable as unpublished.
  const buildBaseQuery = (withPublication: boolean) => {
    let query = session.client
      .from("products")
      .select(
        "id,name,slug,description,status,category_id," +
          (withPublication ? "is_published,published_at," : "") +
          "created_at,updated_at,badges",
        { count: "exact" },
      );
    if (filters.q) {
      const pattern = escapeLike(filters.q);
      query = query.or(`name.ilike.${pattern},slug.ilike.${pattern}`);
    }
    if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
    return query
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(LIST_FETCH_CAP);
  };
  const main = await buildBaseQuery(true);
  let baseRows: z.infer<typeof listBaseRowSchema>[];
  let totalCount: number;
  let skippedRows = 0;
  if (main.error) {
    const fallback = await buildBaseQuery(false);
    if (fallback.error) {
      // Unavailable (not empty): the page renders labelled sample data.
      return null;
    }
    const parsed = parseRows(
      fallback.data ?? [],
      listBaseRowPrePublicationSchema,
    );
    skippedRows = parsed.skipped;
    if ((fallback.data?.length ?? 0) > 0 && parsed.rows.length === 0) {
      // Rows exist but none validate: report unavailable, not empty.
      return null;
    }
    baseRows = parsed.rows.map((row) => ({
      ...row,
      is_published: false,
      published_at: null,
    }));
    totalCount = fallback.count ?? 0;
  } else {
    const parsed = parseRows(main.data ?? [], listBaseRowSchema);
    skippedRows = parsed.skipped;
    if ((main.data?.length ?? 0) > 0 && parsed.rows.length === 0) {
      return null;
    }
    baseRows = parsed.rows;
    totalCount = main.count ?? 0;
  }
  const truncated = totalCount > LIST_FETCH_CAP;

  // Relations: independent queries, each degrading on its own. Inventory
  // depends on the variant ids, so it runs after the first wave.
  const productIds = baseRows.map((row) => row.id);
  const categoryIds = [
    ...new Set(
      baseRows
        .map((row) => row.category_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const degraded: string[] = [];
  const [categoryRows, variantRows, mediaRows] = await Promise.all([
    categoryIds.length > 0
      ? readRelationRows(
          session.client
            .from("categories")
            .select("id,name")
            .in("id", categoryIds),
          listRelationCategorySchema,
        )
      : Promise.resolve([]),
    productIds.length > 0
      ? readRelationRows(
          session.client
            .from("product_variants")
            .select("id,product_id,price_minor,sale_price_minor,active")
            .in("product_id", productIds)
            .limit(RELATION_FETCH_CAP),
          listRelationVariantSchema,
        )
      : Promise.resolve([]),
    productIds.length > 0
      ? readRelationRows(
          session.client
            .from("product_media")
            .select("product_id,storage_path,alt_text,position")
            .in("product_id", productIds)
            .order("product_id", { ascending: true })
            .order("position", { ascending: true })
            .limit(RELATION_FETCH_CAP),
          listRelationMediaSchema,
        )
      : Promise.resolve([]),
  ]);
  if (categoryRows === null) degraded.push("categories");
  if (variantRows === null) degraded.push("variants");
  if (mediaRows === null) degraded.push("media");
  const variants = variantRows ?? [];
  const inventoryRows =
    variants.length > 0
      ? await readRelationRows(
          session.client
            .from("inventory")
            .select(
              "variant_id,on_hand,reserved,available,low_stock_threshold",
            )
            .in(
              "variant_id",
              variants.map((variant) => variant.id),
            )
            .limit(RELATION_FETCH_CAP),
          listRelationInventorySchema,
        )
      : [];
  if (inventoryRows === null) degraded.push("inventory");

  const categoryNames = new Map(
    (categoryRows ?? []).map((row) => [row.id, row.name]),
  );
  const inventoryByVariant = new Map(
    (inventoryRows ?? []).map((row) => [row.variant_id, row]),
  );
  const variantsByProduct = new Map<string, VariantStockRow[]>();
  for (const variant of variants) {
    const list = variantsByProduct.get(variant.product_id) ?? [];
    list.push({
      price_minor: variant.price_minor,
      sale_price_minor: variant.sale_price_minor,
      active: variant.active,
      inventory: inventoryByVariant.get(variant.id) ?? null,
    });
    variantsByProduct.set(variant.product_id, list);
  }
  // First row per product in (product_id, position) order is its thumbnail.
  const mediaByProduct = new Map<
    string,
    { storage_path: string; alt_text: string }
  >();
  for (const media of mediaRows ?? []) {
    if (!mediaByProduct.has(media.product_id)) {
      mediaByProduct.set(media.product_id, media);
    }
  }

  const enriched = baseRows.map((row) => {
    const aggregate = aggregateVariantStock(
      variantsByProduct.get(row.id) ?? [],
    );
    return {
      row,
      aggregate,
      stockFilter: classifyStock(aggregate),
      displayStatus: productDisplayStatus(
        row.status,
        aggregate.available > 0,
      ),
      categoryName:
        row.category_id !== null
          ? (categoryNames.get(row.category_id) ?? null)
          : null,
      media: mediaByProduct.get(row.id) ?? null,
    };
  });
  const filtered = enriched.filter(({ aggregate, stockFilter }) => {
    if (filters.stock && filters.stock !== stockFilter) return false;
    if (
      filters.minPriceMinor !== null &&
      (aggregate.minPriceMinor === null ||
        aggregate.minPriceMinor < filters.minPriceMinor)
    ) {
      return false;
    }
    if (
      filters.maxPriceMinor !== null &&
      (aggregate.minPriceMinor === null ||
        aggregate.minPriceMinor > filters.maxPriceMinor)
    ) {
      return false;
    }
    return true;
  });
  const sorted = [...filtered].sort((a, b) => {
    if (filters.sort === "name") return a.row.name.localeCompare(b.row.name);
    if (filters.sort === "price") {
      return (a.aggregate.minPriceMinor ?? Number.MAX_SAFE_INTEGER) -
        (b.aggregate.minPriceMinor ?? Number.MAX_SAFE_INTEGER);
    }
    if (filters.sort === "stock") {
      return b.aggregate.available - a.aggregate.available;
    }
    return (
      Date.parse(b.row.created_at) - Date.parse(a.row.created_at) ||
      a.row.id.localeCompare(b.row.id)
    );
  });
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, totalPages);
  const pageRows = sorted.slice(
    (page - 1) * filters.pageSize,
    page * filters.pageSize,
  );
  const items: CatalogListItem[] = await Promise.all(
    pageRows.map(
      async ({
        row,
        aggregate,
        stockFilter,
        displayStatus,
        categoryName,
        media,
      }) => {
        let thumbnailUrl: string | null = null;
        if (media) {
          const signed = await session.client.storage
            .from("attires-product-drafts")
            .createSignedUrl(media.storage_path, 120);
          if (!signed.error) thumbnailUrl = signed.data.signedUrl;
        }
        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          status: row.status,
          displayStatus,
          isPublished: row.is_published,
          publishedAt: row.published_at,
          storefrontVisibility: publicationVisibility(
            row.status,
            row.is_published,
          ),
          categoryName,
          badges: row.badges,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          minPriceMinor: aggregate.minPriceMinor,
          maxPriceMinor: aggregate.maxPriceMinor,
          available: aggregate.available,
          onHand: aggregate.onHand,
          variantCount: aggregate.variantCount,
          stockFilter,
          thumbnailUrl,
          thumbnailAlt: media?.alt_text || row.name,
        };
      },
    ),
  );
  return {
    items,
    total,
    totalPages,
    page,
    truncated,
    canManage,
    degraded,
    skippedRows,
  };
}

const categoryOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  parent_id: z.uuid().nullable(),
  published: z.boolean(),
  sort_position: z.number().int().nullable().optional().default(0),
});

export type CategoryOption = z.infer<typeof categoryOptionSchema>;

export interface CategoryOptionsRead {
  options: CategoryOption[];
  /** True when neither category query succeeded. */
  unavailable: boolean;
  /** Option rows skipped as malformed; the set may be incomplete. */
  skipped: number;
}

/**
 * Flat category list for product-form selects (parents + children),
 * reported instead of thrown: callers that can degrade (edit/create
 * pages) render a notice — and the edit page a read-only form — when
 * the option set is unavailable or incomplete, because saving with a
 * missing option could silently unassign the product's category.
 */
export async function readCategoryOptionsWithStatus(): Promise<CategoryOptionsRead> {
  const session = await staffSession();
  let result: { data: unknown; error: unknown };
  try {
    result = await session.client
      .from("categories")
      .select("id,name,slug,parent_id,published,sort_position")
      .order("sort_position", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .limit(500);
  } catch {
    result = { data: null, error: new Error("Categories could not be read.") };
  }
  if (result.error) {
    // sort_position arrives with migration 002; fall back to a name-ordered
    // list so the form still renders on a pre-migration database.
    let fallback: { data: unknown; error: unknown };
    try {
      fallback = await session.client
        .from("categories")
        .select("id,name,slug,parent_id,published")
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .limit(500);
    } catch {
      fallback = { data: null, error: new Error("Categories could not be read.") };
    }
    if (fallback.error) {
      return { options: [], unavailable: true, skipped: 0 };
    }
    // Per-row validation: one malformed option row is skipped, never a
    // page crash; the skipped count tells the caller the set is partial.
    const parsed = parseRows(
      (Array.isArray(fallback.data) ? fallback.data : []).map((row) => ({
        ...(row as Record<string, unknown>),
        sort_position: 0,
      })),
      categoryOptionSchema
        .omit({ sort_position: true })
        .extend({ sort_position: z.number().int().default(0) }),
    );
    return { options: parsed.rows, unavailable: false, skipped: parsed.skipped };
  }
  const parsed = parseRows(result.data ?? [], categoryOptionSchema);
  return { options: parsed.rows, unavailable: false, skipped: parsed.skipped };
}

/** Flat category list for product-form selects (parents + children). */
export async function readCategoryOptions(options: {
  onUnavailable?: "throw" | "empty";
} = {}): Promise<CategoryOption[]> {
  const read = await readCategoryOptionsWithStatus();
  if (read.unavailable) {
    // Lenient mode (list filter only): an empty option list degrades
    // the filter without failing the page. Other callers keep throwing.
    if (options.onUnavailable === "empty") return [];
    throw new Error("Categories could not be read.");
  }
  return read.options;
}

const productDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  category_id: z.uuid().nullable(),
  secondary_category_id: z.uuid().nullable(),
  is_published: z.boolean(),
  published_at: z.iso.datetime({ offset: true }).nullable(),
  brand: z.string().nullable(),
  highlights: z.array(z.string()),
  tags: z.array(z.string()),
  badges: z.array(z.string()),
  seo_title: z.string().nullable(),
  seo_description: z.string().nullable(),
  meta_keywords: z.string().nullable(),
  /** YouTube video ID (migration 014); null when no video or pre-migration. */
  youtube_video_id: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

const detailVariantSchema = z.object({
  id: z.uuid(),
  size: z.string(),
  color: z.string(),
  price_minor: z.number().int().nonnegative(),
  sale_price_minor: z.number().int().nonnegative().nullable(),
  cost_price_minor: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
});

const detailInventorySchema = z.object({
  variant_id: z.uuid(),
  on_hand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  low_stock_threshold: z.number().int().nonnegative(),
});

export interface CatalogProductDetail {
  product: z.infer<typeof productDetailSchema>;
  categoryName: string | null;
  secondaryCategoryName: string | null;
  variants: Array<
    Omit<z.infer<typeof detailVariantSchema>, "cost_price_minor"> & {
      cost_price_minor: number | null;
      inventory: z.infer<typeof detailInventorySchema> | null;
    }
  >;
  canManage: boolean;
  /** False for cost-blind roles: every variant cost reads null. */
  canViewCosts: boolean;
  /** True when the variants query failed: the form must render read-only. */
  variantsUnavailable: boolean;
  /** Variant rows skipped as malformed; untouched by saves (merge RPC). */
  variantsSkipped: number;
  /** True when the inventory query failed: stock fields show defaults. */
  inventoryUnavailable: boolean;
  /** Inventory rows skipped as malformed. */
  inventorySkipped: number;
}

/**
 * Result of reading one product for the edit page. A detail/edit page
 * must never show a sample product, so failures are REPORTED, never
 * thrown: "not-found" renders the 404, "unavailable" renders an honest
 * error panel, and per-section flags let the page degrade gracefully.
 * Session failures (requireStaff redirects, MFA) still propagate —
 * only data problems are reported here.
 */
export type CatalogProductRead =
  | { status: "ok"; detail: CatalogProductDetail }
  | { status: "not-found" }
  | { status: "unavailable" };

export async function readCatalogProduct(
  id: string,
): Promise<CatalogProductRead> {
  const session = await staffSession();
  if (!z.uuid().safeParse(id).success) return { status: "not-found" };
  const canViewCosts = canViewProductCosts(session);
  // NO embedded relations: products has TWO foreign keys to categories
  // (category_id + secondary_category_id since migration 009), so a
  // categories(name) embed is ambiguous and PostgREST rejects it on
  // every call — that crashed the edit page on every load. Category
  // names are read with separate queries, below.
  const productColumns =
    "id,name,slug,description,status,category_id,brand,highlights,tags,badges," +
    "seo_title,seo_description,meta_keywords,youtube_video_id,created_at,updated_at," +
    "secondary_category_id,is_published,published_at";
  const productBaseColumns =
    "id,name,slug,description,status,category_id,brand,highlights,tags,badges," +
    "seo_title,seo_description,meta_keywords,created_at,updated_at";
  // No cost_price_minor here: the cost column is excluded from the
  // anon/authenticated SELECT grant (migration 20261117000200), so a
  // direct select cannot serve it. Costs for cost-viewing roles come
  // from the gated admin_variant_costs RPC below, never from this read.
  const variantColumns =
    "id,size,color,price_minor,sale_price_minor,active,created_at";
  // The product and variants reads are independent (both keyed by the id
  // parameter), so they run in parallel. allSettled plus ordered checks
  // keeps the original precedence: product failures surface first, and
  // a missing product still reports not-found.
  const [productSettled, variantsSettled] = await Promise.allSettled([
    session.client
      .from("products")
      .select(productColumns)
      .eq("id", id)
      .maybeSingle(),
    session.client
      .from("product_variants")
      .select(variantColumns)
      .eq("product_id", id)
      .order("created_at", { ascending: true })
      .limit(101),
  ]);
  // Product read: any failure (rejection, both selects erroring, or a
  // malformed row) is "unavailable" — never a throw, never a sample.
  let productData: unknown;
  if (
    productSettled.status === "fulfilled" &&
    !productSettled.value.error
  ) {
    if (!productSettled.value.data) return { status: "not-found" };
    productData = productSettled.value.data;
  } else {
    // Pre-migration fallback: the publication/hierarchy columns arrive
    // with migrations 008/009; without them the product reads as
    // unpublished with no secondary category.
    let fallback: { data: unknown; error: unknown } | null = null;
    try {
      fallback = await session.client
        .from("products")
        .select(productBaseColumns)
        .eq("id", id)
        .maybeSingle();
    } catch {
      fallback = null;
    }
    if (!fallback || fallback.error) return { status: "unavailable" };
    if (!fallback.data) return { status: "not-found" };
    // The row is validated by the schema parse below; the cast only
    // recovers a spreadable object type from the client's select type.
    productData = {
      ...(fallback.data as unknown as Record<string, unknown>),
      secondary_category_id: null,
      is_published: false,
      published_at: null,
      // Pre-migration fallback: migration 014's column is absent, so
      // the product reads as having no video.
      youtube_video_id: null,
    };
  }
  const parsed = productDetailSchema.safeParse(productData);
  if (!parsed.success) return { status: "unavailable" };
  const base = parsed.data;
  // Variants: a failed query degrades the section (the page renders the
  // form read-only); malformed rows are skipped, never a page crash.
  // Skipped variants stay untouched on save: the update RPC merges.
  let variantRows: z.infer<typeof detailVariantSchema>[] = [];
  let variantsUnavailable = false;
  let variantsSkipped = 0;
  if (
    variantsSettled.status === "rejected" ||
    variantsSettled.value.error
  ) {
    variantsUnavailable = true;
  } else {
    const variantParsed = parseRows(
      variantsSettled.value.data ?? [],
      detailVariantSchema,
    );
    variantRows = variantParsed.rows;
    variantsSkipped = variantParsed.skipped;
  }
  // Inventory (keyed by the variant rows just read), the category
  // names (keyed by the product row), and the cost read (keyed by the
  // variant rows, cost-viewing roles only) are independent of each
  // other, so they run in parallel. All of these reads are non-fatal:
  // a missing name is cosmetic (the form shows the stored assignment),
  // and a failed inventory read only affects the displayed stock
  // figures. A failed cost read degrades the variants section to
  // read-only (see below): blank costs must never be saved over
  // stored costs.
  const [inventorySettled, primarySettled, secondarySettled, costsSettled] =
    await Promise.allSettled([
      variantRows.length
        ? session.client
            .from("inventory")
            .select("variant_id,on_hand,reserved,available,low_stock_threshold")
            .in(
              "variant_id",
              variantRows.map((v) => v.id),
            )
        : Promise.resolve(null),
      base.category_id
        ? session.client
            .from("categories")
            .select("name")
            .eq("id", base.category_id)
            .maybeSingle()
        : Promise.resolve(null),
      base.secondary_category_id
        ? session.client
            .from("categories")
            .select("name")
            .eq("id", base.secondary_category_id)
            .maybeSingle()
        : Promise.resolve(null),
      // Costs come ONLY from the gated admin_variant_costs RPC
      // (costs.read + MFA, enforced server-side), behind the existing
      // role gate. The RPC rejects an empty list, so it is never
      // called without variants; the detail read caps at 101
      // variants, under the RPC's 500 cap, and the slice guards the
      // bound regardless.
      canViewCosts && variantRows.length > 0
        ? session.client.rpc("admin_variant_costs", {
            p_variant_ids: variantRows.map((v) => v.id).slice(0, 500),
          })
        : Promise.resolve(null),
    ]);
  const inventoryValue =
    inventorySettled.status === "fulfilled" ? inventorySettled.value : null;
  let inventoryByVariant = new Map<string, z.infer<typeof detailInventorySchema>>();
  let inventoryUnavailable = false;
  let inventorySkipped = 0;
  if (inventorySettled.status === "rejected" || inventoryValue?.error) {
    inventoryUnavailable = true;
  } else {
    const inventoryParsed = parseRows(
      inventoryValue?.data ?? [],
      detailInventorySchema,
    );
    inventorySkipped = inventoryParsed.skipped;
    inventoryByVariant = new Map(
      inventoryParsed.rows.map((row) => [row.variant_id, row]),
    );
  }
  // Merge RPC costs by variant id. A missing or failing RPC (the
  // function does not exist on a database where the cost migrations
  // have not applied yet, or the call is refused) never throws:
  // costs stay null and the variants section degrades to read-only,
  // so a cost-viewer can never save blank costs over stored ones.
  // Cost-blind roles never reach the RPC; their costs stay null.
  const costsByVariant = new Map<string, number | null>();
  if (canViewCosts && variantRows.length > 0) {
    const costsValue =
      costsSettled.status === "fulfilled" ? costsSettled.value : null;
    if (costsSettled.status === "rejected" || !costsValue || costsValue.error) {
      variantsUnavailable = true;
    } else {
      for (const row of costsValue.data ?? []) {
        if (
          row &&
          typeof row.variant_id === "string" &&
          (typeof row.cost_price_minor === "number" ||
            row.cost_price_minor === null)
        ) {
          costsByVariant.set(row.variant_id, row.cost_price_minor);
        }
      }
    }
  }
  const nameSchema = z.object({ name: z.string() });
  const primaryValue =
    primarySettled.status === "fulfilled" ? primarySettled.value : null;
  const categoryName =
    primaryValue && !primaryValue.error && primaryValue.data
      ? (nameSchema.safeParse(primaryValue.data).data?.name ?? null)
      : null;
  const secondaryValue =
    secondarySettled.status === "fulfilled" ? secondarySettled.value : null;
  const secondaryName =
    secondaryValue && !secondaryValue.error && secondaryValue.data
      ? (nameSchema.safeParse(secondaryValue.data).data?.name ?? null)
      : null;
  return {
    status: "ok",
    detail: {
      product: base,
      categoryName,
      secondaryCategoryName: secondaryName,
      variants: variantRows.map((v) => ({
        ...v,
        // Server-side cost hiding: cost-blind roles receive null, never
        // the real figure, in any configuration. Cost-viewing roles
        // receive only the RPC-merged figure: the direct variant read
        // no longer selects the cost column, so any cost value on the
        // row itself is never trusted.
        cost_price_minor: canViewCosts
          ? (costsByVariant.get(v.id) ?? null)
          : null,
        inventory: inventoryByVariant.get(v.id) ?? null,
      })),
      canManage: session.roles.some(
        (r) => r === "owner" || r === "product_manager",
      ),
      canViewCosts,
      variantsUnavailable,
      variantsSkipped,
      inventoryUnavailable,
      inventorySkipped,
    },
  };
}

/**
 * Whole-catalogue product total: a head-count read (no rows are
 * transferred) through the staff client (RLS) — the same client
 * listCatalogProducts reads products with, so no new grants and no
 * migration are needed. Never throws: null on any failure, so a
 * failed count degrades to "Could not be checked" on the unpublished
 * row instead of failing the whole feed card.
 */
async function readCatalogueTotal(
  client: StaffSession["client"],
): Promise<number | null> {
  try {
    const total = await client
      .from("products")
      .select("id", { count: "exact", head: true });
    return total.error || total.count === null ? null : total.count;
  } catch {
    return null;
  }
}

/**
 * Storefront feed health for the admin-only diagnostics indicator
 * (staff-gated: project refs are not secrets, but the indicator is an
 * operator surface, not a public one). Returns null when the feed
 * read itself fails unexpectedly; per-source failures are reported
 * inside the health object, never thrown. The catalogue total rides
 * along so the card can show the unpublished count (total − published).
 */
export async function readStorefrontFeedHealth(): Promise<StorefrontFeedHealthWithCatalogueTotal | null> {
  const session = await requireStaff(areaRoles("catalogue"));
  try {
    const [feed, catalogueTotal] = await Promise.all([
      readPublishedFeed(),
      readCatalogueTotal(session.client),
    ]);
    return {
      configured: feed.configured,
      allowlistOk: feed.allowlistOk,
      publishedOk: feed.publishedOk,
      allowlistCount: feed.allowlistCount,
      publishedCount: feed.publishedCount,
      visibleCount: feed.visibleCount,
      projectRef: feed.projectRef,
      envProjectRef: feed.envProjectRef,
      expectedProjectRef: feed.expectedProjectRef,
      allowlistError: feed.allowlistError,
      publishedError: feed.publishedError,
      catalogueTotal,
    };
  } catch {
    return null;
  }
}

// -------------------------------------------------------------- form parsing

export interface ProductFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const productFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a product name.").max(200),
  slug: z
    .string()
    .trim()
    .min(1, "Enter a URL slug.")
    .max(160)
    .refine(isValidSlug, "Use lowercase letters, numbers and single hyphens."),
  description: z.string().max(20000, "Description is too long."),
  status: z.enum(["published", "archived"]),
  category_id: z.uuid().nullable(),
  secondary_category_id: z.uuid().nullable(),
  brand: z.string().trim().max(120).nullable(),
  highlights: z.array(z.string().trim().min(1).max(200)).max(20),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  badges: z.array(z.enum(PRODUCT_BADGES)).max(5),
  seo_title: z.string().trim().max(160).nullable(),
  seo_description: z.string().trim().max(320).nullable(),
  meta_keywords: z.string().trim().max(500).nullable(),
  /** Canonical 11-char YouTube ID extracted from the pasted link. */
  youtube_video_id: z.string().regex(YOUTUBE_VIDEO_ID_PATTERN).nullable(),
  base_price_minor: z.number().int().min(0),
  base_sale_price_minor: z.number().int().min(0).nullable(),
  base_cost_price_minor: z.number().int().min(0).nullable(),
  base_stock: z.number().int().min(0),
  // Merged variants: explicit variant-editor rows plus main-level sizes
  // expanded by mergeMainSizes in parseProductForm (materialization —
  // see catalog-variants.ts). Generated rows carry no id.
  variants: z.array(variantInputSchema).max(100),
});

type ProductFormData = z.infer<typeof productFormSchema>;

function parseProductForm(form: FormData): {
  data?: ProductFormData;
  fieldErrors?: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const text = (key: string): string => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  const rawName = text("name");
  const rawSlug = text("slug").trim() || slugify(rawName);
  const categoryRaw = text("category_id").trim();
  const secondaryRaw = text("secondary_category_id").trim();
  // Cheap shape check only: the assign RPC + trigger are authoritative
  // for the pair (secondary requires a primary, must belong to it).
  if (secondaryRaw !== "" && categoryRaw === "") {
    fieldErrors.secondary_category_id =
      "Choose a primary category before choosing a secondary category.";
  }
  // The form sends a pasted YouTube link; only the extracted video ID
  // is stored. An unparseable link is a field-level error, never a
  // silent drop: the admin must fix it or clear the field.
  const youtubeParsed = parseYoutubeVideoInput(text("youtube_video_url"));
  if (youtubeParsed.error) {
    fieldErrors.youtube_video_url = youtubeParsed.error;
  }
  const basePrice = parseMoneyToMinor(text("base_price"));
  const baseSaleRaw = text("base_sale_price").trim();
  const baseCostRaw = text("base_cost_price").trim();
  const baseSale =
    baseSaleRaw === "" ? null : parseMoneyToMinor(baseSaleRaw);
  const baseCost =
    baseCostRaw === "" ? null : parseMoneyToMinor(baseCostRaw);
  const baseStockRaw = text("base_stock").trim();
  const baseStock = /^\d{1,9}$/.test(baseStockRaw)
    ? Number.parseInt(baseStockRaw, 10)
    : NaN;
  if (basePrice === null) fieldErrors.base_price = "Enter a valid regular price.";
  if (baseSaleRaw !== "" && baseSale === null) {
    fieldErrors.base_sale_price = "Enter a valid sale price.";
  }
  if (baseSale !== null && basePrice !== null && baseSale > basePrice) {
    fieldErrors.base_sale_price = "Sale price cannot exceed the regular price.";
  }
  if (baseCostRaw !== "" && baseCost === null) {
    fieldErrors.base_cost_price = "Enter a valid cost price.";
  }
  if (!Number.isFinite(baseStock)) {
    fieldErrors.base_stock = "Enter a whole-number stock quantity.";
  }
  const highlights = form
    .getAll("highlights")
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
  let variants: VariantInput[] = [];
  const variantsRaw = text("variants_json");
  if (variantsRaw.trim()) {
    try {
      const parsedJson: unknown = JSON.parse(variantsRaw);
      const parsed = z.array(variantInputSchema).safeParse(parsedJson);
      if (!parsed.success) {
        fieldErrors.variants =
          "Check the variant rows: each needs a size, a color and valid prices.";
      } else {
        variants = parsed.data;
        const listError = validateVariantList(variants);
        if (listError) fieldErrors.variants = listError;
      }
    } catch {
      fieldErrors.variants = "Variant data could not be read. Reload and try again.";
    }
  }
  // Main-level sizes (sizes build): rows from the Sizes section expand
  // into ordinary variant rows via mergeMainSizes (materialization —
  // see catalog-variants.ts) and join the variants array before the
  // price check and schema validation below, so the merged total is
  // what the RPC receives. The merge runs only once the base price
  // parsed: without a price the save is already blocked, and generated
  // rows price from it. toRpcPayload needs no change: it serializes
  // this same array, and generated rows carry no id.
  let mainSizesRows: unknown = [];
  let mainSizesUnreadable = false;
  const mainSizesRaw = text("main_sizes_json");
  if (mainSizesRaw.trim()) {
    try {
      mainSizesRows = JSON.parse(mainSizesRaw);
    } catch {
      mainSizesUnreadable = true;
      fieldErrors.main_sizes =
        "Sizes data could not be read. Reload and try again.";
    }
  }
  if (!mainSizesUnreadable && basePrice !== null) {
    const merged = mergeMainSizes({
      explicitVariants: variants,
      rows: mainSizesRows,
      mainColor: text("main_color"),
      basePriceMinor: basePrice,
      baseSalePriceMinor: baseSale,
      baseCostPriceMinor: baseCost,
    });
    if (merged.fieldError) {
      fieldErrors[merged.fieldError.field] = merged.fieldError.message;
    } else {
      variants = merged.variants;
    }
  }
  if (variants.length === 0 && basePrice !== null && basePrice <= 0) {
    fieldErrors.base_price =
      "Enter a regular price above ৳0.00 for a product without variants.";
  }
  const badges = form
    .getAll("badges")
    .filter((v): v is string => typeof v === "string");
  const candidate = {
    name: rawName,
    slug: rawSlug,
    description: text("description"),
    status: text("status"),
    category_id: categoryRaw === "" ? null : categoryRaw,
    secondary_category_id: secondaryRaw === "" ? null : secondaryRaw,
    brand: text("brand").trim() === "" ? null : text("brand").trim(),
    highlights,
    tags: parseTagsInput(text("tags")),
    badges,
    seo_title: text("seo_title").trim() === "" ? null : text("seo_title").trim(),
    seo_description:
      text("seo_description").trim() === "" ? null : text("seo_description").trim(),
    meta_keywords:
      text("meta_keywords").trim() === "" ? null : text("meta_keywords").trim(),
    youtube_video_id: youtubeParsed.videoId,
    base_price_minor: basePrice ?? -1,
    base_sale_price_minor: baseSale,
    base_cost_price_minor: baseCost,
    base_stock: Number.isFinite(baseStock) ? baseStock : -1,
    variants,
  };
  const parsed = productFormSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      const mapped =
        key === "category_id"
          ? "category_id"
          : key === "youtube_video_id"
            ? "youtube_video_url"
            : key === "base_price_minor"
            ? "base_price"
            : key === "base_sale_price_minor"
              ? "base_sale_price"
              : key === "base_cost_price_minor"
                ? "base_cost_price"
                : key === "base_stock"
                  ? "base_stock"
                  : key;
      fieldErrors[mapped] ??= issue.message;
    }
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  if (!parsed.success) {
    return { fieldErrors: { form: "Check the highlighted fields." } };
  }
  return { data: parsed.data };
}

function toRpcPayload(data: ProductFormData, includeIds: boolean) {
  return {
    name: data.name,
    slug: data.slug,
    description: data.description,
    status: data.status,
    category_id: data.category_id,
    brand: data.brand,
    highlights: data.highlights,
    tags: data.tags,
    badges: data.badges,
    seo_title: data.seo_title,
    seo_description: data.seo_description,
    meta_keywords: data.meta_keywords,
    // Ignored by the pre-014 RPCs (unknown jsonb key), persisted once
    // migration 014 is applied — so saves stay safe in either state.
    youtube_video_id: data.youtube_video_id,
    base_price_minor: data.base_price_minor,
    base_sale_price_minor: data.base_sale_price_minor,
    base_cost_price_minor: data.base_cost_price_minor,
    base_stock: data.base_stock,
    variants: data.variants.map((v) => ({
      ...(includeIds && v.id ? { id: v.id } : {}),
      size: v.size,
      color: v.color,
      price_minor: v.price_minor,
      sale_price_minor: v.sale_price_minor,
      cost_price_minor: v.cost_price_minor,
      stock: v.stock,
      active: v.active,
    })),
  };
}

function rpcFailureState(
  error: unknown,
  fallback: string,
): ProductFormState {
  const code = rpcErrorCode(error);
  const message = rpcErrorMessage(error, fallback);
  if (code === "PT409") {
    return {
      ok: false,
      error: "This product changed. Reload before saving.",
      fieldErrors: { form: "This product changed. Reload before saving." },
    };
  }
  if (code === "23505" || /slug already exists/i.test(message)) {
    return {
      ok: false,
      error: "That URL slug already exists. Choose a different slug.",
      fieldErrors: { slug: "That URL slug already exists." },
    };
  }
  return { ok: false, error: message };
}

/**
 * True when the submitted form carried at least one main-size row.
 * The merge leaves no marker on generated rows, so the raw field is
 * re-read: an empty list means the duplicate came from explicit
 * variant rows and must not be blamed on the main-sizes field.
 */
function submittedMainSizes(form: FormData): boolean {
  const raw = form.get("main_sizes_json");
  if (typeof raw !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------- actions

export async function createCatalogProduct(
  _prev: ProductFormState,
  form: FormData,
): Promise<ProductFormState> {
  const session = await requireStaff(areaRoles("catalogue"));
  const { data, fieldErrors } = parseProductForm(form);
  if (!data) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors,
    };
  }
  // Cost-blind roles must never write costs (forward-defense: the
  // catalogue area gate admits only owner/product_manager today).
  const payload = canViewProductCosts(session)
    ? data
    : {
        ...data,
        base_cost_price_minor: null,
        variants: data.variants.map((v) => ({
          ...v,
          cost_price_minor: null,
        })),
      };
  const result = await session.client.rpc("admin_create_product", {
    p: toRpcPayload(payload, false),
  });
  if (result.error || typeof result.data !== "string") {
    return rpcFailureState(result.error, "Product could not be created.");
  }
  const productId = result.data;
  const flags: string[] = [];
  if (data.secondary_category_id) {
    const outcome = await saveProductCategoryAssignment(
      session.client,
      productId,
      data.category_id,
      data.secondary_category_id,
    );
    if (outcome === "failed") flags.push("categories=failed");
    else if (outcome === "unverified") flags.push("categories=unverified");
  }
  const staged = parseStagedImages(form, session.user.id);
  if (staged.attempted > 0) {
    const attached = await attachStagedImages(
      session.client,
      productId,
      staged.paths,
    );
    const failed = staged.attempted - attached;
    if (failed > 0) {
      flags.push("images=partial", `images_failed=${failed}`);
    }
  }
  revalidatePath("/admin/catalog/products");
  revalidatePath("/admin/catalog/inventory");
  revalidateStorefront(data.slug);
  const query =
    flags.length > 0 ? `?saved=created&${flags.join("&")}` : "?saved=created";
  redirect(`/admin/catalog/products/${productId}${query}`);
}

export async function updateCatalogProduct(
  _prev: ProductFormState,
  form: FormData,
): Promise<ProductFormState> {
  const session = await requireStaff(areaRoles("catalogue"));
  const idRaw = form.get("id");
  const updatedRaw = form.get("updated_at");
  const id = typeof idRaw === "string" ? idRaw : "";
  const expectedUpdatedAt = typeof updatedRaw === "string" ? updatedRaw : "";
  if (!z.uuid().safeParse(id).success || !expectedUpdatedAt) {
    return {
      ok: false,
      error: "Reload the product before saving.",
      fieldErrors: { form: "Reload the product before saving." },
    };
  }
  const { data, fieldErrors } = parseProductForm(form);
  if (!data) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors,
    };
  }
  // Cost-blind roles cannot save: the form omits cost inputs for them,
  // so saving would erase the stored costs. Reject honestly instead.
  // (Unreachable today: the catalogue area gate admits only
  // owner/product_manager. Forward-defense for future role changes.)
  if (!canViewProductCosts(session)) {
    return {
      ok: false,
      error:
        "Saving is unavailable for your role because cost prices would be removed. Ask an owner or product manager to save this product.",
      fieldErrors: {
        form: "Saving is unavailable for your role because cost prices would be removed.",
      },
    };
  }
  const result = await session.client.rpc("admin_update_product", {
    target_id: id,
    expected_updated_at: expectedUpdatedAt,
    p: toRpcPayload(data, true),
  });
  if (result.error) {
    const state = rpcFailureState(result.error, "Product could not be saved.");
    // A main size colliding with a variant that failed to load
    // (variantsSkipped > 0) is rejected by the RPC after the merge
    // has already run, so the field mapping happens here: surface
    // the rejection on the main-sizes field as well as the form
    // level, so the admin sees which field to fix.
    if (
      state.error?.includes("Duplicate size and color combination") &&
      submittedMainSizes(form)
    ) {
      return {
        ...state,
        fieldErrors: {
          ...state.fieldErrors,
          main_sizes: "A size you added already exists — edit it in Variants.",
        },
      };
    }
    return state;
  }
  const flags: string[] = [];
  const outcome = await saveProductCategoryAssignment(
    session.client,
    id,
    data.category_id,
    data.secondary_category_id,
  );
  if (outcome === "failed") flags.push("categories=failed");
  else if (outcome === "unverified") flags.push("categories=unverified");
  revalidatePath("/admin/catalog/products");
  revalidatePath(`/admin/catalog/products/${id}`);
  revalidatePath("/admin/catalog/inventory");
  revalidateStorefront(data.slug);
  const query =
    flags.length > 0 ? `?saved=updated&${flags.join("&")}` : "?saved=updated";
  redirect(`/admin/catalog/products/${id}${query}`);
}

const statusChangeSchema = z.object({
  id: z.uuid(),
  status: z.enum(["published", "archived"]),
});

async function readProductRevision(
  client: Awaited<ReturnType<typeof staffSession>>["client"],
  id: string,
): Promise<{ updatedAt: string; slug: string } | null> {
  let row: { data: unknown; error: unknown };
  try {
    row = await client
      .from("products")
      .select("updated_at,slug")
      .eq("id", id)
      .maybeSingle();
  } catch {
    return null;
  }
  if (row.error || !row.data) return null;
  const parsed = z
    .object({ updated_at: z.string(), slug: z.string() })
    .safeParse(row.data);
  return parsed.success
    ? { updatedAt: parsed.data.updated_at, slug: parsed.data.slug }
    : null;
}

/**
 * Set the product's primary + secondary categories atomically via
 * migration 009. Returns false when the revision cannot be read, the
 * RPC fails (including when migration 009 is unapplied), or the call
 * rejects. False does NOT prove the assignment was lost — the product
 * save RPC already persists category_id — so callers must verify via
 * saveProductCategoryAssignment instead of reporting failure directly.
 */
async function assignProductCategories(
  client: Awaited<ReturnType<typeof staffSession>>["client"],
  productId: string,
  primaryId: string | null,
  secondaryId: string | null,
): Promise<boolean> {
  const revision = await readProductRevision(client, productId);
  if (!revision) return false;
  try {
    const result = await client.rpc("admin_assign_product_categories", {
      target_id: productId,
      expected_updated_at: revision.updatedAt,
      primary_category_id: primaryId,
      secondary_category_id: secondaryId,
    });
    return !result.error;
  } catch {
    return false;
  }
}

const productCategoryPairSchema = z.object({
  category_id: z.uuid().nullable(),
  secondary_category_id: z.uuid().nullable(),
});

/**
 * The stored category pair for one product. Null when unreadable
 * (query error, rejection, missing row, or malformed row) — callers
 * must treat null as "could not verify", never as a failed save.
 */
async function readProductCategoryPair(
  client: Awaited<ReturnType<typeof staffSession>>["client"],
  productId: string,
): Promise<{
  categoryId: string | null;
  secondaryCategoryId: string | null;
} | null> {
  let row: { data: unknown; error: unknown };
  try {
    row = await client
      .from("products")
      .select("category_id,secondary_category_id")
      .eq("id", productId)
      .maybeSingle();
  } catch {
    return null;
  }
  if (row.error || !row.data) return null;
  const parsed = productCategoryPairSchema.safeParse(row.data);
  return parsed.success
    ? {
        categoryId: parsed.data.category_id,
        secondaryCategoryId: parsed.data.secondary_category_id,
      }
    : null;
}

export type CategoryAssignmentOutcome = "saved" | "failed" | "unverified";

/**
 * Assign the category pair, then VERIFY against the stored row before
 * reporting failure. The product save RPC already persists
 * category_id, so a failed assign RPC does not prove the assignment
 * was lost: the assign RPC rejects pairs the save RPC accepts (for
 * example a non-top-level primary), and in that case the stored pair
 * is exactly what was submitted. Only a read-back mismatch is a
 * genuine failure; an unreadable read-back is "unverified", never a
 * false "could not be saved" claim.
 */
async function saveProductCategoryAssignment(
  client: Awaited<ReturnType<typeof staffSession>>["client"],
  productId: string,
  primaryId: string | null,
  secondaryId: string | null,
): Promise<CategoryAssignmentOutcome> {
  const assigned = await assignProductCategories(
    client,
    productId,
    primaryId,
    secondaryId,
  );
  if (assigned) return "saved";
  const stored = await readProductCategoryPair(client, productId);
  if (!stored) return "unverified";
  return stored.categoryId === primaryId &&
    stored.secondaryCategoryId === secondaryId
    ? "saved"
    : "failed";
}

interface StagedImageInput {
  path: string;
  alt: string;
}

/**
 * Parse the staged-images JSON written by the create form's pre-upload
 * panel. Fails closed: malformed entries, foreign paths (first segment
 * must be the caller's own id) and duplicates are dropped; `attempted`
 * counts the raw entries so partial failures stay visible.
 */
function parseStagedImages(
  form: FormData,
  ownerId: string,
): { paths: StagedImageInput[]; attempted: number } {
  const raw = form.get("staged_images_json");
  if (typeof raw !== "string" || !raw.trim()) {
    return { paths: [], attempted: 0 };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { paths: [], attempted: 0 };
    const attempted = Math.min(parsed.length, MAX_PRODUCT_IMAGES);
    const seen = new Set<string>();
    const paths: StagedImageInput[] = [];
    for (const item of parsed.slice(0, MAX_PRODUCT_IMAGES)) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const path = typeof record.path === "string" ? record.path : "";
      const alt =
        typeof record.alt === "string" ? record.alt.slice(0, 300) : "";
      if (!isCatalogStoragePath(path)) continue;
      if (path.split("/")[0] !== ownerId) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      paths.push({ path, alt });
    }
    return { paths, attempted };
  } catch {
    return { paths: [], attempted: 0 };
  }
}

/**
 * Attach staged images at dense positions 0..n-1 via the media RPC.
 * Sequential on purpose: positions are explicit and the gallery must
 * keep the staged order. The position is the count attached so far,
 * NOT the staged index: if one attach fails, later images still land
 * on dense positions instead of leaving a gap that could wedge the
 * 20th slot (an append at position = count would collide with a
 * leftover gap position under the unique constraint). Returns the
 * number attached; unattached staged bytes stay orphaned in the
 * private bucket (same caveat as category images) and the caller
 * reports the shortfall.
 */
async function attachStagedImages(
  client: Awaited<ReturnType<typeof staffSession>>["client"],
  productId: string,
  staged: StagedImageInput[],
): Promise<number> {
  let attached = 0;
  for (const item of staged) {
    const result = await client.rpc("admin_add_product_media", {
      p_product_id: productId,
      p_storage_path: item.path,
      p_storage_object_id: null,
      p_alt_text: item.alt,
      p_position: attached,
    });
    if (!result.error && typeof result.data === "string") attached += 1;
  }
  return attached;
}

export async function setCatalogProductStatus(
  productId: string,
  status: "published" | "archived",
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  const parsed = statusChangeSchema.safeParse({ id: productId, status });
  if (!parsed.success) return actionError("Invalid product or status.");
  const revision = await readProductRevision(session.client, parsed.data.id);
  if (!revision) return actionError("Product not found. Reload and try again.");
  const result = await session.client.rpc("admin_set_product_status", {
    target_id: parsed.data.id,
    expected_updated_at: revision.updatedAt,
    new_status: parsed.data.status,
  });
  if (result.error) {
    return actionError(
      rpcErrorMessage(result.error, "Status could not be changed."),
    );
  }
  revalidatePath("/admin/catalog/products");
  revalidatePath(`/admin/catalog/products/${parsed.data.id}`);
  // Archiving a published product pauses its storefront visibility
  // (is_published stays set); reactivation resumes it. The list shows
  // the resulting visibility state.
  revalidateStorefront(revision.slug);
  return actionOk(
    status === "published"
      ? "Product set to Active."
      : "Product set to Inactive.",
  );
}

/**
 * Publish or unpublish a product (migration 008). Publish requires
 * the readiness gate (name, description, visible category, image,
 * active priced variant, stock) and refuses thrift-intake products;
 * the RPC's authored readiness message passes through. Unpublish
 * archives the product and revokes its public image access at once.
 * Neither action affects checkout eligibility (separate layer).
 */
export async function setCatalogProductPublication(
  productId: string,
  publish: boolean,
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  if (!z.uuid().safeParse(productId).success) {
    return actionError("Invalid product.");
  }
  const revision = await readProductRevision(session.client, productId);
  if (!revision) return actionError("Product not found. Reload and try again.");
  const result = publish
    ? await session.client.rpc("admin_publish_product", {
        target_id: productId,
        expected_updated_at: revision.updatedAt,
      })
    : await session.client.rpc("admin_unpublish_product", {
        target_id: productId,
        expected_updated_at: revision.updatedAt,
      });
  if (result.error) {
    if (rpcErrorCode(result.error) === "PT409") {
      return actionError(
        "This product changed. Reload before changing publication.",
      );
    }
    return actionError(
      rpcErrorMessage(
        result.error,
        publish
          ? "Product could not be published."
          : "Product could not be removed from the storefront.",
      ),
    );
  }
  revalidatePath("/admin/catalog/products");
  revalidatePath(`/admin/catalog/products/${productId}`);
  revalidatePath("/admin/catalog/inventory");
  revalidateStorefront(revision.slug);
  return actionOk(
    publish
      ? "Product published to the storefront."
      : "Product removed from the storefront.",
  );
}

export async function bulkSetCatalogProductStatus(
  productIds: string[],
  status: "published" | "archived",
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  const ids = z.array(z.uuid()).max(100).safeParse(productIds);
  if (!ids.success || ids.data.length === 0) {
    return actionError("Select at least one product.");
  }
  if (status !== "published" && status !== "archived") {
    return actionError("Invalid status.");
  }
  let succeeded = 0;
  let lastError = "";
  for (const id of ids.data) {
    const revision = await readProductRevision(session.client, id);
    if (!revision) {
      lastError = "A selected product could not be found.";
      continue;
    }
    const result = await session.client.rpc("admin_set_product_status", {
      target_id: id,
      expected_updated_at: revision.updatedAt,
      new_status: status,
    });
    if (result.error) {
      lastError = rpcErrorMessage(result.error, "Status could not be changed.");
    } else {
      succeeded += 1;
    }
  }
  revalidatePath("/admin/catalog/products");
  revalidatePath("/admin/catalog/inventory");
  revalidateStorefront();
  const label = status === "published" ? "Active" : "Inactive";
  if (succeeded === ids.data.length) {
    return actionOk(`${succeeded} product(s) set to ${label}.`);
  }
  if (succeeded === 0) {
    return actionError(lastError || "No products were updated.");
  }
  return actionError(
    `${succeeded} of ${ids.data.length} product(s) set to ${label}. ${lastError}`,
  );
}

export type DuplicateResult = AdminActionResult & { productId?: string };

export async function duplicateCatalogProduct(
  productId: string,
): Promise<DuplicateResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  if (!z.uuid().safeParse(productId).success) {
    return actionError("Invalid product.");
  }
  const result = await session.client.rpc("admin_duplicate_product", {
    target_id: productId,
  });
  if (result.error || typeof result.data !== "string") {
    return actionError(
      rpcErrorMessage(result.error, "Product could not be duplicated."),
    );
  }
  revalidatePath("/admin/catalog/products");
  revalidatePath("/admin/catalog/inventory");
  revalidateStorefront();
  return {
    ok: true,
    message:
      "Product duplicated as Inactive, with no stock and no images. Set stock in Inventory and add images on the copy.",
    productId: result.data,
  };
}

export async function deleteCatalogProduct(
  productId: string,
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  if (!z.uuid().safeParse(productId).success) {
    return actionError("Invalid product.");
  }
  const result = await session.client.rpc("admin_delete_product", {
    target_id: productId,
  });
  if (result.error) {
    return actionError(
      rpcErrorMessage(result.error, "Product could not be deleted."),
    );
  }
  revalidatePath("/admin/catalog/products");
  revalidatePath("/admin/catalog/inventory");
  revalidateStorefront();
  return actionOk("Product deleted.");
}

export async function bulkDeleteCatalogProducts(
  productIds: string[],
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  const ids = z.array(z.uuid()).max(100).safeParse(productIds);
  if (!ids.success || ids.data.length === 0) {
    return actionError("Select at least one product.");
  }
  let succeeded = 0;
  let lastError = "";
  for (const id of ids.data) {
    const result = await session.client.rpc("admin_delete_product", {
      target_id: id,
    });
    if (result.error) {
      lastError = rpcErrorMessage(result.error, "Product could not be deleted.");
    } else {
      succeeded += 1;
    }
  }
  revalidatePath("/admin/catalog/products");
  revalidatePath("/admin/catalog/inventory");
  revalidateStorefront();
  if (succeeded === ids.data.length) {
    return actionOk(`${succeeded} product(s) deleted.`);
  }
  if (succeeded === 0) {
    return actionError(lastError || "No products were deleted.");
  }
  return actionError(
    `${succeeded} of ${ids.data.length} product(s) deleted. ${lastError}`,
  );
}
