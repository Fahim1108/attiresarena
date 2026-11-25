import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { officialShirtSizeGuide } from "../src/config/shirt-size-guide";
import { sizeGuideMeasurements } from "../src/components/product/SizeGuideTable";
import { SizeSelector } from "../src/components/product/VariantSelector";
import { ProductPurchasePanel } from "../src/components/product/ProductPurchasePanel";
import { CartProvider } from "../src/context/CartContext";
import { WishlistProvider } from "../src/context/WishlistContext";
import { ToastProvider } from "../src/context/ToastContext";
import type { Product, SizeGuide } from "../src/types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

/**
 * Client feedback batch B (items 7, 10, 11, 12) — 2026-11-24, Fahim approved.
 * - (7) Product photo frame is taller (3/4) so tall portrait photos show the
 *   collar — on product cards and in the detail gallery.
 * - (10) CORRECTED 2026-11-25 (Fahim): the guide measurements go beside the
 *   "Size:" line for the selected size only, e.g. "Size: M (Chest 40,
 *   Length 28–29)" — nothing written in the option buttons below, which
 *   stay plain labels (S, M, L). Sizes with no guide row show just the label.
 * - (11) Product page has a Facebook share button + a copy-link button.
 * - (12) "Details & Care" is gone; only Description + Delivery & Returns
 *   remain. CORRECTED 2026-11-25 (Fahim): the size guide is a button just
 *   below the size selector that opens the table inline — no standalone
 *   section below the accordion.
 */

function src(rel: string): string {
  return readFileSync(join(process.cwd(), "src", rel), "utf8");
}

describe("item 10: size-guide measurement mapping (feeds the Size line)", () => {
  it("maps the official guide to bracket text", () => {
    const m = sizeGuideMeasurements(officialShirtSizeGuide);
    expect(m["XL"]).toBe("Chest 44, Length 28–29");
    expect(m["S"]).toBe("Chest 38, Length 27–28");
    expect(m["6XL"]).toBe("Chest 54, Length 30–31");
  });

  it("omits sizes with no usable measurements", () => {
    const guide: SizeGuide = {
      id: "g",
      title: "G",
      unit: "inches",
      columns: ["Size", "Chest", "Length"],
      rows: [
        ["M", "40", "28–29"],
        ["Over Size", "50+", "Not specified"],
      ],
      notes: [],
    };
    const m = sizeGuideMeasurements(guide);
    expect(m["M"]).toBe("Chest 40, Length 28–29");
    expect(m["Over Size"]).toBe("Chest 50+");
  });

  it("omits a size that is absent from the guide entirely", () => {
    expect(sizeGuideMeasurements(officialShirtSizeGuide)["11XL"]).toBeUndefined();
  });
});

describe("item 10 (corrected 2026-11-25): measurements beside the Size line", () => {
  const measurements = {
    S: "Chest 38, Length 27–28",
    M: "Chest 40, Length 28–29",
    L: "Chest 42, Length 28–29",
    XL: "Chest 44, Length 28–29",
  };

  function renderSelector(
    isAvailable: (s: string) => boolean,
    value: string | undefined,
    m: Record<string, string> = measurements,
  ): string {
    return renderToStaticMarkup(
      createElement(SizeSelector, {
        sizes: ["S", "M", "L", "XL"],
        value,
        onChange: () => {},
        isAvailable,
        measurements: m,
      }),
    );
  }

  it("shows just the selected size with its measurements beside Size:", () => {
    const html = renderSelector((s) => s === "M", "M");
    expect(html).toContain("M (Chest 40, Length 28–29)");
    // The buttons stay plain labels: no measurement inside any button.
    expect(html).not.toContain("(Chest 40, Length 28–29)</button>");
    expect(html).toContain(">M</button>");
    // No other size appears in the Size line.
    expect(html).not.toContain("S (Chest 38");
  });

  it("shows only the selected size when several are in stock", () => {
    const html = renderSelector((s) => s === "S" || s === "L", "L");
    expect(html).toContain("L (Chest 42, Length 28–29)");
    expect(html).not.toContain("S (Chest 38");
    expect(html).not.toContain("(Chest 38, Length 27–28)</button>");
  });

  it("shows just the label when the selected size has no guide row", () => {
    const html = renderSelector((s) => s === "M", "M", {});
    expect(html).toContain(">M</button>");
    expect(html).not.toContain("(");
  });

  it("shows 'Select a size' with no measurements before a size is picked", () => {
    const html = renderSelector((s) => s === "S" || s === "M", undefined);
    expect(html).toContain("Select a size");
    expect(html).not.toContain("(");
  });
});

describe("item 7: taller 3/4 photo frame", () => {
  it("product cards use 3/4, not 4/5", () => {
    const card = src("components/product/ProductCard.tsx");
    expect(card).toContain("aspect-[3/4]");
    expect(card).not.toContain("aspect-[4/5]");
  });

  it("detail gallery uses 3/4, not 4/5", () => {
    const gallery = src("components/product/ProductGallery.tsx");
    expect(gallery).toContain("aspect-[3/4]");
    expect(gallery).not.toContain("aspect-[4/5]");
  });

  it("loading skeletons match the 3/4 frame", () => {
    const skeleton = src("components/ui/LoadingSkeleton.tsx");
    expect(skeleton).toContain("aspect-[3/4]");
  });
});

describe("item 11: product share", () => {
  it("purchase panel has Facebook share + copy link", () => {
    const panel = src("components/product/ProductPurchasePanel.tsx");
    expect(panel).toContain("https://www.facebook.com/sharer/sharer.php?u=");
    expect(panel).toContain("Share on Facebook");
    expect(panel).toContain("Copy link");
    expect(panel).toContain("navigator.clipboard.writeText");
  });
});

describe("item 12: accordion without Details & Care", () => {
  it("product page has no Details & Care accordion item", () => {
    const page = src("app/(store)/product/[slug]/page.tsx");
    expect(page).not.toContain("Details & Care");
    expect(page).toContain('id: "description"');
    expect(page).toContain('id: "delivery"');
  });

  it("size guide is a button below the size selector, not a standalone section (Fahim, 2026-11-25)", () => {
    const page = src("app/(store)/product/[slug]/page.tsx");
    expect(page).not.toContain('aria-labelledby="size-guide"');
    expect(page).not.toContain('<h2 id="size-guide"');
    const panel = src("components/product/ProductPurchasePanel.tsx");
    // The button sits right after the size selector and toggles the table.
    // (lastIndexOf: the first "Size Guide" mention is the state comment.)
    expect(panel.lastIndexOf("Size Guide")).toBeGreaterThan(
      panel.indexOf("<SizeSelector"),
    );
    expect(panel).toContain('aria-expanded={sizeGuideOpen}');
    expect(panel).toContain('aria-controls="product-size-guide"');
    expect(panel).toContain("{sizeGuideOpen && (");
    expect(panel).toContain("<SizeGuideTable guide={sizeGuide} />");
  });
});

/* eslint-disable react/no-children-prop -- React 19 types require children in the props object for createElement with these providers. */
describe("item 12 (size guide button): toggle renders collapsed", () => {
  function guideProduct(): Product {
    return {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "guide-shirt",
      name: "Guide Shirt",
      shortDescription: "A shirt.",
      description: "A shirt.",
      categoryId: "44444444-4444-4444-8444-444444444444",
      brandId: "",
      price: 2500,
      colors: [{ id: "standard", name: "Standard", hex: "#6B0202" }],
      sizes: ["S", "M"],
      variants: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          sku: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          colorId: "standard",
          size: "S",
          price: 2500,
          stock: 2,
        },
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          sku: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          colorId: "standard",
          size: "M",
          price: 2500,
          stock: 1,
        },
      ],
      imagesByColor: {},
      defaultImages: [{ src: "/x.jpg", alt: "Guide Shirt" }],
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

  it("shows the Size Guide button collapsed, with no table until opened", () => {
    const product = guideProduct();
    const html = renderToStaticMarkup(
      createElement(ToastProvider, {
        children: createElement(WishlistProvider, {
          approvedProductIds: [product.id],
          children: createElement(CartProvider, {
            approvedProducts: [product],
            approvedVariantIds: product.variants.map((v) => v.id),
            initialItems: [],
            children: createElement(ProductPurchasePanel, {
              product,
              colorId: "standard",
              onColorChange: () => {},
              sizeGuide: officialShirtSizeGuide,
            }),
          }),
        }),
      }),
    );
    expect(html).toContain("Size Guide");
    expect(html).toContain('aria-expanded="false"');
    // The guide table stays hidden until the button is opened.
    expect(html).not.toContain(officialShirtSizeGuide.title);
  });
});
/* eslint-enable react/no-children-prop */
