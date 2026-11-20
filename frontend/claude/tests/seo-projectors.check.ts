import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPublishedCategorySeo,
  parsePublishedAdminRow,
  parsePublishedCategoryRow,
  projectPublishedAdminProduct,
  type PublishedAdminRow,
} from "../src/lib/catalog-publication";
import { dataSource } from "../src/services/adapters";
import type { Category } from "../src/types/catalog";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";
const MEDIA_PATH = "55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666.jpg";

function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PRODUCT_ID,
    slug: "sample-oxford-shirt",
    name: "Sample Oxford Shirt",
    description: "A crisp sample shirt for feed tests.",
    category_id: CATEGORY_ID,
    highlights: ["100% cotton"],
    tags: ["cotton"],
    badges: ["New Arrival"],
    created_at: "2026-11-15T00:00:00.000Z",
    published_at: "2026-11-15T01:00:00.000Z",
    variants: [
      { id: VARIANT_ID, size: "M", color: "Navy Blue", price_minor: 250000, sale_price_minor: 200000, available: 3 },
    ],
    media: [{ path: MEDIA_PATH, alt: "Front view" }],
    ...overrides,
  };
}

describe("admin-panel SEO passthrough (SEO-7)", () => {
  it("passes seo_title/seo_description/meta_keywords through when the RPC returns them", () => {
    const parsed = parsePublishedAdminRow(
      validRow({ seo_title: "  Best Oxford  ", seo_description: "Finest cotton.", meta_keywords: "shirts, Dhaka" }),
    ) as PublishedAdminRow;
    expect(parsed.seo_title).toBe("Best Oxford");
    expect(parsed.seo_description).toBe("Finest cotton.");
    expect(parsed.meta_keywords).toBe("shirts, Dhaka");
    const product = projectPublishedAdminProduct(
      validRow({ seo_title: "Best Oxford", seo_description: "Finest cotton.", meta_keywords: "shirts, Dhaka" }),
    );
    expect(product?.seoTitle).toBe("Best Oxford");
    expect(product?.seoDescription).toBe("Finest cotton.");
    expect(product?.metaKeywords).toBe("shirts, Dhaka");
  });

  it("omits SEO fields when the RPC returns none (today's shape: byte-identical fallback)", () => {
    const parsed = parsePublishedAdminRow(validRow()) as PublishedAdminRow;
    expect(parsed.seo_title).toBe(null);
    expect(parsed.seo_description).toBe(null);
    expect(parsed.meta_keywords).toBe(null);
    const product = projectPublishedAdminProduct(validRow());
    expect(product?.seoTitle).toBeUndefined();
    expect(product?.seoDescription).toBeUndefined();
    expect(product?.metaKeywords).toBeUndefined();
  });

  it("never drops a row for malformed SEO fields", () => {
    const product = projectPublishedAdminProduct(
      validRow({ seo_title: 42, seo_description: "", meta_keywords: ["not", "a", "string"] }),
    );
    expect(product).not.toBe(null);
    expect(product?.seoTitle).toBeUndefined();
    expect(product?.seoDescription).toBeUndefined();
    expect(product?.metaKeywords).toBeUndefined();
  });
});

describe("thrift SEO passthrough (SEO-7)", () => {
  const row = {
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

  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SUPABASE_URL", "https://euoannuvovsbwxjqnriw.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_isolated_unit_fixture");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function rpc(rows: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(JSON.stringify(url.includes("/rpc/published_thrift_catalogue") ? rows : []), { status: 200 }),
      ),
    );
  }

  it("passes seo_title/seo_description through and never keywords", async () => {
    rpc([{ ...row, seo_title: "Thrift Gem", seo_description: "One of one.", meta_keywords: "must-not-appear" }]);
    const product = await dataSource.getProductBySlug("aa-shirt-001");
    expect(product?.seoTitle).toBe("Thrift Gem");
    expect(product?.seoDescription).toBe("One of one.");
    expect(product?.metaKeywords).toBeUndefined();
  });

  it("omits SEO fields when the RPC returns none", async () => {
    rpc([row]);
    const product = await dataSource.getProductBySlug("aa-shirt-001");
    expect(product?.seoTitle).toBeUndefined();
    expect(product?.seoDescription).toBeUndefined();
    expect(product?.metaKeywords).toBeUndefined();
  });
});

describe("admin updated_at passthrough (M-A)", () => {
  it("passes a parsable updated_at through to Product.updatedAt", () => {
    const parsed = parsePublishedAdminRow(
      validRow({ updated_at: "2026-11-18T10:00:00.000Z" }),
    ) as PublishedAdminRow;
    expect(parsed.updated_at).toBe("2026-11-18T10:00:00.000Z");
    const product = projectPublishedAdminProduct(
      validRow({ updated_at: "2026-11-18T10:00:00.000Z" }),
    );
    expect(product?.updatedAt).toBe("2026-11-18T10:00:00.000Z");
    // createdAt semantics are unchanged: publication date still wins.
    expect(product?.createdAt).toBe("2026-11-15T01:00:00.000Z");
  });

  it("omits updatedAt when the RPC returns none (pre-migration shape)", () => {
    const product = projectPublishedAdminProduct(validRow());
    expect(product?.updatedAt).toBeUndefined();
  });

  it("never drops a row for a malformed updated_at", () => {
    const product = projectPublishedAdminProduct(
      validRow({ updated_at: "not-a-date" }),
    );
    expect(product).not.toBe(null);
    expect(product?.updatedAt).toBeUndefined();
  });
});

describe("thrift updated_at passthrough (M-A)", () => {
  const row = {
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

  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SUPABASE_URL", "https://euoannuvovsbwxjqnriw.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_isolated_unit_fixture");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function rpc(rows: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(JSON.stringify(url.includes("/rpc/published_thrift_catalogue") ? rows : []), { status: 200 }),
      ),
    );
  }

  it("passes a parsable updated_at through", async () => {
    rpc([{ ...row, updated_at: "2026-11-18T10:00:00.000Z" }]);
    const product = await dataSource.getProductBySlug("aa-shirt-001");
    expect(product?.updatedAt).toBe("2026-11-18T10:00:00.000Z");
    expect(product?.createdAt).toBe("2026-10-24T00:00:00Z");
  });

  it("omits updatedAt when the RPC returns none and never drops the row for a malformed value", async () => {
    rpc([{ ...row, updated_at: "not-a-date" }]);
    const product = await dataSource.getProductBySlug("aa-shirt-001");
    expect(product).not.toBe(null);
    expect(product?.updatedAt).toBeUndefined();
  });
});

describe("public category rows (M-A)", () => {
  const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";

  function categoryRow(overrides: Record<string, unknown> = {}) {
    return {
      id: CATEGORY_ID,
      slug: "shirts",
      name: "Shirts",
      seo_title: "Thrift Shirts",
      seo_description: "Individual thrift shirts.",
      published: true,
      updated_at: "2026-11-18T10:00:00.000Z",
      ...overrides,
    };
  }

  function staticCategory(slug = "shirts"): Category {
    return {
      id: "cat-shirts",
      slug,
      name: "Shirts",
      description: "Individual thrift shirts, carefully selected.",
      image: { src: "/inventory/thrift-shirts/AA-SHIRT-001-front.jpg", alt: "Attires Arena thrift shirts" },
      sortOrder: 1,
    };
  }

  it("parses a valid published_categories row, SEO fields included", () => {
    const parsed = parsePublishedCategoryRow(categoryRow());
    expect(parsed).toEqual({
      id: CATEGORY_ID,
      slug: "shirts",
      name: "Shirts",
      seoTitle: "Thrift Shirts",
      seoDescription: "Individual thrift shirts.",
      published: true,
      updatedAt: "2026-11-18T10:00:00.000Z",
    });
  });

  it("degrades malformed SEO/updated_at to nulls without dropping the row", () => {
    const parsed = parsePublishedCategoryRow(
      categoryRow({ seo_title: 42, seo_description: "", updated_at: "junk" }),
    );
    expect(parsed).not.toBe(null);
    expect(parsed?.seoTitle).toBe(null);
    expect(parsed?.seoDescription).toBe(null);
    expect(parsed?.updatedAt).toBe(null);
  });

  it("drops rows with a bad id, slug, name, or non-boolean published flag", () => {
    expect(parsePublishedCategoryRow(categoryRow({ id: "nope" }))).toBe(null);
    expect(parsePublishedCategoryRow(categoryRow({ slug: "Bad Slug!" }))).toBe(null);
    expect(parsePublishedCategoryRow(categoryRow({ name: "   " }))).toBe(null);
    expect(parsePublishedCategoryRow(categoryRow({ published: "yes" }))).toBe(null);
  });

  it("merges SEO + updatedAt onto the matching static category by slug", () => {
    const shirts = staticCategory("shirts");
    const merged = applyPublishedCategorySeo([shirts], [parsePublishedCategoryRow(categoryRow())!]);
    expect(merged[0]?.seoTitle).toBe("Thrift Shirts");
    expect(merged[0]?.seoDescription).toBe("Individual thrift shirts.");
    expect(merged[0]?.updatedAt).toBe("2026-11-18T10:00:00.000Z");
    // The static description is untouched: only SEO fields merge.
    expect(merged[0]?.description).toBe("Individual thrift shirts, carefully selected.");
  });

  it("returns unmatched categories unchanged (same reference) and ignores unpublished rows and unknown slugs", () => {
    const shirts = staticCategory("shirts");
    const merged = applyPublishedCategorySeo(
      [shirts],
      [
        parsePublishedCategoryRow(categoryRow({ slug: "formal-shirt" }))!,
        parsePublishedCategoryRow(categoryRow({ published: false }))!,
      ],
    );
    expect(merged[0]).toBe(shirts);
    expect(applyPublishedCategorySeo([shirts], [])[0]).toBe(shirts);
  });
});
