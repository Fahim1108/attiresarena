import { describe, expect, it } from "vitest";
import { storeCategories } from "../src/config/catalogue";
import { mergeDbCategories, type CategoryRow } from "../src/lib/store-settings";
import { queryProducts } from "../src/lib/catalog-query";
import {
  SHIRT_PARENT_ID,
  isShirtSubcategory,
  shirtSubcategories,
  topLevelCategories,
} from "../src/lib/category-hierarchy";
import type { Category, Product } from "../src/types";

/**
 * Category hierarchy — owner decision 2026-11-20: Shirts is the parent;
 * Casual/Formal/Check are sub-categories. Nothing is deleted: the 38
 * products keep their assignments, and /category/shirts lists all of
 * them while the three types are selectable inside Shirts.
 */

function row(overrides: Partial<CategoryRow>): CategoryRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    parent_id: null,
    name: "Shirts (Stored)",
    slug: "shirts",
    published: true,
    description: "Stored shirts text.",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    seo_description: null,
    sort_position: 0,
    ...overrides,
  };
}

function category(overrides: Partial<Category> & { id: string; slug: string; name: string }): Category {
  return {
    description: "",
    image: { src: "/x.svg", alt: overrides.name },
    sortOrder: 1,
    ...overrides,
  };
}

function product(overrides: Partial<Product> & { id: string; slug: string }): Product {
  return {
    name: overrides.slug,
    shortDescription: "",
    description: "",
    categoryId: "cat-shirts",
    brandId: "",
    price: 450,
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
    status: "published",
    ...overrides,
  };
}

const CASUAL_ID = "40000000-0000-4000-8000-000000000001";
const FORMAL_ID = "40000000-0000-4000-8000-000000000002";
const CHECK_ID = "40000000-0000-4000-8000-000000000003";

describe("shirt sub-category mapping", () => {
  it("matches the three shirt types by slug, and by name as a fallback", () => {
    expect(isShirtSubcategory({ slug: "casual-shirt", name: "Casual shirt" })).toBe(true);
    expect(isShirtSubcategory({ slug: "formal-shirt", name: "Formal shirt" })).toBe(true);
    expect(isShirtSubcategory({ slug: "check-shirt", name: "Check shirt" })).toBe(true);
    expect(isShirtSubcategory({ slug: "something-else", name: "Formal shirt" })).toBe(true);
    expect(isShirtSubcategory({ slug: "hoodies", name: "Hoodies" })).toBe(false);
    expect(isShirtSubcategory({ slug: "shirts", name: "Shirts" })).toBe(false);
  });

  it("keeps only Shirts, Pants, Sneakers, Belt, Wallet, Watches top-level", () => {
    const merged = mergeDbCategories(storeCategories, [
      row({ id: CASUAL_ID, name: "Casual shirt", slug: "casual-shirt", sort_position: 1 }),
      row({ id: FORMAL_ID, name: "Formal shirt", slug: "formal-shirt", sort_position: 2 }),
      row({ id: CHECK_ID, name: "Check shirt", slug: "check-shirt", sort_position: 3 }),
    ]);
    expect(topLevelCategories(merged).map((c) => c.slug)).toEqual([
      "shirts",
      "pants",
      "sneakers",
      "belts",
      "wallets",
      "watches",
    ]);
    expect(shirtSubcategories(merged).map((c) => c.slug)).toEqual([
      "casual-shirt",
      "formal-shirt",
      "check-shirt",
    ]);
  });

  it("maps shirt sub-categories to Shirts as parent, but a real DB parent wins", () => {
    const merged = mergeDbCategories(storeCategories, [
      row({ id: CASUAL_ID, name: "Casual shirt", slug: "casual-shirt" }),
      row({
        id: "50000000-0000-4000-8000-000000000001",
        parent_id: "60000000-0000-4000-8000-000000000001",
        name: "Hoodies",
        slug: "hoodies",
      }),
    ]);
    expect(merged.find((c) => c.slug === "casual-shirt")?.parentId).toBe(SHIRT_PARENT_ID);
    expect(merged.find((c) => c.slug === "hoodies")?.parentId).toBe(
      "60000000-0000-4000-8000-000000000001",
    );
    expect(merged.find((c) => c.slug === "shirts")?.parentId).toBeUndefined();
  });
});

describe("shirts listing with sub-category products", () => {
  const categories: Category[] = [
    category({ id: "cat-shirts", slug: "shirts", name: "Shirts" }),
    category({ id: CASUAL_ID, slug: "casual-shirt", name: "Casual shirt", parentId: SHIRT_PARENT_ID }),
    category({ id: FORMAL_ID, slug: "formal-shirt", name: "Formal shirt", parentId: SHIRT_PARENT_ID }),
    category({ id: CHECK_ID, slug: "check-shirt", name: "Check shirt", parentId: SHIRT_PARENT_ID }),
    category({ id: "cat-pants", slug: "pants", name: "Pants" }),
  ];
  const products = [
    product({ id: "p-casual", slug: "casual-1", categoryId: CASUAL_ID }),
    product({ id: "p-formal", slug: "formal-1", categoryId: FORMAL_ID }),
    product({ id: "p-check", slug: "check-1", categoryId: CHECK_ID }),
    product({ id: "p-unknown", slug: "unknown-1", categoryId: "99999999-9999-4999-8999-999999999999" }),
  ];

  it("lists every sub-category product under /category/shirts — nothing orphaned", () => {
    const shirts = queryProducts(products, categories, [], { categorySlugs: ["shirts"] });
    expect(shirts.items.map((p) => p.slug).sort()).toEqual([
      "casual-1",
      "check-1",
      "formal-1",
      "unknown-1",
    ]);
    expect(shirts.total).toBe(4);
  });

  it("lists only its own products under a sub-category page", () => {
    const casual = queryProducts(products, categories, [], { categorySlugs: ["casual-shirt"] });
    expect(casual.items.map((p) => p.slug)).toEqual(["casual-1"]);
    const formal = queryProducts(products, categories, [], { categorySlugs: ["formal-shirt"] });
    expect(formal.items.map((p) => p.slug)).toEqual(["formal-1"]);
  });

  it("never lists shirt products under a non-shirt category", () => {
    expect(queryProducts(products, categories, [], { categorySlugs: ["pants"] }).total).toBe(0);
  });
});
