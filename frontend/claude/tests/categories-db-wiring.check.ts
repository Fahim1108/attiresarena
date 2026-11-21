import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storeCategories } from "../src/config/catalogue";
import {
  categoryMediaUrl,
  getPublishedCategories,
  mergeDbCategories,
  parseCategoryRow,
  parseCategoryRows,
  type CategoryRow,
} from "../src/lib/store-settings";
import { dataSource } from "@/services/adapters";

function row(overrides: Partial<CategoryRow>): CategoryRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    parent_id: null,
    name: "Shirts (Stored)",
    slug: "shirts",
    published: true,
    description: "Stored shirts text.",
    image_storage_path:
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg",
    banner_storage_path:
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp",
    seo_title: "Stored Shirts SEO",
    seo_description: null,
    sort_position: 0,
    ...overrides,
  };
}

describe("parseCategoryRow", () => {
  it("accepts a complete published row", () => {
    expect(parseCategoryRow(row({}))).toEqual(row({}));
  });

  it("rejects malformed rows without throwing", () => {
    expect(parseCategoryRow(null)).toBeNull();
    expect(parseCategoryRow({ ...row({}), slug: "Bad Slug!" })).toBeNull();
    expect(parseCategoryRow({ ...row({}), name: "   " })).toBeNull();
    expect(parseCategoryRow({ ...row({}), published: "yes" })).toBeNull();
    expect(parseCategoryRow({ ...row({}), sort_position: 1.5 })).toBeNull();
    expect(parseCategoryRow({ ...row({}), parent_id: 42 })).toBeNull();
  });

  it("keeps only valid rows", () => {
    expect(parseCategoryRows([row({}), { slug: "nope" }, null])).toEqual([
      row({}),
    ]);
  });
});

describe("categoryMediaUrl", () => {
  it("maps a valid catalog storage path to the media route", () => {
    expect(
      categoryMediaUrl(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg",
      ),
    ).toBe(
      "/api/product-media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg",
    );
  });

  it("rejects empty, null and non-catalog paths", () => {
    expect(categoryMediaUrl(null)).toBeNull();
    expect(categoryMediaUrl("")).toBeNull();
    expect(categoryMediaUrl("foo/bar.png")).toBeNull();
    expect(categoryMediaUrl("/etc/passwd")).toBeNull();
  });
});

describe("mergeDbCategories", () => {
  const shirts = row({});
  const pants = row({
    id: "33333333-3333-4333-8333-333333333333",
    name: "Pants",
    slug: "pants",
    description: "",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    sort_position: 1,
  });
  const hoodies = row({
    id: "22222222-2222-4222-8222-222222222222",
    name: "Hoodies",
    slug: "hoodies",
    description: "Warm hoodies.",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    sort_position: 2,
  });
  const overshirts = row({
    id: "44444444-4444-4444-8444-444444444444",
    parent_id: shirts.id,
    name: "Overshirts",
    slug: "overshirts",
    description: "",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    sort_position: 0,
  });

  it("returns the static list unchanged when no published row is given", () => {
    expect(mergeDbCategories(storeCategories, [])).toBe(storeCategories);
    expect(mergeDbCategories(storeCategories, [row({ published: false })])).toBe(
      storeCategories,
    );
  });

  it("overrides a matching static slug but keeps its static id", () => {
    const merged = mergeDbCategories(storeCategories, [shirts]);
    const result = merged.find((c) => c.slug === "shirts")!;
    expect(result.id).toBe("cat-shirts");
    expect(result.name).toBe("Shirts (Stored)");
    expect(result.description).toBe("Stored shirts text.");
    expect(result.seoTitle).toBe("Stored Shirts SEO");
    expect(result.seoDescription).toBeUndefined();
    expect(result.image.src).toBe(
      "/api/product-media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg",
    );
    expect(result.thumbnail?.src).toBe(result.image.src);
    expect(result.banner?.src).toBe(
      "/api/product-media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp",
    );
  });

  it("keeps the static photo and 'Coming soon.' wording when the row has no image or description", () => {
    const merged = mergeDbCategories(storeCategories, [pants]);
    const result = merged.find((c) => c.slug === "pants")!;
    expect(result.id).toBe("cat-pants");
    expect(result.description).toBe("Coming soon.");
    expect(result.image.src).toBe("/images/categories/pants.svg");
    expect(result.banner).toBeUndefined();
  });

  it("appends a DB-only slug with its DB id and orders children after their parent", () => {
    const merged = mergeDbCategories(storeCategories, [
      shirts,
      pants,
      hoodies,
      overshirts,
    ]);
    expect(merged.map((c) => c.slug)).toEqual([
      "shirts",
      "overshirts",
      "pants",
      "hoodies",
      "casual-shirt",
      "formal-shirt",
      "check-shirt",
      "sneakers",
      "belts",
      "wallets",
      "watches",
    ]);
    expect(merged.map((c) => c.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const hoodiesResult = merged.find((c) => c.slug === "hoodies")!;
    expect(hoodiesResult.id).toBe("22222222-2222-4222-8222-222222222222");
    expect(hoodiesResult.description).toBe("Warm hoodies.");
    // No stored photo: generic category illustration, not a broken image.
    expect(hoodiesResult.image.src).toBe("/images/categories/shirts.svg");
    const overshirtsResult = merged.find((c) => c.slug === "overshirts")!;
    expect(overshirtsResult.description).toBe("Coming soon.");
  });

  it("does not hide a static category whose DB row is unpublished", () => {
    const merged = mergeDbCategories(storeCategories, [
      row({ slug: "watches", published: false }),
    ]);
    const result = merged.find((c) => c.slug === "watches")!;
    expect(result.name).toBe("Watches");
    expect(result.id).toBe("cat-watches");
  });

  it("skips malformed rows", () => {
    const merged = mergeDbCategories(storeCategories, [
      { ...row({}), slug: "Bad Slug!" },
    ]);
    expect(merged).toBe(storeCategories);
  });
});

describe("storefront categories read (adapter)", () => {
  const feedRow = {
    id: "10000000-0000-4000-8000-000000000001",
    variant_id: "20000000-0000-4000-8000-000000000001",
    slug: "aa-shirt-001",
    name: "Verified physical garment",
    size: "L",
    color: "Navy",
    price_minor: 55000,
    in_stock: true,
    image_path: "/inventory/thrift-shirts/AA-SHIRT-001-front.jpg",
    created_at: "2026-10-24T00:00:00Z",
  };
  const adminRow = {
    id: "30000000-0000-4000-8000-000000000003",
    slug: "test-hoodie",
    name: "Test Hoodie",
    description: "A published admin product in the Hoodies category.",
    category_id: "22222222-2222-4222-8222-222222222222",
    highlights: [],
    tags: [],
    badges: [],
    created_at: "2026-10-24T00:00:00Z",
    published_at: "2026-10-24T00:00:00Z",
    variants: [
      {
        id: "40000000-0000-4000-8000-000000000004",
        size: "M",
        color: "Navy",
        price_minor: 55000,
        available: 1,
      },
    ],
    media: [
      {
        path: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg",
        alt: "Test Hoodie",
      },
    ],
  };
  const categoryRows = [
    row({}),
    row({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Hoodies",
      slug: "hoodies",
      description: "Warm hoodies.",
      image_storage_path: null,
      banner_storage_path: null,
      seo_title: null,
      sort_position: 2,
    }),
  ];

  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("CLAUDE_DESIGN_PREVIEW", "1");
    vi.stubEnv(
      "SUPABASE_URL",
      "https://euoannuvovsbwxjqnriw.supabase.co",
    );
    vi.stubEnv(
      "SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_isolated_unit_fixture",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/rest/v1/categories"))
          return new Response(JSON.stringify(categoryRows), { status: 200 });
        if (url.includes("/rpc/published_thrift_catalogue"))
          return new Response(JSON.stringify([feedRow]), { status: 200 });
        if (url.includes("/rpc/published_admin_catalogue"))
          return new Response(JSON.stringify([adminRow]), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("merges published DB categories into getCategories and keeps the Shirts photo override", async () => {
    expect(await getPublishedCategories()).toHaveLength(2);
    const categories = await dataSource.getCategories();
    const shirts = categories.find((c) => c.slug === "shirts")!;
    expect(shirts.name).toBe("Shirts (Stored)");
    expect(shirts.description).toBe("Stored shirts text.");
    // The adapter photo override always wins for Shirts, even with a
    // stored DB photo. The override is the promoted check-shirts
    // photo (b994a81), not the old portrait.
    expect(shirts.image.src).toBe(
      "/images/mockup/category-shirts-check.svg",
    );
    expect(shirts.available).toBe(true);
    expect(shirts.catalogueUnavailable).toBe(false);
    const hoodies = categories.find((c) => c.slug === "hoodies")!;
    expect(hoodies.name).toBe("Hoodies");
    expect(hoodies.available).toBe(false);
  });

  it("exposes a DB-only category as a shop filter facet", async () => {
    const result = await dataSource.getProducts({});
    expect(
      result.facets.categories.map((c) => c.slug),
    ).toContain("hoodies");
  });

  it("filters products by a DB-only category through its DB id", async () => {
    const hoodies = await dataSource.getProducts({ categorySlugs: ["hoodies"] });
    expect(hoodies.items.map((p) => p.slug)).toEqual(["test-hoodie"]);
    // The static Shirts id is kept, so the fixture still resolves there.
    const shirts = await dataSource.getProducts({ categorySlugs: ["shirts"] });
    expect(shirts.items.map((p) => p.slug)).toEqual(["aa-shirt-001"]);
  });

  it("falls back to the static list when the read fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    expect(await getPublishedCategories()).toEqual([]);
    const categories = await dataSource.getCategories();
    const shirts = categories.find((c) => c.slug === "shirts")!;
    expect(shirts.name).toBe("Shirts");
    expect(shirts.available).toBe(false);
    expect(shirts.catalogueUnavailable).toBe(true);
  });
});
