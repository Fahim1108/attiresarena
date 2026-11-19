import { describe, expect, it } from "vitest";
import {
  eligibleCandidates,
  selectMixedProducts,
  toMerchandisingCandidates,
} from "@/lib/merchandising";
import { curatedInventoryCollection } from "@/services/adapters/owner-catalogue";
import type { Product } from "@/types";

/**
 * Homepage collections must surface REAL published products. Live report
 * 2026-11-19: the production homepage showed zero products although two
 * were published — getHomepageProducts() returned [] always and
 * getCollection only matched the aa-shirt-NNN design-review fixture
 * slugs, so New Arrivals / Featured stayed empty and the sections were
 * filtered out of the page.
 */

function product(overrides: Partial<Product> & { id: string; slug: string }): Product {
  return {
    name: overrides.slug,
    shortDescription: "",
    description: "",
    categoryId: "cat-shirts",
    brandId: "",
    price: 45000,
    colors: [{ id: "standard", name: "Standard", hex: "#6B0202" }],
    sizes: ["M"],
    variants: [
      { id: `${overrides.id}-v`, sku: overrides.id, colorId: "standard", size: "M", stock: 1 },
    ],
    imagesByColor: {},
    defaultImages: [{ src: "/x.jpg", alt: overrides.slug }],
    details: [],
    badges: [],
    isNewArrival: false,
    isFeatured: false,
    isBestSeller: false,
    rating: { average: 0, count: 0 },
    createdAt: "2026-11-18T10:00:00.000Z",
    tags: [],
    ...overrides,
  };
}

const realOld = product({ id: "real-old", slug: "casual-shirt", createdAt: "2026-11-18T10:00:00.000Z" });
const realNew = product({ id: "real-new", slug: "test-shirt-2", createdAt: "2026-11-18T20:00:00.000Z" });
const flagged = product({ id: "real-flag", slug: "flagged-shirt", isFeatured: true, createdAt: "2026-11-18T12:00:00.000Z" });
const fixture = product({ id: "fix-1", slug: "aa-shirt-001", reviewOnly: true, createdAt: "" });
const fixture2 = product({ id: "fix-2", slug: "aa-shirt-002", reviewOnly: true, createdAt: "" });

describe("homepage collections from real publications", () => {
  it("builds candidates from real products only, carrying the trusted publication timestamp", () => {
    const candidates = toMerchandisingCandidates([realOld, realNew, fixture]);
    expect(candidates.map((c) => c.product.id)).toEqual(["real-old", "real-new"]);
    expect(candidates[0]).toMatchObject({ status: "published", publishedAt: "2026-11-18T10:00:00.000Z" });
    expect(eligibleCandidates(candidates, Date.parse("2026-11-19T00:00:00Z"))).toHaveLength(2);
  });

  it("selects new arrivals newest-first from real candidates", () => {
    const candidates = toMerchandisingCandidates([realOld, realNew]);
    const ids = selectMixedProducts(candidates, {
      kind: "new-arrivals",
      now: Date.parse("2026-11-19T00:00:00Z"),
    }).map((p) => p.id);
    expect(ids).toEqual(["real-new", "real-old"]);
  });

  it("returns real products newest-first for new-arrivals, fixtures after", () => {
    const ids = curatedInventoryCollection(
      [fixture, realOld, fixture2, realNew],
      "new-arrivals",
    ).map((p) => p.id);
    expect(ids).toEqual(["real-new", "real-old", "fix-1", "fix-2"]);
  });

  it("returns badge-flagged real products for featured", () => {
    const ids = curatedInventoryCollection(
      [realOld, flagged, realNew],
      "featured",
    ).map((p) => p.id);
    expect(ids).toEqual(["real-flag"]);
  });

  it("keeps the fixture preview slice for featured when nothing is flagged", () => {
    const fixtures = Array.from({ length: 10 }, (_, i) =>
      product({ id: `fix-${i + 1}`, slug: `aa-shirt-${String(i + 1).padStart(3, "0")}`, reviewOnly: true, createdAt: "" }),
    );
    const ids = curatedInventoryCollection(fixtures, "featured").map((p) => p.id);
    expect(ids).toEqual(["fix-9", "fix-10"]);
  });

  it("returns nothing for best-sellers", () => {
    expect(curatedInventoryCollection([realOld, realNew], "best-sellers")).toEqual([]);
  });
});
