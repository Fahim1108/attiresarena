import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { displayedSizes, selectableStock } from "../src/lib/product";
import type { Product } from "../src/types";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * Sold-out honesty must count only sizes the shopper can select. A stocked
 * size whose name is not a canonical apparel size never appears as a
 * button (live case 2026-11-19, Casual shirt), so it must not keep the
 * product page button on "Select a Size" nor the shop card on "Add to
 * Cart" while every selectable size is sold out.
 */

function stockProduct(stockBySize: Record<string, number>): Product {
  const sizes = Object.keys(stockBySize);
  return {
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    slug: "selectable-stock-shirt",
    name: "Selectable Stock Shirt",
    shortDescription: "A shirt for selectable-stock checks.",
    description: "A shirt for selectable-stock checks.",
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
    defaultImages: [{ src: "/x.jpg", alt: "Selectable Stock Shirt" }],
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

describe("selectable stock", () => {
  it("displayedSizes is the template list when apparel sizing applies", () => {
    expect(displayedSizes(stockProduct({ M: 0, Medium: 1 }))).toEqual([
      "S",
      "M",
      "L",
      "XL",
      "2XL",
      "3XL",
      "Over Size",
    ]);
  });

  it("displayedSizes falls back to the real sizes without apparel sizing", () => {
    const product = stockProduct({ M: 0, Medium: 1 });
    product.apparelSizing = false;
    expect(displayedSizes(product)).toEqual(["M", "Medium"]);
  });

  it("selectableStock ignores stock behind a non-selectable size name", () => {
    const product = stockProduct({ M: 0, Medium: 1 });
    expect(selectableStock(product, "standard")).toBe(0);
    expect(selectableStock(product)).toBe(0);
  });

  it("selectableStock counts stock behind selectable sizes", () => {
    const product = stockProduct({ M: 0, L: 2, Medium: 5 });
    expect(selectableStock(product, "standard")).toBe(2);
    expect(selectableStock(product)).toBe(2);
  });

  it("the shop card derives soldOut from selectable stock", () => {
    const cardSource = readFileSync(
      join(sourceRoot, "components/product/ProductCard.tsx"),
      "utf8",
    );
    expect(cardSource).toContain(
      "const soldOut = !product.reviewOnly && selectableStock(product) === 0;",
    );
    expect(cardSource).not.toContain("totalStock(product) === 0");
  });

  it("the purchase panel derives its stock state from displayed sizes", () => {
    const panelSource = readFileSync(
      join(sourceRoot, "components/product/ProductPurchasePanel.tsx"),
      "utf8",
    );
    expect(panelSource).toContain(
      "const displayedSizesList = displayedSizes(product);",
    );
    expect(panelSource).not.toContain("product.sizes.some((s) =>");
  });
});
