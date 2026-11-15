/**
 * Pure catalogue rules shared by the catalog Server Actions, the client
 * editors and the vitest checks.
 *
 * This module intentionally imports NOTHING server-only (no "server-only",
 * no Supabase, no next/*): it must stay importable from client components
 * and from tests/catalog.check.ts. Server Actions live in
 * catalog-products.ts / catalog-categories.ts / catalog-inventory.ts /
 * catalog-media.ts and import the schemas and helpers from here.
 *
 * Rules mirrored from the database (see supabase/migrations):
 * - products.slug: ^[a-z0-9]+(-[a-z0-9]+)*$, unique.
 * - product_variants: size 1..40 (never N/A/NA/UNKNOWN), color 1..80,
 *   price 0..9007199254740991, sale <= price, cost >= 0, one row per
 *   (product, size, color), max 100 variants per product.
 * - Variant SKUs are server-generated internals: no SKU field exists
 *   anywhere in this module, and none may be added.
 * - inventory: on_hand >= 0, available = on_hand - reserved.
 * - product_media: position 0..19, max 20 images per product.
 */

import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PRODUCT_IMAGES,
  PRODUCT_BADGES,
} from "./constants";
import { parseMoneyToMinor, slugify } from "./format";

export const MAX_VARIANTS_PER_PRODUCT = 100;
export const MAX_SAFE_PRICE_MINOR = 9007199254740991;
/** Low-stock display threshold, matching the inventory default of 5. */
export const LOW_STOCK_THRESHOLD = 5;
/** Per-file upload limit for catalogue images (see catalog-media.ts for the
 *  Server Action body-size caveat: the framework default is 1 MiB unless
 *  the coordinator raises serverActions.bodySizeLimit). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

export function isAcceptedImageType(
  mime: string,
): mime is AcceptedImageType {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mime);
}

export function imageExtensionFor(mime: AcceptedImageType): "jpg" | "png" | "webp" {
  return mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
}

/** Magic-byte check: the declared MIME must match the actual bytes. */
export function validCatalogImageBytes(bytes: Uint8Array, mime: string): boolean {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return false;
  if (mime === "image/png") {
    return (
      bytes.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
    );
  }
  if (mime === "image/jpeg") {
    return (
      bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    );
  }
  if (mime === "image/webp") {
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  }
  return false;
}

/** Client/server file-meta check (type + size). Returns an error or null. */
export function validateImageFileMeta(file: {
  type: string;
  size: number;
  name?: string;
}): string | null {
  if (!isAcceptedImageType(file.type)) {
    return "Only JPEG, PNG and WebP images are accepted.";
  }
  if (file.size <= 0) return "That file is empty.";
  if (file.size > MAX_IMAGE_BYTES) {
    return "Each image must be 5 MB or smaller.";
  }
  return null;
}

/** How many more images a product may accept (0..20). */
export function remainingImageSlots(existingCount: number): number {
  return Math.max(0, MAX_PRODUCT_IMAGES - existingCount);
}

export function validateImageCount(
  existingCount: number,
  addingCount: number,
): string | null {
  if (existingCount + addingCount > MAX_PRODUCT_IMAGES) {
    return `A product may have at most ${MAX_PRODUCT_IMAGES} images.`;
  }
  return null;
}

// --------------------------------------------------------------------- slug

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return slug.length >= 1 && slug.length <= 160 && SLUG_PATTERN.test(slug);
}

/**
 * Suggest a free slug: the base itself when free, otherwise base-2, base-3,
 * ... Falls back to a "product" stem when the name slugifies to nothing.
 */
export function suggestUniqueSlug(
  nameOrSlug: string,
  existingSlugs: ReadonlySet<string> | readonly string[],
): string {
  const base = slugify(nameOrSlug) || "product";
  const taken =
    existingSlugs instanceof Set ? existingSlugs : new Set(existingSlugs);
  if (!taken.has(base)) return base;
  for (let n = 2; n <= 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ------------------------------------------------------------------ variants

export const variantInputSchema = z
  .object({
    id: z.uuid().optional(),
    size: z
      .string()
      .trim()
      .min(1, "Enter a size.")
      .max(40, "Size must be 40 characters or fewer.")
      .refine(
        (v) => !["N/A", "NA", "UNKNOWN"].includes(v.toUpperCase()),
        "Enter an actual size.",
      ),
    color: z
      .string()
      .trim()
      .min(1, "Enter a color.")
      .max(80, "Color must be 80 characters or fewer."),
    price_minor: z
      .number()
      .int()
      .min(0)
      .max(MAX_SAFE_PRICE_MINOR),
    sale_price_minor: z
      .number()
      .int()
      .min(0)
      .max(MAX_SAFE_PRICE_MINOR)
      .nullable(),
    cost_price_minor: z
      .number()
      .int()
      .min(0)
      .max(MAX_SAFE_PRICE_MINOR)
      .nullable(),
    /** Initial stock; honoured for NEW variants only. Existing-variant
     *  stock moves only via adjust_inventory. */
    stock: z.number().int().min(0).max(999_999_999),
    active: z.boolean(),
  })
  .refine(
    (v) => v.sale_price_minor === null || v.sale_price_minor <= v.price_minor,
    "Sale price cannot exceed the regular price.",
  )
  .refine(
    (v) => !v.active || v.price_minor > 0,
    "An active variant needs a price above ৳0.00.",
  );

export type VariantInput = z.infer<typeof variantInputSchema>;

/** Duplicate (size, color) pairs and the 100-variant cap, checked early. */
export function validateVariantList(
  variants: readonly VariantInput[],
): string | null {
  if (variants.length > MAX_VARIANTS_PER_PRODUCT) {
    return `A product may have at most ${MAX_VARIANTS_PER_PRODUCT} variants.`;
  }
  const seen = new Set<string>();
  for (const v of variants) {
    const key = v.size + "\u001f" + v.color;
    if (seen.has(key)) {
      return `Duplicate variant: size "${v.size}" with color "${v.color}" appears more than once.`;
    }
    seen.add(key);
  }
  return null;
}

/** Field-level price errors for one variant (used by the editor hints). */
export function variantPriceErrors(variant: {
  price_minor: number;
  sale_price_minor: number | null;
  cost_price_minor: number | null;
  active: boolean;
}): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(variant.price_minor) || variant.price_minor < 0) {
    errors.push("Regular price must be a whole number of paisa (0 or more).");
  }
  if (
    variant.sale_price_minor !== null &&
    variant.sale_price_minor > variant.price_minor
  ) {
    errors.push("Sale price cannot exceed the regular price.");
  }
  if (variant.cost_price_minor !== null && variant.cost_price_minor < 0) {
    errors.push("Cost price cannot be negative.");
  }
  if (variant.active && variant.price_minor <= 0) {
    errors.push("An active variant needs a price above ৳0.00.");
  }
  return errors;
}

// -------------------------------------------------------------------- stock

export interface VariantStockRow {
  price_minor: number;
  sale_price_minor: number | null;
  active: boolean;
  inventory: {
    on_hand: number;
    reserved: number;
    available: number;
    low_stock_threshold: number;
  } | null;
}

export interface StockAggregate {
  onHand: number;
  reserved: number;
  available: number;
  /** Lowest effective (sale ?? regular) price across variants, if any. */
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  variantCount: number;
  /** True when at least one variant is at or below its own threshold. */
  hasLowVariant: boolean;
  /** True when inventory data was missing for a variant (totals partial). */
  partial: boolean;
}

export function aggregateVariantStock(
  variants: readonly VariantStockRow[],
): StockAggregate {
  let onHand = 0;
  let reserved = 0;
  let available = 0;
  let partial = false;
  let hasLowVariant = false;
  const prices: number[] = [];
  for (const v of variants) {
    prices.push(v.sale_price_minor ?? v.price_minor);
    if (v.inventory === null) {
      partial = true;
      continue;
    }
    onHand += v.inventory.on_hand;
    reserved += v.inventory.reserved;
    available += v.inventory.available;
    if (
      v.inventory.available > 0 &&
      v.inventory.available <= v.inventory.low_stock_threshold
    ) {
      hasLowVariant = true;
    }
  }
  return {
    onHand,
    reserved,
    available,
    minPriceMinor: prices.length ? Math.min(...prices) : null,
    maxPriceMinor: prices.length ? Math.max(...prices) : null,
    variantCount: variants.length,
    hasLowVariant,
    partial,
  };
}

export type StockFilter = "in-stock" | "low-stock" | "out-of-stock";

/**
 * Display classification for list filtering. "low-stock" means some stock
 * remains but the total is at or below the default threshold (5), or any
 * variant is at/below its own threshold.
 */
export function classifyStock(aggregate: StockAggregate): StockFilter {
  if (aggregate.available <= 0) return "out-of-stock";
  if (aggregate.available <= LOW_STOCK_THRESHOLD || aggregate.hasLowVariant) {
    return "low-stock";
  }
  return "in-stock";
}

// ------------------------------------------------------------------ reorder

/** A reorder list must contain every existing id exactly once. */
export function validateReorderOrder(
  orderedIds: readonly string[],
  existingIds: readonly string[],
): string | null {
  if (orderedIds.length !== existingIds.length) {
    return "The new order must contain every item exactly once.";
  }
  const seen = new Set(orderedIds);
  if (seen.size !== orderedIds.length) {
    return "The new order contains a duplicate item.";
  }
  for (const id of orderedIds) {
    if (!existingIds.includes(id)) {
      return "The new order contains an unknown item.";
    }
  }
  return null;
}

/** Move one element within an id list; returns a new list (or the input). */
export function moveIdInOrder(
  orderedIds: readonly string[],
  id: string,
  delta: -1 | 1,
): string[] {
  const index = orderedIds.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= orderedIds.length) {
    return [...orderedIds];
  }
  const next = [...orderedIds];
  const current = next[index];
  const other = next[target];
  if (current === undefined || other === undefined) return next;
  next[index] = other;
  next[target] = current;
  return next;
}

// --------------------------------------------------------------- categories

export interface CategoryFlat {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  published: boolean;
  description: string;
  image_storage_path: string | null;
  banner_storage_path: string | null;
  seo_title: string | null;
  seo_description: string | null;
  sort_position: number;
  updated_at: string;
}

export type CategoryNode<T extends CategoryFlat = CategoryFlat> = T & {
  children: CategoryNode<T>[];
  depth: number;
};

/**
 * Build a depth-annotated tree from a flat, sort-ordered category list.
 * Generic so callers keep extra fields (e.g. signed image URLs) on nodes.
 */
export function buildCategoryTree<T extends CategoryFlat>(
  flat: readonly T[],
): CategoryNode<T>[] {
  const byId = new Map<string, CategoryNode<T>>();
  for (const c of flat) {
    byId.set(c.id, { ...c, children: [], depth: 1 });
  }
  const roots: CategoryNode<T>[] = [];
  for (const c of flat) {
    const node = byId.get(c.id);
    if (!node) continue;
    if (c.parent_id === null) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(c.parent_id);
    if (!parent || parent === node) {
      roots.push(node);
      continue;
    }
    node.depth = parent.depth + 1;
    parent.children.push(node);
  }
  return roots;
}

/** All descendant ids of a category (for parent-eligibility checks). */
export function collectDescendantIds(
  flat: readonly CategoryFlat[],
  rootId: string,
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const c of flat) {
    if (c.parent_id === null) continue;
    const list = childrenByParent.get(c.parent_id) ?? [];
    list.push(c.id);
    childrenByParent.set(c.parent_id, list);
  }
  const found = new Set<string>();
  const queue = [...(childrenByParent.get(rootId) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || found.has(next)) continue;
    found.add(next);
    queue.push(...(childrenByParent.get(next) ?? []));
  }
  return found;
}

/** Categories that may parent `categoryId` (excludes self + descendants). */
export function eligibleParents(
  flat: readonly CategoryFlat[],
  categoryId: string | null,
): CategoryFlat[] {
  if (categoryId === null) return [...flat];
  const excluded = collectDescendantIds(flat, categoryId);
  excluded.add(categoryId);
  return flat.filter((c) => !excluded.has(c.id));
}

// ------------------------------------------------------------------ products

export interface CatalogListFilters {
  q: string;
  categoryId: string;
  stock: "" | StockFilter;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  sort: "newest" | "name" | "price" | "stock";
  page: number;
  pageSize: number;
}

/** Parse the product-list query string (lives here, not in the "use server"
 *  module, because that module may only export async functions). */
export function parseCatalogListFilters(
  params: Record<string, string | string[] | undefined>,
): CatalogListFilters {
  const text = (key: string): string =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const stock = text("stock");
  const sort = text("sort");
  const page = Number.parseInt(text("page"), 10);
  // PostgREST .or() splits its argument on commas and parens, so those
  // characters cannot appear in the search pattern; treat them as spaces.
  const q = text("q").trim().slice(0, 120).replace(/[,()]/g, " ");
  return {
    q: q.replace(/\s+/g, " ").trim(),
    categoryId: text("category"),
    stock:
      stock === "in-stock" || stock === "low-stock" || stock === "out-of-stock"
        ? stock
        : "",
    minPriceMinor: parseMoneyToMinor(text("min_price")),
    maxPriceMinor: parseMoneyToMinor(text("max_price")),
    sort:
      sort === "name" || sort === "price" || sort === "stock" ? sort : "newest",
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

export const productBadgeSchema = z.enum(PRODUCT_BADGES);

export const productStatusInputSchema = z.enum(["published", "archived"]);

/** Parse a comma-separated tags input into a clean, de-duplicated list. */
export function parseTagsInput(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.split(",")) {
    const tag = raw.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag.slice(0, 40));
  }
  return tags.slice(0, 20);
}
