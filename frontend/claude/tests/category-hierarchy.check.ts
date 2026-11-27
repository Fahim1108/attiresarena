import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataSource } from "@/services/adapters";
import { storeCategories } from "../src/config/catalogue";
import {
  mergeDbCategories,
  parseCategoryRow,
  type CategoryRow,
} from "../src/lib/store-settings";
import { queryProducts } from "../src/lib/catalog-query";
import { selectableStock } from "../src/lib/product";
import {
  SHIRT_PARENT_ID,
  childCategories,
  isShirtSubcategory,
  shirtSubKey,
  shirtSubcategories,
  subcategoryChipGroup,
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
  it("matches the four shirt types by slug, and by name as a fallback", () => {
    expect(isShirtSubcategory({ slug: "casual-shirt", name: "Casual shirt" })).toBe(true);
    expect(isShirtSubcategory({ slug: "formal-shirt", name: "Formal shirt" })).toBe(true);
    expect(isShirtSubcategory({ slug: "denim-shirt", name: "Denim shirt" })).toBe(true);
    expect(isShirtSubcategory({ slug: "check-shirt", name: "Check shirt" })).toBe(true);
    expect(shirtSubKey({ slug: "denim-shirt", name: "Denim shirt" })).toBe("denim");
    expect(isShirtSubcategory({ slug: "something-else", name: "Formal shirt" })).toBe(true);
    expect(isShirtSubcategory({ slug: "hoodies", name: "Hoodies" })).toBe(false);
    expect(isShirtSubcategory({ slug: "shirts", name: "Shirts" })).toBe(false);
  });

  it("canonicalizes messy staging rows to the same shirt type (plural + mis-slugged)", () => {
    // Real staging rows (published_categories(), 2026-11-20): a
    // "Formal shirts" duplicate (slug formal-shirts) and a "Casual
    // shirt" row whose slug is "staging-category-f7a3f419-…".
    expect(shirtSubKey({ slug: "formal-shirts", name: "Formal shirts" })).toBe("formal");
    expect(shirtSubKey({ slug: "something-else", name: "Formal shirts" })).toBe("formal");
    expect(shirtSubKey({ slug: "staging-category-f7a3f419-40c8-42aa-a39c-cad87677c4c7", name: "Casual shirt" })).toBe("casual");
    expect(shirtSubKey({ slug: "check-shirt", name: "check shirt" })).toBe("check");
    expect(shirtSubKey({ slug: "hoodies", name: "Hoodies" })).toBe(null);
    expect(shirtSubKey({ slug: "shirts", name: "Shirts" })).toBe(null);
    expect(isShirtSubcategory({ slug: "formal-shirts", name: "Formal shirts" })).toBe(true);
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
      "denim-shirt",
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

describe("chips without DB rows (Preview 2026-11-21 regression)", () => {
  it("shows Casual/Formal/Denim/Check as sub-categories even when the anon categories read returns nothing", () => {
    // Before the fix the four types existed only as DB rows, so a
    // silent read/parse failure dropped all four chips at once while
    // /category/shirts still listed 20 products.
    const merged = mergeDbCategories(storeCategories, []);
    expect(shirtSubcategories(merged).map((c) => c.slug)).toEqual([
      "casual-shirt",
      "formal-shirt",
      "denim-shirt",
      "check-shirt",
    ]);
    expect(topLevelCategories(merged).map((c) => c.slug)).toEqual([
      "shirts",
      "pants",
      "sneakers",
      "belts",
      "wallets",
      "watches",
    ]);
  });

  it("keeps the DB uuid as id for a shirt sub-category row, so its products still match", () => {
    const merged = mergeDbCategories(storeCategories, [
      row({ id: CASUAL_ID, name: "Casual shirt", slug: "casual-shirt", sort_position: 1 }),
      row({ id: FORMAL_ID, name: "Formal shirt", slug: "formal-shirt", sort_position: 2 }),
      row({ id: CHECK_ID, name: "Check shirt", slug: "check-shirt", sort_position: 3 }),
    ]);
    expect(merged.find((c) => c.slug === "casual-shirt")?.id).toBe(CASUAL_ID);
    expect(merged.find((c) => c.slug === "formal-shirt")?.id).toBe(FORMAL_ID);
    expect(merged.find((c) => c.slug === "check-shirt")?.id).toBe(CHECK_ID);
    const casualProduct = product({
      id: "p-casual-db",
      slug: "casual-db-1",
      categoryId: CASUAL_ID,
    });
    const listed = queryProducts([casualProduct], merged, [], {
      categorySlugs: ["casual-shirt"],
    });
    expect(listed.items.map((p) => p.slug)).toEqual(["casual-db-1"]);
    expect(
      listed.facets.categories.find((c) => c.slug === "casual-shirt")?.count,
    ).toBe(1);
  });

  it("does not drop a category row for a null description or null sort_position", () => {
    expect(
      parseCategoryRow({
        id: CASUAL_ID,
        parent_id: null,
        name: "Casual shirt",
        slug: "casual-shirt",
        published: true,
        description: null,
        image_storage_path: null,
        banner_storage_path: null,
        seo_title: null,
        seo_description: null,
        sort_position: null,
      }),
    ).toMatchObject({ slug: "casual-shirt", description: "", sort_position: 0 });
  });

  it("treats an all-zero-stock product as sold out (the maroon badge condition)", () => {
    const soldOut = product({
      id: "p-soldout",
      slug: "sold-out-1",
      variants: [
        { id: "p-soldout-v", sku: "p-soldout", colorId: "standard", size: "M", stock: 0 },
      ],
    });
    expect(selectableStock(soldOut)).toBe(0);
    expect(selectableStock(product({ id: "p-instock", slug: "in-stock-1" }))).toBe(1);
  });
});

describe("review mode (Preview) uses the DB-merged categories — round-2 regression", () => {
  // Preview 2026-11-21, deployment 4PTUtkqv9: chips showed (0) and every
  // sub-category page was "Coming Soon". Root cause, proven from the
  // live Preview HTML: vercel.json sets CLAUDE_DESIGN_PREVIEW=1, so
  // reviewInventoryEnabled() was true on Preview and the adapter
  // returned a static category list (only Shirts available, static ids
  // cat-casual-shirt…) while admin products carry DB UUIDs — zero
  // matches, zero counts. The adapter now uses the DB-merged list in
  // review mode too (see owner-catalogue.ts). These tests stub the
  // staging-shaped reads in preview env and assert the adapter level,
  // not just queryProducts().
  const adminRow = {
    id: "30000000-0000-4000-8000-000000000001",
    slug: "casual-admin-1",
    name: "Casual admin shirt",
    description: "A thrift shirt.",
    category_id: CASUAL_ID,
    highlights: [],
    tags: [],
    badges: [],
    created_at: "2026-11-19T00:00:00Z",
    published_at: "2026-11-19T00:00:00Z",
    youtube_video_id: null,
    seo_title: null,
    seo_description: null,
    meta_keywords: null,
    variants: [{ id: "50000000-0000-4000-8000-000000000001", size: "M", color: "Navy", price_minor: 45000, sale_price_minor: null, available: 1 }],
    media: [{ path: "60000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001.jpg", alt: "Casual admin shirt" }],
  };
  const dbRows = [
    row({ id: CASUAL_ID, name: "Casual shirt", slug: "casual-shirt", sort_position: 1 }),
    row({ id: FORMAL_ID, name: "Formal shirt", slug: "formal-shirt", sort_position: 2 }),
    row({ id: CHECK_ID, name: "Check shirt", slug: "check-shirt", sort_position: 3 }),
  ];
  function feeds(categoryRows: unknown[], admin: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/rest/v1/categories"))
          return new Response(JSON.stringify(categoryRows), { status: 200 });
        if (url.includes("/rpc/published_admin_catalogue"))
          return new Response(JSON.stringify(admin), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );
  }
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("CLAUDE_DESIGN_PREVIEW", "1");
    vi.stubEnv("SUPABASE_URL", "https://jwccyndyaamodxjtjtfo.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_isolated_unit_fixture");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lists a DB-assigned product under its sub-category with a real count, and keeps non-shirts coming soon", async () => {
    feeds(dbRows, [adminRow]);
    expect((await dataSource.getCategoryBySlug("casual-shirt"))?.available).toBe(true);
    expect((await dataSource.getCategoryBySlug("pants"))?.available).toBe(false);
    expect((await dataSource.getCategoryBySlug("sneakers"))?.available).toBe(false);
    const casual = await dataSource.getProducts({ categorySlugs: ["casual-shirt"] });
    expect(casual.items.map((p) => p.slug)).toEqual(["casual-admin-1"]);
    expect(casual.facets.categories.find((c) => c.slug === "casual-shirt")?.count).toBe(1);
    const shirts = await dataSource.getProducts({ categorySlugs: ["shirts"] });
    expect(shirts.items.map((p) => p.slug)).toContain("casual-admin-1");
  });

  it("keeps sub-category pages available (honestly empty) when the categories read returns nothing", async () => {
    feeds([], [adminRow]);
    expect((await dataSource.getCategoryBySlug("casual-shirt"))?.available).toBe(true);
    expect((await dataSource.getProducts({ categorySlugs: ["casual-shirt"] })).total).toBe(0);
  });
});

describe("review mode with real staging rows (plural + mis-slugged)", () => {
  // The two real staging products are NOT assigned to the three
  // proper sub-category rows: TEST Shirt → "Formal shirts" (plural
  // duplicate, 22566784-…) and the lifecycle shirt → a "Casual
  // shirt" row whose slug is "staging-category-f7a3f419-…". By raw
  // id they match no sub-category, so their chips would stay (0)
  // and their sub-pages empty even after the review-mode fix. The
  // canonical sub key (shirtSubKey) maps both rows to their shirt
  // type, so they list and count under Formal / Casual.
  const FORMAL_SHIRTS_ID = "22566784-0723-4cef-8e1e-7007084306d9";
  const CASUAL_STAGING_ID = "f7a3f419-40c8-42aa-a39c-cad87677c4c7";
  const CHECK_ID_REAL = "83e0f4a6-7f24-4cc2-adab-f067a0427f7a";
  const stagingRows = [
    {
      id: FORMAL_SHIRTS_ID,
      parent_id: null,
      name: "Formal shirts",
      slug: "formal-shirts",
      published: true,
      description: "",
      image_storage_path: null,
      banner_storage_path: null,
      seo_title: null,
      seo_description: null,
      sort_position: 1,
    },
    {
      id: CASUAL_STAGING_ID,
      parent_id: null,
      name: "Casual shirt",
      slug: "staging-category-f7a3f419-40c8-42aa-a39c-cad87677c4c7",
      published: true,
      description: "",
      image_storage_path: null,
      banner_storage_path: null,
      seo_title: null,
      seo_description: null,
      sort_position: 2,
    },
    {
      id: CHECK_ID_REAL,
      parent_id: null,
      name: "check shirt",
      slug: "check-shirt",
      published: true,
      description: "",
      image_storage_path: null,
      banner_storage_path: null,
      seo_title: null,
      seo_description: null,
      sort_position: 3,
    },
  ];
  function stagingAdmin(id: string, slug: string, categoryId: string) {
    return {
      id,
      slug,
      name: slug,
      description: "A thrift shirt.",
      category_id: categoryId,
      highlights: [],
      tags: [],
      badges: [],
      created_at: "2026-11-19T00:00:00Z",
      published_at: "2026-11-19T00:00:00Z",
      youtube_video_id: null,
      seo_title: null,
      seo_description: null,
      meta_keywords: null,
      variants: [{ id: `50000000-0000-4000-8000-0000000000${id.slice(-2)}`, size: "M", color: "Navy", price_minor: 45000, sale_price_minor: null, available: 1 }],
      media: [{ path: "60000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001.jpg", alt: slug }],
    };
  }
  const stagingAdminRows = [
    stagingAdmin("30000000-0000-4000-8000-000000000011", "formal-shirts-product", FORMAL_SHIRTS_ID),
    stagingAdmin("30000000-0000-4000-8000-000000000012", "casual-staging-product", CASUAL_STAGING_ID),
  ];
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("CLAUDE_DESIGN_PREVIEW", "1");
    vi.stubEnv("SUPABASE_URL", "https://jwccyndyaamodxjtjtfo.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_isolated_unit_fixture");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/rest/v1/categories"))
          return new Response(JSON.stringify(stagingRows), { status: 200 });
        if (url.includes("/rpc/published_admin_catalogue"))
          return new Response(JSON.stringify(stagingAdminRows), { status: 200 });
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lists mis-assigned staging products under their proper sub-category with real counts", async () => {
    expect((await dataSource.getCategoryBySlug("formal-shirt"))?.available).toBe(true);
    expect((await dataSource.getCategoryBySlug("casual-shirt"))?.available).toBe(true);
    const formal = await dataSource.getProducts({ categorySlugs: ["formal-shirt"] });
    expect(formal.items.map((p) => p.slug)).toEqual(["formal-shirts-product"]);
    expect(formal.facets.categories.find((c) => c.slug === "formal-shirt")?.count).toBe(1);
    const casual = await dataSource.getProducts({ categorySlugs: ["casual-shirt"] });
    expect(casual.items.map((p) => p.slug)).toEqual(["casual-staging-product"]);
    expect(casual.facets.categories.find((c) => c.slug === "casual-shirt")?.count).toBe(1);
    const shirts = await dataSource.getProducts({ categorySlugs: ["shirts"] });
    expect(shirts.items.map((p) => p.slug)).toEqual(
      expect.arrayContaining(["formal-shirts-product", "casual-staging-product"]),
    );
    // Neither messy row leaks out as a top-level tile.
    const top = topLevelCategories(await dataSource.getCategories()).map((c) => c.slug);
    expect(top).not.toContain("formal-shirts");
    expect(top).not.toContain("staging-category-f7a3f419-40c8-42aa-a39c-cad87677c4c7");
  });
});

describe("duplicate shirt chips dedupe (Preview 2026-11-21, deployment BE9vxDT4)", () => {
  // /category/shirts showed 6 chips — All Shirts (20), Casual shirt
  // (1), Formal shirt (1), Formal shirts (1), check shirt (0),
  // Casual shirt (1) again — because the chip list was built from
  // the merged rows, and the merged list carries both the static
  // rows and the messy DB rows. The Casual chip even linked to the
  // garbage slug "staging-category-f7a3f419-…". Chips are now one
  // per canonical type, with canonical slug/name, and their counts
  // come from the canonical sub-page query (facets count the same
  // product under every duplicate row for a type, so summing them
  // would double-count Formal as 1+1=2).
  const FORMAL_SHIRTS_ID = "22566784-0723-4cef-8e1e-7007084306d9";
  const CASUAL_STAGING_ID = "f7a3f419-40c8-42aa-a39c-cad87677c4c7";
  const CHECK_ID_REAL = "83e0f4a6-7f24-4cc2-adab-f067a0427f7a";
  const messyRows = [
    row({ id: FORMAL_SHIRTS_ID, name: "Formal shirts", slug: "formal-shirts", description: "", sort_position: 1 }),
    row({ id: CASUAL_STAGING_ID, name: "Casual shirt", slug: "staging-category-f7a3f419-40c8-42aa-a39c-cad87677c4c7", description: "", sort_position: 2 }),
    row({ id: CHECK_ID_REAL, name: "check shirt", slug: "check-shirt", description: "", sort_position: 3 }),
  ];
  const merged = mergeDbCategories(storeCategories, messyRows);

  it("shows exactly one chip per shirt type, canonical slug + name, no garbage slug", () => {
    const subs = shirtSubcategories(merged);
    expect(subs.map((c) => c.slug)).toEqual(["casual-shirt", "formal-shirt", "denim-shirt", "check-shirt"]);
    expect(subs.map((c) => c.name)).toEqual(["Casual shirt", "Formal shirt", "Denim shirt", "Check shirt"]);
    expect(subs.map((c) => c.slug)).not.toContain("staging-category-f7a3f419-40c8-42aa-a39c-cad87677c4c7");
    expect(subs.map((c) => c.slug)).not.toContain("formal-shirts");
  });

  it("gives each sub-category the canonical listing description, never 'Coming soon.'", () => {
    expect(merged.find((c) => c.slug === "formal-shirts")?.description).toBe(
      "Formal shirts for work and occasions.",
    );
    expect(
      merged.find((c) => c.slug === "staging-category-f7a3f419-40c8-42aa-a39c-cad87677c4c7")?.description,
    ).toBe("Everyday casual shirts.");
    expect(merged.find((c) => c.slug === "check-shirt")?.description).toBe("Check-pattern shirts.");
    expect(merged.find((c) => c.slug === "casual-shirt")?.description).toBe("Everyday casual shirts.");
  });

  it("keeps 'Coming soon.' for a genuinely future category with a blank stored description", () => {
    const withPants = mergeDbCategories(storeCategories, [
      row({ id: "70000000-0000-4000-8000-000000000001", name: "Pants", slug: "pants", description: "", sort_position: 1 }),
    ]);
    expect(withPants.find((c) => c.slug === "pants")?.description).toBe("Coming soon.");
  });

  it("counts each canonical type once — the chip count equals its sub-page total", () => {
    const products = [
      product({ id: "p-formal-staging", slug: "formal-staging-1", categoryId: FORMAL_SHIRTS_ID }),
      product({ id: "p-casual-staging", slug: "casual-staging-1", categoryId: CASUAL_STAGING_ID }),
    ];
    expect(queryProducts(products, merged, [], { categorySlugs: ["formal-shirt"] }).total).toBe(1);
    expect(queryProducts(products, merged, [], { categorySlugs: ["casual-shirt"] }).total).toBe(1);
    expect(queryProducts(products, merged, [], { categorySlugs: ["check-shirt"] }).total).toBe(0);
    // Facets alone would double-count Formal (1 under formal-shirt
    // AND 1 under formal-shirts) — that is why the page must not
    // sum facet counts per type.
    const shirts = queryProducts(products, merged, [], { categorySlugs: ["shirts"] });
    expect(
      (shirts.facets.categories.find((c) => c.slug === "formal-shirt")?.count ?? 0) +
        (shirts.facets.categories.find((c) => c.slug === "formal-shirts")?.count ?? 0),
    ).toBe(2);
  });
});

describe("client feedback 2026-11-24 items 3 + 4: secondaries never top-level, DB owns the taxonomy", () => {
  const SNEAKERS_ID = "80000000-0000-4000-8000-000000000001";
  const WHITE_ID = "80000000-0000-4000-8000-000000000002";
  const BLACK_ID = "80000000-0000-4000-8000-000000000003";
  const SHIRTS_ID = "80000000-0000-4000-8000-000000000004";

  it("item 3: a child category with a real parent never leaks out as a top-level tile", () => {
    const merged = mergeDbCategories(storeCategories, [
      row({ id: SNEAKERS_ID, name: "Sneakers", slug: "sneakers", description: "", sort_position: 1 }),
      row({ id: WHITE_ID, parent_id: SNEAKERS_ID, name: "White Sneakers", slug: "white-sneakers", description: "", sort_position: 1 }),
      row({ id: BLACK_ID, parent_id: SNEAKERS_ID, name: "Black Sneakers", slug: "black-sneakers", description: "", sort_position: 2 }),
    ]);
    const top = topLevelCategories(merged).map((c) => c.slug);
    expect(top).not.toContain("white-sneakers");
    expect(top).not.toContain("black-sneakers");
    expect(top).toEqual(["sneakers"]);
    expect(childCategories(merged, SNEAKERS_ID).map((c) => c.slug)).toEqual([
      "white-sneakers",
      "black-sneakers",
    ]);
  });

  it("item 4: once the DB returns primary rows, a static category with no DB row is dropped (admin delete really removes the tile)", () => {
    // Five of the six primaries seeded — Watches has no DB row, so
    // its static tile must NOT come back.
    const five = mergeDbCategories(storeCategories, [
      row({ id: SHIRTS_ID, name: "Shirts", slug: "shirts", description: "", sort_position: 1 }),
      row({ id: "80000000-0000-4000-8000-000000000005", name: "Pants", slug: "pants", description: "", sort_position: 2 }),
      row({ id: SNEAKERS_ID, name: "Sneakers", slug: "sneakers", description: "", sort_position: 3 }),
      row({ id: "80000000-0000-4000-8000-000000000006", name: "Belt", slug: "belts", description: "", sort_position: 4 }),
      row({ id: "80000000-0000-4000-8000-000000000007", name: "Wallet", slug: "wallets", description: "", sort_position: 5 }),
    ]);
    expect(five.map((c) => c.slug).sort()).toEqual([
      "belts",
      "pants",
      "shirts",
      "sneakers",
      "wallets",
    ]);
    expect(five.find((c) => c.slug === "watches")).toBeUndefined();
  });

  it("item 4: before the primary seed (sub rows only, parent_id NULL) the static config still fills the gaps", () => {
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
  });

  it("item 4: parented shirt subs keep the DB as source of truth even if every primary is deleted in admin", () => {
    // The seed migration parents the subs; if the admin then deletes
    // all six primaries, the parented subs still prove the seed ran,
    // so the static six must NOT resurrect.
    const merged = mergeDbCategories(storeCategories, [
      row({ id: CASUAL_ID, parent_id: SHIRTS_ID, name: "Casual shirt", slug: "casual-shirt", sort_position: 1 }),
      row({ id: FORMAL_ID, parent_id: SHIRTS_ID, name: "Formal shirt", slug: "formal-shirt", sort_position: 2 }),
      row({ id: CHECK_ID, parent_id: SHIRTS_ID, name: "Check shirt", slug: "check-shirt", sort_position: 3 }),
    ]);
    expect(merged.map((c) => c.slug).sort()).toEqual([
      "casual-shirt",
      "check-shirt",
      "formal-shirt",
    ]);
  });

  it("item 3: generic sub-category chip group — any primary shows its children, a child page shows parent + siblings", () => {
    const cats: Category[] = [
      category({ id: "cat-shirts", slug: "shirts", name: "Shirts" }),
      category({ id: CASUAL_ID, slug: "casual-shirt", name: "Casual shirt", parentId: SHIRT_PARENT_ID }),
      category({ id: FORMAL_ID, slug: "formal-shirt", name: "Formal shirt", parentId: SHIRT_PARENT_ID }),
      category({ id: CHECK_ID, slug: "check-shirt", name: "Check shirt", parentId: SHIRT_PARENT_ID }),
      category({ id: SNEAKERS_ID, slug: "sneakers", name: "Sneakers" }),
      category({ id: WHITE_ID, slug: "white-sneakers", name: "White Sneakers", parentId: SNEAKERS_ID }),
      category({ id: BLACK_ID, slug: "black-sneakers", name: "Black Sneakers", parentId: SNEAKERS_ID }),
      category({ id: "cat-pants", slug: "pants", name: "Pants" }),
    ];
    const sneakers = cats.find((c) => c.slug === "sneakers")!;
    const sneakersGroup = subcategoryChipGroup(sneakers, cats);
    expect(sneakersGroup?.parent.slug).toBe("sneakers");
    expect(sneakersGroup?.items.map((c) => c.slug)).toEqual(["white-sneakers", "black-sneakers"]);
    const white = cats.find((c) => c.slug === "white-sneakers")!;
    const whiteGroup = subcategoryChipGroup(white, cats);
    expect(whiteGroup?.parent.slug).toBe("sneakers");
    expect(whiteGroup?.items.map((c) => c.slug)).toEqual(["white-sneakers", "black-sneakers"]);
    const shirts = cats.find((c) => c.slug === "shirts")!;
    const shirtsGroup = subcategoryChipGroup(shirts, cats);
    expect(shirtsGroup?.parent.slug).toBe("shirts");
    expect(shirtsGroup?.items.map((c) => c.slug)).toEqual(["casual-shirt", "formal-shirt", "check-shirt"]);
    const casual = cats.find((c) => c.slug === "casual-shirt")!;
    expect(subcategoryChipGroup(casual, cats)?.parent.slug).toBe("shirts");
    const pants = cats.find((c) => c.slug === "pants")!;
    expect(subcategoryChipGroup(pants, cats)).toBeNull();
  });
});
