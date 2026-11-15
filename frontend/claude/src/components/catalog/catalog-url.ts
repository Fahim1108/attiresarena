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
