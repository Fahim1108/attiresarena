import { describe, expect, it } from "vitest";
import { APPAREL_SIZES, canonicalSize } from "../src/lib/catalogue-dimensions";
import { officialShirtSizeGuide } from "../src/config/shirt-size-guide";
import { sizeGuideMeasurements } from "../src/components/product/SizeGuideTable";
import { garmentSizes } from "../src/lib/admin/validation";
import { SIZE_OPTIONS } from "../src/lib/admin/constants";
import { displayedSizes } from "../src/lib/product";
import { queryProducts } from "../src/lib/catalog-query";
import { mockProducts, mockCategories, mockBrands } from "../src/mocks";
import type { Product } from "../src/types";

/**
 * Client feedback batch C (item 6) — 2026-11-24, Fahim approved.
 * Sizes go to 10XL (7XL 56, 8XL 58, 9XL 60, 10XL 62; length 30–31) and
 * "Over Size" is deleted from every hardcoded list.
 *
 * LIVE CHECK (2026-11-24, production shop filter): /shop?sizes=Over Size
 * returns 20 products — all of them TEST All-Size Shirts; no real product
 * has an in-stock "Over Size" variant (control: sizes=9XL returns 0).
 * After this change those test products' "Over Size" variant is no longer
 * selectable on the product page (they keep their other 5–6 sizes); the
 * variant rows themselves are untouched — deleting them is a data decision
 * for Fahim, not a code change.
 *
 * Admin-customizable sizes were NOT built here: the template list is a
 * synchronous pure map used by the selector, stock counts, shop filters
 * and facets. Making it data-driven needs a DB-backed size list + admin
 * UI + every call site to take the list — a separate, larger change.
 */

const SIZES_10XL = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL", "9XL", "10XL"];

function stockProduct(stockBySize: Record<string, number>): Product {
  const sizes = Object.keys(stockBySize);
  return {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    slug: "batch-c-shirt",
    name: "Batch C Shirt",
    shortDescription: "x",
    description: "x",
    categoryId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    brandId: "",
    price: 45000,
    colors: [{ id: "standard", name: "Standard", hex: "#6B0202" }],
    sizes,
    variants: sizes.map((size, i) => ({
      id: `cccccccc-cccc-4ccc-8ccc-ccccccccccc${i + 1}`,
      sku: `cccccccc-cccc-4ccc-8ccc-ccccccccccc${i + 1}`,
      colorId: "standard",
      size,
      price: 45000,
      stock: stockBySize[size] ?? 0,
    })),
    imagesByColor: {},
    defaultImages: [{ src: "/x.jpg", alt: "Batch C Shirt" }],
    details: [],
    badges: [],
    isNewArrival: false,
    isFeatured: false,
    isBestSeller: false,
    rating: { average: 0, count: 0 },
    createdAt: "2026-11-15T00:00:00.000Z",
    tags: [],
    apparelSizing: true,
  };
}

describe("item 6: sizes to 10XL, Over Size deleted", () => {
  it("template list is S..10XL with no Over Size", () => {
    expect([...APPAREL_SIZES]).toEqual(SIZES_10XL);
  });

  it("canonical map covers 7XL..10XL and retires Over Size", () => {
    expect(canonicalSize("7XL")).toBe("7XL");
    expect(canonicalSize("10XL")).toBe("10XL");
    expect(canonicalSize("XXXXXXXL")).toBe("7XL");
    expect(canonicalSize("10xl")).toBe("10XL");
    expect(canonicalSize("Over Size")).toBeUndefined();
    expect(canonicalSize("oversize")).toBeUndefined();
  });

  it("guide rows run to 10XL with +2 chest per step", () => {
    const m = sizeGuideMeasurements(officialShirtSizeGuide);
    expect(m["7XL"]).toBe("Chest 56, Length 30–31");
    expect(m["8XL"]).toBe("Chest 58, Length 30–31");
    expect(m["9XL"]).toBe("Chest 60, Length 30–31");
    expect(m["10XL"]).toBe("Chest 62, Length 30–31");
    expect(m["Over Size"]).toBeUndefined();
  });

  it("admin size lists run to 10XL with no Over Size", () => {
    expect([...garmentSizes]).toEqual(SIZES_10XL);
    expect(SIZE_OPTIONS).toContain("7XL");
    expect(SIZE_OPTIONS).toContain("10XL");
    expect(SIZE_OPTIONS).not.toContain("Over Size");
  });

  it("an Over Size variant is no longer a displayed size", () => {
    expect(displayedSizes(stockProduct({ M: 1, "Over Size": 1 }))).toEqual(SIZES_10XL);
    expect(displayedSizes(stockProduct({ M: 1, "Over Size": 1 }))).not.toContain("Over Size");
  });

  it("shop size filter matches a 7XL variant", () => {
    const base = mockProducts.find((p) => p.apparelSizing)!;
    const product = { ...base, id: "batch-c-7xl", variants: [{ ...base.variants[0]!, size: "7XL", stock: 1 }] };
    expect(queryProducts([product], mockCategories, mockBrands, { sizes: ["7XL"] }).total).toBe(1);
    expect(queryProducts([product], mockCategories, mockBrands, { sizes: ["8XL"] }).total).toBe(0);
  });
});
