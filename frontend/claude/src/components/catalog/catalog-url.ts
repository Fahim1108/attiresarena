import { toSearchParams } from "@/lib/catalog-query";
import type { ProductQueryInput } from "@/services";

export type CatalogLocked = { category?: string; brand?: string };

export type CatalogPatch = Partial<ProductQueryInput> | ((current: ProductQueryInput) => Partial<ProductQueryInput>);

/**
 * Merges a filter/sort/page patch onto the latest intended query. A patch that
 * is not an explicit page change resets to page 1: filter and sort changes
 * invalidate the current page. Functional patches read the latest state, so
 * toggles and chip removals compose correctly even while a navigation is
 * still pending.
 */
export function applyCatalogPatch(current: ProductQueryInput, patch: CatalogPatch): ProductQueryInput {
  const p = typeof patch === "function" ? patch(current) : patch;
  return { ...current, ...p, page: p.page ?? 1 };
}

/** Filters fixed by the page path never appear in the URL; the page re-adds them. */
export function stripLocked(query: ProductQueryInput, locked: CatalogLocked): ProductQueryInput {
  return {
    ...query,
    categorySlugs: locked.category ? undefined : query.categorySlugs,
    brandSlugs: locked.brand ? undefined : query.brandSlugs,
  };
}

/** Builds the catalogue URL for a query, with locked slugs stripped. */
export function catalogHref(pathname: string, query: ProductQueryInput, locked: CatalogLocked = {}): string {
  const qs = toSearchParams(stripLocked(query, locked)).toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** "Clear all" target: no filters, no sort, no search. */
export const EMPTY_CATALOG_QUERY: ProductQueryInput = {};

export type PriceBoundsResult =
  | { ok: true; minPrice?: number; maxPrice?: number }
  | { ok: false; error: string };

/**
 * Parses the Price filter inputs (whole taka, same units as the priceRange
 * facet and the min/max URL params). Empty means unset. Values outside the
 * facet range are allowed — like a hand-written URL, they simply match
 * fewer products. A minimum above the maximum is an error, not a swap:
 * silently swapping would apply a range the shopper did not ask for.
 */
export function parsePriceBounds(minRaw: string, maxRaw: string): PriceBoundsResult {
  const parseOne = (raw: string): number | undefined | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    if (!/^\d+$/.test(trimmed)) return null;
    return Number(trimmed);
  };
  const minPrice = parseOne(minRaw);
  const maxPrice = parseOne(maxRaw);
  if (minPrice === null || maxPrice === null) {
    return { ok: false, error: "Enter whole taka amounts for the price range." };
  }
  if (
    minPrice !== undefined &&
    maxPrice !== undefined &&
    minPrice > maxPrice
  ) {
    return {
      ok: false,
      error: "Minimum price cannot be more than the maximum price.",
    };
  }
  return {
    ok: true,
    ...(minPrice !== undefined ? { minPrice } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
  };
}
