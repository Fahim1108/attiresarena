import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));
import { renderToStaticMarkup } from "react-dom/server";
import { ProductPurchasePanel } from "../src/components/product/ProductPurchasePanel";
import { CartProvider } from "../src/context/CartContext";
import { WishlistProvider } from "../src/context/WishlistContext";
import { ToastProvider } from "../src/context/ToastContext";
import type { Product } from "../src/types";

/**
 * No size selected yet must NOT read as sold out: the panel shows
 * "Select a Size" + a neutral availability line while any size has
 * stock, and keeps the true Sold Out / Out of stock states only when
 * no size has stock at all. (Live report 2026-11-19: the product page
 * showed "Out of stock" + disabled "Sold Out" before a size was
 * chosen, even though size M had stock.)
 */

function panelProduct(stockBySize: Record<string, number>): Product {
  const sizes = Object.keys(stockBySize);
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    slug: "stock-state-shirt",
    name: "Stock State Shirt",
    shortDescription: "A shirt for stock-state checks.",
    description: "A shirt for stock-state checks.",
    categoryId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    brandId: "",
    price: 45000,
    colors: [{ id: "standard", name: "Standard", hex: "#6B0202" }],
    sizes,
    variants: sizes.map((size, i) => ({
      id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${i + 1}`,
      sku: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${i + 1}`,
      colorId: "standard",
      size,
      price: 45000,
      stock: stockBySize[size] ?? 0,
    })),
    imagesByColor: {},
    defaultImages: [{ src: "/x.jpg", alt: "Stock State Shirt" }],
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

/* eslint-disable react/no-children-prop -- React 19 types require children in the props object for createElement with these providers, and .check.ts files cannot use JSX. */
function renderPanel(product: Product): string {
  return renderToStaticMarkup(
    createElement(ToastProvider, {
      children: createElement(WishlistProvider, {
        approvedProductIds: [product.id],
        children: createElement(CartProvider, {
          approvedProducts: [product],
          approvedVariantIds: product.variants
            .filter((v) => v.stock > 0)
            .map((v) => v.id),
          initialItems: [],
          children: createElement(ProductPurchasePanel, {
            product,
            colorId: "standard",
            onColorChange: () => {},
          }),
        }),
      }),
    }),
  );
}
/* eslint-enable react/no-children-prop */

describe("size-select stock state", () => {
  it("shows Select a Size (not Sold Out / Out of stock) before a size is chosen when stock exists", () => {
    const html = renderPanel(panelProduct({ S: 0, M: 1, L: 2 }));
    expect(html).toContain("Select a Size");
    expect(html).toContain("Select a size to see availability");
    expect(html).not.toContain("Sold Out");
    expect(html).not.toContain("Out of stock");
  });

  it("keeps Sold Out / Out of stock when no size has stock", () => {
    const html = renderPanel(panelProduct({ S: 0, M: 0, L: 0 }));
    expect(html).toContain("Sold Out");
    expect(html).toContain("Out of stock");
    expect(html).not.toContain("Select a Size");
  });

  it("preselects the only size, so a single-size in-stock product still shows Add to Cart", () => {
    const html = renderPanel(panelProduct({ M: 1 }));
    expect(html).toContain("Add to Cart");
    expect(html).toContain("Only 1 left");
    expect(html).not.toContain("Sold Out");
  });
});
