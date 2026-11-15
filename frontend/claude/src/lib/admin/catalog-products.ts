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
 * RPCs reject it. Saving here makes the product Active in the admin panel;
 * display on the public storefront follows the existing publication review
 * and its allowlist (see src/services/adapters/published-thrift.ts, which
 * this module must NOT touch) — new products do not appear on the
 * storefront automatically.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { staffSession } from "./access";
import {
  actionError,
  actionOk,
  requireStaff,
  type AdminActionResult,
} from "./authorization";
import {
  areaRoles,
  PRODUCT_BADGES,
  productDisplayStatus,
  type ProductDisplayStatus,
} from "./constants";
import { parseMoneyToMinor, slugify } from "./format";
import {
  aggregateVariantStock,
  classifyStock,
  isValidSlug,
  parseTagsInput,
  validateVariantList,
  variantInputSchema,
  type CatalogListFilters,
  type StockFilter,
  type VariantInput,
} from "./catalog-variants";

/** Upper bound on rows scanned for one list request (stock/price filters
 *  run in memory over embedded aggregates PostgREST cannot filter by). */
const LIST_FETCH_CAP = 500;

// ------------------------------------------------------------------ helpers

/** PostgREST one-to-one embeds arrive as an object; tolerate an array too. */
function toOne<T extends z.ZodType>(schema: T) {
  return z
    .union([schema, z.array(schema).max(1)])
    .nullable()
    .optional()
    .transform(
      (v) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as z.infer<T> | null,
    );
}

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

// --------------------------------------------------------------------- reads

const listVariantSchema = z.object({
  id: z.uuid(),
  price_minor: z.number().int().nonnegative(),
  sale_price_minor: z.number().int().nonnegative().nullable(),
  active: z.boolean(),
  inventory: toOne(
    z.object({
      on_hand: z.number().int().nonnegative(),
      reserved: z.number().int().nonnegative(),
      available: z.number().int().nonnegative(),
      low_stock_threshold: z.number().int().nonnegative(),
    }),
  ),
});

const listRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  category_id: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  categories: toOne(z.object({ name: z.string() })),
  product_variants: z.array(listVariantSchema),
  product_media: z
    .array(
      z.object({
        storage_path: z.string(),
        alt_text: z.string(),
        position: z.number().int(),
      }),
    )
    .optional(),
});

export interface CatalogListItem {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "published" | "archived";
  displayStatus: ProductDisplayStatus;
  categoryName: string | null;
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
}

export async function listCatalogProducts(
  filters: CatalogListFilters,
): Promise<CatalogListResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  const canManage = session.roles.some(
    (r) => r === "owner" || r === "product_manager",
  );
  let query = session.client
    .from("products")
    .select(
      "id,name,slug,description,status,category_id,created_at,updated_at," +
        "categories(name)," +
        "product_variants(id,price_minor,sale_price_minor,active,inventory(on_hand,reserved,available,low_stock_threshold))," +
        "product_media(storage_path,alt_text,position)",
      { count: "exact" },
    )
    .limit(100, { referencedTable: "product_variants" })
    .order("position", { referencedTable: "product_media" })
    .limit(1, { referencedTable: "product_media" });
  if (filters.q) {
    const pattern = escapeLike(filters.q);
    query = query.or(`name.ilike.${pattern},slug.ilike.${pattern}`);
  }
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  const result = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(LIST_FETCH_CAP);
  if (result.error) {
    throw new Error("Product list could not be read. No changes were made.");
  }
  const rows = z.array(listRowSchema).parse(result.data ?? []);
  const truncated = (result.count ?? 0) > LIST_FETCH_CAP;

  const enriched = rows.map((row) => {
    const aggregate = aggregateVariantStock(row.product_variants);
    return {
      row,
      aggregate,
      stockFilter: classifyStock(aggregate),
      displayStatus: productDisplayStatus(
        row.status,
        aggregate.available > 0,
      ),
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
    pageRows.map(async ({ row, aggregate, stockFilter, displayStatus }) => {
      const media = row.product_media?.[0];
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
        categoryName: row.categories?.name ?? null,
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
    }),
  );
  return { items, total, totalPages, page, truncated, canManage };
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

/** Flat category list for product-form selects (parents + children). */
export async function readCategoryOptions(): Promise<CategoryOption[]> {
  const session = await staffSession();
  const result = await session.client
    .from("categories")
    .select("id,name,slug,parent_id,published,sort_position")
    .order("sort_position", { ascending: true })
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(500);
  if (result.error) {
    // sort_position arrives with migration 002; fall back to a name-ordered
    // list so the form still renders on a pre-migration database.
    const fallback = await session.client
      .from("categories")
      .select("id,name,slug,parent_id,published")
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .limit(500);
    if (fallback.error) {
      throw new Error("Categories could not be read.");
    }
    return z
      .array(
        categoryOptionSchema.omit({ sort_position: true }).extend({
          sort_position: z.number().int().default(0),
        }),
      )
      .parse(
        (fallback.data ?? []).map((row) => ({ ...row, sort_position: 0 })),
      );
  }
  return z.array(categoryOptionSchema).parse(result.data ?? []);
}

const productDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  category_id: z.uuid().nullable(),
  brand: z.string().nullable(),
  highlights: z.array(z.string()),
  tags: z.array(z.string()),
  badges: z.array(z.string()),
  seo_title: z.string().nullable(),
  seo_description: z.string().nullable(),
  meta_keywords: z.string().nullable(),
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
  variants: Array<
    Omit<z.infer<typeof detailVariantSchema>, "cost_price_minor"> & {
      cost_price_minor: number | null;
      inventory: z.infer<typeof detailInventorySchema> | null;
    }
  >;
  canManage: boolean;
}

export async function readCatalogProduct(
  id: string,
): Promise<CatalogProductDetail | null> {
  const session = await staffSession();
  if (!z.uuid().safeParse(id).success) return null;
  const product = await session.client
    .from("products")
    .select(
      "id,name,slug,description,status,category_id,brand,highlights,tags,badges," +
        "seo_title,seo_description,meta_keywords,created_at,updated_at,categories(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (product.error) {
    throw new Error(
      "Product details could not be read. If this persists, check that catalogue migration 20261115000200 has been applied.",
    );
  }
  if (!product.data) return null;
  const parsed = productDetailSchema
    .extend({ categories: toOne(z.object({ name: z.string() })) })
    .parse(product.data);
  const { categories, ...base } = parsed;
  const variants = await session.client
    .from("product_variants")
    .select(
      "id,size,color,price_minor,sale_price_minor,cost_price_minor,active,created_at",
    )
    .eq("product_id", id)
    .order("created_at", { ascending: true })
    .limit(101);
  if (variants.error) throw new Error("Product variants could not be read.");
  const variantRows = z.array(detailVariantSchema).parse(variants.data ?? []);
  const inventory = variantRows.length
    ? await session.client
        .from("inventory")
        .select("variant_id,on_hand,reserved,available,low_stock_threshold")
        .in(
          "variant_id",
          variantRows.map((v) => v.id),
        )
    : null;
  if (inventory?.error) throw new Error("Product inventory could not be read.");
  const inventoryByVariant = new Map(
    z
      .array(detailInventorySchema)
      .parse(inventory?.data ?? [])
      .map((row) => [row.variant_id, row]),
  );
  return {
    product: base,
    categoryName: categories?.name ?? null,
    variants: variantRows.map((v) => ({
      ...v,
      cost_price_minor: v.cost_price_minor ?? null,
      inventory: inventoryByVariant.get(v.id) ?? null,
    })),
    canManage: session.roles.some(
      (r) => r === "owner" || r === "product_manager",
    ),
  };
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
  brand: z.string().trim().max(120).nullable(),
  highlights: z.array(z.string().trim().min(1).max(200)).max(20),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  badges: z.array(z.enum(PRODUCT_BADGES)).max(5),
  seo_title: z.string().trim().max(160).nullable(),
  seo_description: z.string().trim().max(320).nullable(),
  meta_keywords: z.string().trim().max(500).nullable(),
  base_price_minor: z.number().int().min(0),
  base_sale_price_minor: z.number().int().min(0).nullable(),
  base_cost_price_minor: z.number().int().min(0).nullable(),
  base_stock: z.number().int().min(0),
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
    brand: text("brand").trim() === "" ? null : text("brand").trim(),
    highlights,
    tags: parseTagsInput(text("tags")),
    badges,
    seo_title: text("seo_title").trim() === "" ? null : text("seo_title").trim(),
    seo_description:
      text("seo_description").trim() === "" ? null : text("seo_description").trim(),
    meta_keywords:
      text("meta_keywords").trim() === "" ? null : text("meta_keywords").trim(),
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
  const result = await session.client.rpc("admin_create_product", {
    p: toRpcPayload(data, false),
  });
  if (result.error || typeof result.data !== "string") {
    return rpcFailureState(result.error, "Product could not be created.");
  }
  revalidatePath("/admin/catalog/products");
  revalidatePath("/admin/catalog/inventory");
  redirect(`/admin/catalog/products/${result.data}?saved=created`);
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
  const result = await session.client.rpc("admin_update_product", {
    target_id: id,
    expected_updated_at: expectedUpdatedAt,
    p: toRpcPayload(data, true),
  });
  if (result.error) {
    return rpcFailureState(result.error, "Product could not be saved.");
  }
  revalidatePath("/admin/catalog/products");
  revalidatePath(`/admin/catalog/products/${id}`);
  revalidatePath("/admin/catalog/inventory");
  redirect(`/admin/catalog/products/${id}?saved=updated`);
}

const statusChangeSchema = z.object({
  id: z.uuid(),
  status: z.enum(["published", "archived"]),
});

async function readExpectedUpdatedAt(
  client: Awaited<ReturnType<typeof staffSession>>["client"],
  id: string,
): Promise<string | null> {
  const row = await client
    .from("products")
    .select("updated_at")
    .eq("id", id)
    .maybeSingle();
  if (row.error || !row.data) return null;
  const parsed = z.object({ updated_at: z.string() }).safeParse(row.data);
  return parsed.success ? parsed.data.updated_at : null;
}

export async function setCatalogProductStatus(
  productId: string,
  status: "published" | "archived",
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  const parsed = statusChangeSchema.safeParse({ id: productId, status });
  if (!parsed.success) return actionError("Invalid product or status.");
  const expected = await readExpectedUpdatedAt(session.client, parsed.data.id);
  if (!expected) return actionError("Product not found. Reload and try again.");
  const result = await session.client.rpc("admin_set_product_status", {
    target_id: parsed.data.id,
    expected_updated_at: expected,
    new_status: parsed.data.status,
  });
  if (result.error) {
    return actionError(
      rpcErrorMessage(result.error, "Status could not be changed."),
    );
  }
  revalidatePath("/admin/catalog/products");
  revalidatePath(`/admin/catalog/products/${parsed.data.id}`);
  return actionOk(
    status === "published"
      ? "Product set to Active."
      : "Product set to Inactive.",
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
    const expected = await readExpectedUpdatedAt(session.client, id);
    if (!expected) {
      lastError = "A selected product could not be found.";
      continue;
    }
    const result = await session.client.rpc("admin_set_product_status", {
      target_id: id,
      expected_updated_at: expected,
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
