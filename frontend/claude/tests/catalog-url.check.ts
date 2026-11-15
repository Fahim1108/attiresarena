import { describe, expect, it } from "vitest";
import { applyCatalogPatch, catalogHref, EMPTY_CATALOG_QUERY, stripLocked } from "@/components/catalog/catalog-url";
import { parseProductQuery } from "@/lib/catalog-query";
import type { ProductQueryInput } from "@/services";

/** Parses a catalogue href back through the same parser the shop page uses. */
function roundTrip(href: string) {
  const qs = href.split("?")[1] ?? "";
  return parseProductQuery(Object.fromEntries(new URLSearchParams(qs)));
}

describe("catalogue URL composition (shop filter/sort/search)", () => {
  it("keeps sort and search when the In-stock filter is applied", () => {
    const base: ProductQueryInput = { sort: "newest", search: "shirt" };
    const href = catalogHref("/shop", applyCatalogPatch(base, { inStock: true }));
    expect(href).toBe("/shop?q=shirt&available=1&sort=newest");
    expect(roundTrip(href)).toMatchObject({ sort: "newest", search: "shirt", inStock: true });
  });

  it("keeps filters and search when the sort changes", () => {
    const base: ProductQueryInput = { inStock: true, categorySlugs: ["shirts"], sizes: ["M"], search: "linen" };
    const href = catalogHref("/shop", applyCatalogPatch(base, { sort: "price-asc" }));
    expect(roundTrip(href)).toMatchObject({ inStock: true, categorySlugs: ["shirts"], sizes: ["M"], search: "linen", sort: "price-asc" });
  });

  it("composes sequential patches made while a navigation is pending", () => {
    // Each patch merges onto the previous patch's result, not the stale
    // server-rendered query — the mechanism that dropped state before.
    const q0: ProductQueryInput = { sort: "newest" };
    const q1 = applyCatalogPatch(q0, { inStock: true });
    const q2 = applyCatalogPatch(q1, { sort: "price-asc" });
    const q3 = applyCatalogPatch(q2, (q) => ({ sizes: [...(q.sizes ?? []), "L"] }));
    expect(q3).toMatchObject({ sort: "price-asc", inStock: true, sizes: ["L"] });
    expect(roundTrip(catalogHref("/shop", q3))).toMatchObject({ sort: "price-asc", inStock: true, sizes: ["L"] });
  });

  it("resets to page 1 on filter/sort changes but keeps an explicit page change", () => {
    expect(applyCatalogPatch({ page: 3 }, { sizes: ["M"] }).page).toBe(1);
    expect(applyCatalogPatch({ page: 3 }, { sort: "rating" }).page).toBe(1);
    expect(applyCatalogPatch({ page: 3 }, { page: 2 }).page).toBe(2);
  });

  it("clears filters, sort and search on reset", () => {
    expect(catalogHref("/shop", EMPTY_CATALOG_QUERY)).toBe("/shop");
    expect(EMPTY_CATALOG_QUERY).toEqual({});
  });

  it("strips locked slugs from the URL while keeping the rest of the query", () => {
    const query: ProductQueryInput = { categorySlugs: ["shirts"], brandSlugs: ["acme"], sort: "newest", inStock: true };
    expect(stripLocked(query, { category: "shirts" })).toMatchObject({ categorySlugs: undefined, brandSlugs: ["acme"] });
    expect(catalogHref("/category/shirts", query, { category: "shirts" })).toBe("/category/shirts?brand=acme&available=1&sort=newest");
    expect(catalogHref("/brand/acme", query, { brand: "acme" })).toBe("/brand/acme?category=shirts&available=1&sort=newest");
  });

  it("round-trips a full query through the URL", () => {
    const query: ProductQueryInput = { search: "oxford", categorySlugs: ["shirts"], brandSlugs: ["acme"], sizes: ["M", "L"], shirtType: "oxford", inStock: true, minPrice: 1000, maxPrice: 5000, sort: "price-desc", offers: true, page: 2 };
    const parsed = roundTrip(catalogHref("/shop", query));
    expect(parsed).toMatchObject({ search: "oxford", categorySlugs: ["shirts"], brandSlugs: ["acme"], sizes: ["M", "L"], shirtType: "oxford", inStock: true, minPrice: 1000, maxPrice: 5000, sort: "price-desc", offers: true, page: 2 });
  });

  it("omits the default sort so the canonical URL stays clean", () => {
    expect(catalogHref("/shop", { sort: "featured", inStock: true })).toBe("/shop?available=1");
  });
});
