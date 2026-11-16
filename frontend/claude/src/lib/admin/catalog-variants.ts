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
}, options: { maxBytes?: number } = {}): string | null {
  if (!isAcceptedImageType(file.type)) {
    return "Only JPEG, PNG and WebP images are accepted.";
  }
  if (file.size <= 0) return "That file is empty.";
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return `Each image must be ${maxBytes / (1024 * 1024)} MB or smaller.`;
  }
  return null;
}

/**
 * Largest original a client-side compressor may accept. The compressed
 * output is still validated against MAX_IMAGE_BYTES before upload, and
 * the server re-validates the bytes it receives.
 */
export const MAX_COMPRESSIBLE_IMAGE_BYTES = 20 * 1024 * 1024;

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
 *
 * Cycle- and orphan-safe: a category whose parent is missing, is itself,
 * or sits in (or below) a parent cycle becomes a root, so every category
 * renders exactly once and the children graph can never contain a cycle
 * (a cyclic children graph would recurse forever in the list render).
 * Depth is derived from the effective parent chain, independent of the
 * input order. Duplicate ids keep the first row only.
 */
export function buildCategoryTree<T extends CategoryFlat>(
  flat: readonly T[],
): CategoryNode<T>[] {
  const byId = new Map<string, CategoryNode<T>>();
  const ordered: CategoryNode<T>[] = [];
  for (const c of flat) {
    if (byId.has(c.id)) continue;
    const node: CategoryNode<T> = { ...c, children: [], depth: 1 };
    byId.set(c.id, node);
    ordered.push(node);
  }
  // Effective parent per node: null for roots, dangling parents,
  // self-parents, and any node whose raw parent chain revisits a node
  // (in a cycle, or below one — attaching it could re-enter the cycle).
  const effectiveParent = new Map<string, string | null>();
  for (const node of ordered) {
    const parentId = node.parent_id;
    if (parentId === null || parentId === node.id || !byId.has(parentId)) {
      effectiveParent.set(node.id, null);
      continue;
    }
    const seen = new Set<string>([node.id]);
    let current: string | null = parentId;
    let cyclic = false;
    while (current !== null) {
      if (seen.has(current)) {
        cyclic = true;
        break;
      }
      seen.add(current);
      current = byId.get(current)?.parent_id ?? null;
    }
    effectiveParent.set(node.id, cyclic ? null : parentId);
  }
  const roots: CategoryNode<T>[] = [];
  for (const node of ordered) {
    const parentId = effectiveParent.get(node.id) ?? null;
    if (parentId === null) {
      roots.push(node);
      continue;
    }
    byId.get(parentId)?.children.push(node);
  }
  // Depth from the effective chain (acyclic by construction; the visited
  // guard keeps this total even if the input is pathological).
  for (const node of ordered) {
    let depth = 1;
    const seen = new Set<string>([node.id]);
    let current = effectiveParent.get(node.id) ?? null;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      depth += 1;
      current = effectiveParent.get(current) ?? null;
    }
    node.depth = depth;
  }
  return roots;
}

/** A flattened tree entry offered as a parent choice in the category form. */
export interface CategoryParentOption {
  id: string;
  label: string;
  /** Tree depth: 1 = primary, 2 = secondary, 3 = sub-category. */
  depth: number;
}

/**
 * Flatten a category tree to labelled parent options, skipping excluded ids.
 *
 * This lives in the shared (server-safe) module on purpose: the categories
 * page is a Server Component and calls it during render. It MUST NOT move
 * back into a "use client" module — calling a client-module function from
 * server code throws at runtime and crashes the whole page.
 */
export function flattenCategoryOptions<T extends CategoryFlat>(
  nodes: readonly CategoryNode<T>[],
  exclude: ReadonlySet<string>,
): CategoryParentOption[] {
  const options: CategoryParentOption[] = [];
  // The builder guarantees an acyclic tree; the visited guard keeps this
  // walk total even if a cyclic tree ever arrives (no infinite recursion).
  const visited = new Set<string>();
  const walk = (list: readonly CategoryNode<T>[]) => {
    for (const node of list) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      if (!exclude.has(node.id)) {
        options.push({
          id: node.id,
          label: `${"— ".repeat(node.depth - 1)}${node.name}`,
          depth: node.depth,
        });
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return options;
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

// ------------------------------------------------------- category hierarchy
//
// Admin Panel v2 maps the owner's two-level vocabulary onto the existing
// depth-≤3 hierarchy (migration 20261115000200, admin_save_category):
//   Primary category   = depth 1 (parent_id is null)
//   Secondary category = depth 2 (parent is a primary category)
//   Sub-category       = depth 3 (legacy; the UI never creates new ones,
//                        but existing depth-3 rows keep working)
// Level is DERIVED from the parent chain, never stored: a stored level
// column could drift from parent_id, while the chain is the truth the
// database already enforces (cycle rejection + max depth 3).

/**
 * Depth of a category in the flat list (root = 1). Returns null when the
 * id is unknown or the parent chain contains a cycle. Orphaned rows
 * (parent missing from the list) count the visible chain only.
 */
/**
 * Minimal shape the hierarchy helpers need: an id plus its parent link.
 * CategoryFlat satisfies this, and so do the flat option lists used by
 * the product/category forms — the helpers never read other fields.
 */
export interface CategoryHierarchyNode {
  id: string;
  parent_id: string | null;
}

export function categoryLevel(
  flat: readonly CategoryHierarchyNode[],
  categoryId: string,
): number | null {
  const byId = new Map(flat.map((c) => [c.id, c]));
  if (!byId.has(categoryId)) return null;
  const visited = new Set<string>();
  let depth = 0;
  let current: string | null = categoryId;
  while (current !== null) {
    if (visited.has(current)) return null;
    visited.add(current);
    depth += 1;
    if (depth > 10) return null;
    const row = byId.get(current);
    current = row?.parent_id ?? null;
  }
  return depth;
}

/** Owner-facing level name for a depth (depths beyond 3 read as sub-category). */
export function categoryLevelName(depth: number): string {
  if (depth <= 1) return "Primary category";
  if (depth === 2) return "Secondary category";
  return "Sub-category";
}

/** Depth-1 categories, in list order. */
export function primaryCategories<T extends CategoryHierarchyNode>(
  flat: readonly T[],
): T[] {
  return flat.filter((c) => c.parent_id === null);
}

/** Depth-2 categories whose parent is `primaryId`, in list order. */
export function secondaryCategoriesFor<T extends CategoryHierarchyNode>(
  flat: readonly T[],
  primaryId: string,
): T[] {
  return flat.filter((c) => c.parent_id === primaryId);
}

/**
 * Validate a product's primary + secondary assignment. A secondary
 * category REQUIRES a primary, must belong to that primary, and must be
 * a second-level category. Returns an error message or null.
 */
export function validateCategoryAssignment(
  primaryId: string | null,
  secondaryId: string | null,
  flat: readonly CategoryHierarchyNode[],
): string | null {
  if (secondaryId === null) return null;
  if (primaryId === null) {
    return "Choose a primary category before choosing a secondary category.";
  }
  if (categoryLevel(flat, primaryId) !== 1) {
    return "The primary category must be a top-level category.";
  }
  const byId = new Map(flat.map((c) => [c.id, c]));
  const secondary = byId.get(secondaryId);
  if (!secondary) {
    return "The chosen secondary category no longer exists. Reload and choose again.";
  }
  if (secondary.parent_id !== primaryId) {
    return "The secondary category must belong to the chosen primary category.";
  }
  // Unreachable for consistent lists (a child of a primary is depth 2 by
  // construction); kept as a guard for inconsistent/partial lists.
  if (categoryLevel(flat, secondaryId) !== 2) {
    return "The chosen secondary category must be a second-level category.";
  }
  return null;
}

export type CategoryLevelChoice = "primary" | "secondary" | "sub";

/**
 * Derive the primary + secondary pair a product form should show for a
 * stored assignment. The pair model (migration 009) has no slot for a
 * third-level category, so a depth-3 assignment is represented by its
 * top two chain links and the replaced id is reported for a warning.
 * A depth-2 category_id survives as the secondary (its parent becomes
 * the primary), so legacy leaf assignments are preserved through the
 * pair. Inconsistent stored pairs are repaired, reporting the dropped
 * id. Never returns a secondary without a primary.
 */
export interface DerivedCategoryPair {
  primaryId: string | null;
  secondaryId: string | null;
  /** Id of a stored assignment the pair cannot represent, if any. */
  replacedId: string | null;
}

export function deriveCategoryPair(
  flat: readonly CategoryHierarchyNode[],
  categoryId: string | null,
  secondaryId: string | null,
): DerivedCategoryPair {
  if (categoryId === null) {
    return { primaryId: null, secondaryId: null, replacedId: secondaryId };
  }
  const byId = new Map(flat.map((c) => [c.id, c]));
  const depth = categoryLevel(flat, categoryId);
  if (depth === null) {
    return { primaryId: null, secondaryId: null, replacedId: categoryId };
  }
  if (depth === 1) {
    const secondaryOk =
      secondaryId !== null && byId.get(secondaryId)?.parent_id === categoryId;
    return {
      primaryId: categoryId,
      secondaryId: secondaryOk ? secondaryId : null,
      replacedId:
        secondaryId !== null && !secondaryOk ? secondaryId : null,
    };
  }
  if (depth === 2) {
    const parent = byId.get(categoryId)?.parent_id ?? null;
    return {
      primaryId: parent,
      secondaryId: categoryId,
      replacedId:
        secondaryId !== null && secondaryId !== categoryId
          ? secondaryId
          : null,
    };
  }
  // Depth 3+: keep the top two chain links (root + depth-2 ancestor).
  const links: string[] = [];
  const visited = new Set<string>();
  let current: string | null = categoryId;
  while (current !== null && byId.has(current) && !visited.has(current)) {
    visited.add(current);
    links.push(current);
    current = byId.get(current)?.parent_id ?? null;
  }
  return {
    primaryId: links[links.length - 1] ?? null,
    secondaryId: links.length >= 2 ? (links[links.length - 2] ?? null) : null,
    replacedId: categoryId,
  };
}

/**
 * Validate the level a category form assigns against its chosen parent.
 * "sub" covers existing depth-3 rows being edited: they may move up (to a
 * primary parent, or to no parent) but never deeper. Returns an error
 * message or null. Self/descendant exclusion and the depth-3 database
 * rule are enforced separately (UI options + admin_save_category).
 */
export function validateCategoryLevelChoice(
  level: CategoryLevelChoice,
  parentId: string | null,
  flat: readonly CategoryHierarchyNode[],
): string | null {
  if (level === "primary") {
    if (parentId !== null) {
      return "A primary category has no parent category.";
    }
    return null;
  }
  if (level === "secondary") {
    if (parentId === null) {
      return "A secondary category needs a primary category as its parent.";
    }
    if (categoryLevel(flat, parentId) !== 1) {
      return "A secondary category's parent must be a primary category.";
    }
    return null;
  }
  // level === "sub": keep the row at depth ≤ 3; moving under a depth-2
  // parent keeps depth 3, moving under a primary (or none) promotes it.
  if (parentId === null) return null;
  const parentDepth = categoryLevel(flat, parentId);
  if (parentDepth === null) {
    return "The chosen parent category no longer exists.";
  }
  if (parentDepth > 2) {
    return "A sub-category cannot be moved under another sub-category.";
  }
  return null;
}

// ------------------------------------------------------- publication + costs

/** Storefront visibility derived from the two publication signals. */
export type PublicationVisibility = "visible" | "hidden" | "paused";

export function publicationVisibility(
  status: string,
  isPublished: boolean,
): PublicationVisibility {
  if (!isPublished) return "hidden";
  if (status === "published") return "visible";
  // Published, then set Inactive: the storefront feed requires BOTH
  // signals, so the product is hidden until it is Active again.
  return "paused";
}

export function publicationVisibilityLabel(
  visibility: PublicationVisibility,
): string {
  if (visibility === "visible") return "Published to storefront";
  if (visibility === "paused") return "Publication paused";
  return "Not published";
}

// ------------------------------------------------------------ storage paths

/**
 * Storage object paths in the product-media bucket are always
 * `<owner-uuid>/<object-uuid>.<ext>`. Shared by category images, staged
 * product images and the public-feed media check; a path that does not
 * match is never trusted as a storage reference.
 */
export const CATALOG_STORAGE_PATH_PATTERN =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function isCatalogStoragePath(path: string): boolean {
  return path.length <= 200 && CATALOG_STORAGE_PATH_PATTERN.test(path);
}

export interface SiblingOrderNode {
  id: string;
  parent_id: string | null;
  sort_position: number;
}

/**
 * Group categories into sibling groups for order normalization, each
 * group in current display order (sort_position, then id for
 * determinism). The root group comes first; other groups follow in
 * first-seen parent order. Passing one group to
 * admin_reorder_categories renumbers it 0..n-1, preserving order.
 */
export function siblingOrderGroups(
  nodes: readonly SiblingOrderNode[],
): string[][] {
  const groups = new Map<string | null, SiblingOrderNode[]>();
  for (const node of nodes) {
    const list = groups.get(node.parent_id) ?? [];
    list.push(node);
    groups.set(node.parent_id, list);
  }
  const ordered: string[][] = [];
  const pushGroup = (key: string | null) => {
    const list = groups.get(key);
    if (!list || list.length === 0) return;
    ordered.push(
      [...list]
        .sort(
          (a, b) =>
            a.sort_position - b.sort_position || a.id.localeCompare(b.id),
        )
        .map((node) => node.id),
    );
  };
  pushGroup(null);
  for (const key of groups.keys()) {
    if (key !== null) pushGroup(key);
  }
  return ordered;
}

/** True when a sibling group already reads 0..n-1 in display order. */
export function isNormalizedOrder(
  nodes: readonly SiblingOrderNode[],
  orderedIds: readonly string[],
): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return orderedIds.every(
    (id, index) => byId.get(id)?.sort_position === index,
  );
}
