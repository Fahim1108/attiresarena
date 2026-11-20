import type { Category } from "@/types";

/**
 * Category hierarchy — owner decision 2026-11-20 (voice, supersedes the
 * old delete/reassign plan). No product and no category is deleted.
 *
 * Shirts is the MAIN (parent) category. Casual shirt, Formal shirt and
 * Check shirt are its sub-categories. The database rows for the three
 * sub-categories still carry parent_id NULL today (and there is no
 * Shirts row in the admin categories table at all — Shirts is static
 * config), so the storefront maps them to Shirts by slug/name here
 * until the rows are given a real parent in the admin UI. A real
 * parent_id in the DB always wins over this mapping (see
 * mergeDbCategories in lib/store-settings.ts).
 *
 * Matching is by slug first, with the display name as a fallback, so a
 * renamed slug does not silently drop a sub-category.
 */
export const SHIRT_PARENT_SLUG = "shirts";
export const SHIRT_PARENT_ID = "cat-shirts";

export const SHIRT_SUBCATEGORY_SLUGS = [
  "casual-shirt",
  "formal-shirt",
  "check-shirt",
] as const;

const SHIRT_SUBCATEGORY_NAMES = new Set([
  "casual shirt",
  "formal shirt",
  "check shirt",
]);

/**
 * Canonical shirt-type key for a category, or null when it is not a
 * shirt sub-category. Slug is tried first, display name second.
 *
 * Normalization matters because the STAGING rows are messy (verified
 * 2026-11-20 via published_categories()): besides the three proper
 * rows there is a "Formal shirts" duplicate (slug formal-shirts, id
 * 22566784-0723-4cef-8e1e-7007084306d9 — the TEST Shirt's category)
 * and a "Casual shirt" row whose slug is the garbage
 * "staging-category-f7a3f419-…" (id f7a3f419-…, the lifecycle
 * shirt's category). Without normalization those two products match
 * NO sub-category: their chips stay (0), their sub-pages stay empty,
 * and "Formal shirts" would even leak out as a top-level tile. The
 * normalization only collapses a plural "shirts" to "shirt" and
 * hyphens/spacing — it never touches non-shirt categories.
 */
export type ShirtSubKey = "casual" | "formal" | "check";

export function shirtSubKey(category: {
  slug: string;
  name: string;
}): ShirtSubKey | null {
  for (const value of [category.slug, category.name]) {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/\bshirts\b/g, "shirt")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized === "casual shirt") return "casual";
    if (normalized === "formal shirt") return "formal";
    if (normalized === "check shirt") return "check";
  }
  return null;
}

export function isShirtSubcategory(category: {
  slug: string;
  name: string;
}): boolean {
  return (
    (SHIRT_SUBCATEGORY_SLUGS as readonly string[]).includes(
      category.slug.trim().toLowerCase(),
    ) || SHIRT_SUBCATEGORY_NAMES.has(category.name.trim().toLowerCase())
    || shirtSubKey(category) !== null
  );
}

/** The three shirt types, in list order — shown inside Shirts. */
export function shirtSubcategories(
  categories: readonly Category[],
): Category[] {
  return categories.filter(isShirtSubcategory);
}

/** Everything except the shirt sub-categories — the top-level browse list. */
export function topLevelCategories(
  categories: readonly Category[],
): Category[] {
  return categories.filter((c) => !isShirtSubcategory(c));
}
