import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { officialShirtSizeGuide } from "../src/config/shirt-size-guide";
import { sizeGuideMeasurements } from "../src/components/product/SizeGuideTable";
import type { SizeGuide } from "../src/types";

/**
 * Client feedback batch B (items 7, 10, 11, 12) — 2026-11-24, Fahim approved.
 * - (7) Product photo frame is taller (3/4) so tall portrait photos show the
 *   collar — on product cards and in the detail gallery.
 * - (10) Size buttons show the guide measurements in brackets, e.g.
 *   "XL (Chest 44, Length 28–29)"; sizes with no guide row show just the label.
 * - (11) Product page has a Facebook share button + a copy-link button.
 * - (12) "Details & Care" is gone; only Description + Delivery & Returns
 *   remain, and the size guide lives in its own section below the accordion.
 */

function src(rel: string): string {
  return readFileSync(join(process.cwd(), "src", rel), "utf8");
}

describe("item 10: size-button measurements", () => {
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

  it("size guide lives in its own section below the accordion", () => {
    const page = src("app/(store)/product/[slug]/page.tsx");
    expect(page).toContain('id="size-guide"');
    expect(page).toContain("<SizeGuideTable guide={effectiveSizeGuide} />");
  });
});
