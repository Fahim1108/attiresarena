import { describe, it, expect } from "vitest";
import {
  deriveFeedUnavailable,
  feedHealthStatus,
  mergeStorefrontFeed,
  parsePublishedAdminRow,
  projectPublishedAdminProduct,
  publishedMediaUrl,
  supabaseRefFromUrl,
  type PublishedAdminRow,
} from "../src/lib/catalog-publication";
import type { Product } from "../src/types";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_ID = "22222222-2222-4222-8222-222222222222";
const VARIANT_ID_2 = "33333333-3333-4333-8333-333333333333";
const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";
const MEDIA_PATH = "55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666.jpg";

function validRow(overrides: Partial<PublishedAdminRow> = {}): Record<string, unknown> {
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
      {
        id: VARIANT_ID,
        size: "M",
        color: "Navy Blue",
        price_minor: 250000,
        sale_price_minor: 200000,
        available: 3,
      },
      {
        id: VARIANT_ID_2,
        size: "L",
        color: "Navy Blue",
        price_minor: 250000,
        sale_price_minor: null,
        available: 0,
      },
    ],
    media: [{ path: MEDIA_PATH, alt: "Front view" }],
    ...overrides,
  };
}

function stubProduct(overrides: Partial<Product>): Product {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    slug: "stub",
    name: "Stub",
    shortDescription: "",
    description: "",
    categoryId: "",
    brandId: "",
    price: 1,
    colors: [],
    sizes: [],
    variants: [],
    imagesByColor: {},
    defaultImages: [],
    details: [],
    badges: [],
    isNewArrival: false,
    isFeatured: false,
    isBestSeller: false,
    rating: { average: 0, count: 0 },
    createdAt: "2026-11-15T00:00:00.000Z",
    tags: [],
    ...overrides,
  };
}

describe("published admin row validation", () => {
  it("accepts a well-formed row", () => {
    expect(parsePublishedAdminRow(validRow())).not.toBe(null);
  });
  it("rejects bad ids, slugs, names and dates", () => {
    expect(parsePublishedAdminRow(validRow({ id: "not-a-uuid" }))).toBe(null);
    expect(parsePublishedAdminRow(validRow({ slug: "Bad Slug!" }))).toBe(null);
    expect(parsePublishedAdminRow(validRow({ name: "   " }))).toBe(null);
    expect(parsePublishedAdminRow(validRow({ created_at: "yesterday" }))).toBe(null);
    expect(parsePublishedAdminRow(validRow({ category_id: "nope" }))).toBe(null);
    expect(parsePublishedAdminRow(null)).toBe(null);
    expect(parsePublishedAdminRow("text")).toBe(null);
  });
  it("rejects rows without variants or without usable media", () => {
    expect(parsePublishedAdminRow(validRow({ variants: [] }))).toBe(null);
    expect(parsePublishedAdminRow(validRow({ media: [] }))).toBe(null);
    expect(
      parsePublishedAdminRow(
        validRow({ media: [{ path: "/etc/passwd", alt: "x" }] }),
      ),
    ).toBe(null);
  });
  it("rejects invalid variants: placeholder sizes, bad prices, sale above regular", () => {
    const badSize = validRow({
      variants: [
        {
          id: VARIANT_ID,
          size: "N/A",
          color: "Red",
          price_minor: 100,
          sale_price_minor: null,
          available: 1,
        },
      ],
    });
    expect(parsePublishedAdminRow(badSize)).toBe(null);
    const badSale = validRow({
      variants: [
        {
          id: VARIANT_ID,
          size: "M",
          color: "Red",
          price_minor: 100,
          sale_price_minor: 200,
          available: 1,
        },
      ],
    });
    expect(parsePublishedAdminRow(badSale)).toBe(null);
    const negativeStock = validRow({
      variants: [
        {
          id: VARIANT_ID,
          size: "M",
          color: "Red",
          price_minor: 100,
          sale_price_minor: null,
          available: -1,
        },
      ],
    });
    expect(parsePublishedAdminRow(negativeStock)).toBe(null);
  });
  it("drops invalid media rows but keeps the product when one image survives", () => {
    const parsed = parsePublishedAdminRow(
      validRow({
        media: [
          { path: "bogus", alt: "bad" },
          { path: MEDIA_PATH, alt: "good" },
        ],
      }),
    );
    expect(parsed?.media).toHaveLength(1);
  });
});

describe("published admin projection", () => {
  it("projects prices, compare-at, badges, colors, sizes and images", () => {
    const product = projectPublishedAdminProduct(validRow());
    expect(product).not.toBe(null);
    expect(product?.status).toBe("published");
    expect(product?.price).toBe(2000);
    expect(product?.compareAtPrice).toBe(2500);
    expect(product?.badges).toEqual(["new", "sale"]);
    expect(product?.isNewArrival).toBe(true);
    expect(product?.colors).toEqual([
      { id: "navy-blue", name: "Navy Blue", hex: "#6B0202" },
    ]);
    expect(product?.sizes).toEqual(["M", "L"]);
    expect(product?.variants).toHaveLength(2);
    expect(product?.variants[0]).toMatchObject({
      id: VARIANT_ID,
      sku: VARIANT_ID,
      colorId: "navy-blue",
      size: "M",
      price: 2000,
      stock: 3,
    });
    expect(product?.defaultImages).toHaveLength(1);
    expect(product?.defaultImages[0]?.src).toBe(`/api/product-media/${MEDIA_PATH}`);
    expect(product?.defaultImages[0]?.src).toContain(MEDIA_PATH.split("/")[0]);
    expect(product?.imagesByColor["navy-blue"]).toBe(product?.defaultImages);
    expect(product?.createdAt).toBe("2026-11-15T01:00:00.000Z");
    expect(product?.apparelSizing).toBe(true);
    expect(product?.sizeGuideId).toBe("tops");
    expect(product?.details).toEqual(["100% cotton"]);
  });
  it("uses created_at when published_at is null and omits compare-at without a sale", () => {
    const product = projectPublishedAdminProduct(
      validRow({
        published_at: null,
        badges: [],
        variants: [
          {
            id: VARIANT_ID,
            size: "One Size",
            color: "Black",
            price_minor: 99000,
            sale_price_minor: null,
            available: 2,
          },
        ],
      }),
    );
    expect(product?.createdAt).toBe("2026-11-15T00:00:00.000Z");
    expect(product?.compareAtPrice).toBe(undefined);
    expect(product?.badges).toEqual([]);
    expect(product?.apparelSizing).toBe(false);
    expect(product?.sizeGuideId).toBe(undefined);
  });
  it("deduplicates color ids for confusable color names", () => {
    const product = projectPublishedAdminProduct(
      validRow({
        variants: [
          {
            id: VARIANT_ID,
            size: "M",
            color: "Navy Blue",
            price_minor: 100,
            sale_price_minor: null,
            available: 1,
          },
          {
            id: VARIANT_ID_2,
            size: "M",
            color: "navy  blue!",
            price_minor: 100,
            sale_price_minor: null,
            available: 1,
          },
        ],
      }),
    );
    expect(product?.colors.map((c) => c.id)).toEqual(["navy-blue", "navy-blue-2"]);
  });
  it("never leaks cost fields or database SKUs into the projection", () => {
    const row = validRow();
    (row.variants as Record<string, unknown>[])[0]!["cost_price_minor"] = 12345;
    (row.variants as Record<string, unknown>[])[0]!["sku"] = "SECRET-SKU-1";
    const product = projectPublishedAdminProduct(row);
    expect(product).not.toBe(null);
    const serialized = JSON.stringify(product);
    expect(serialized).not.toContain("12345");
    expect(serialized).not.toContain("SECRET-SKU-1");
    expect(serialized).not.toContain("cost");
  });
  it("returns null when no usable image survives validation", () => {
    expect(
      projectPublishedAdminProduct(
        validRow({ media: [{ path: "bogus", alt: "x" }] }),
      ),
    ).toBe(null);
    expect(projectPublishedAdminProduct(validRow({ media: [] }))).toBe(null);
  });
});

describe("published media URLs", () => {
  it("builds same-origin delivery URLs for the media route", () => {
    expect(publishedMediaUrl(MEDIA_PATH)).toBe(
      `/api/product-media/${MEDIA_PATH}`,
    );
  });
  it("rejects malformed paths", () => {
    expect(publishedMediaUrl("/inventory/x.jpg")).toBe(null);
    expect(publishedMediaUrl("a/b.gif")).toBe(null);
    expect(publishedMediaUrl("")).toBe(null);
    expect(publishedMediaUrl("../x.jpg")).toBe(null);
    expect(
      publishedMediaUrl(
        "banners/66666666-6666-4666-8666-666666666666.jpg",
      ),
    ).toBe(null);
  });
});

describe("feed merge", () => {
  it("keeps allowlist order first and appends admin products", () => {
    const allow = [stubProduct({ id: "a1", slug: "aa-shirt-001" })];
    const admin = [stubProduct({ id: "b1", slug: "sample-shirt" })];
    expect(mergeStorefrontFeed(allow, admin).map((p) => p.slug)).toEqual([
      "aa-shirt-001",
      "sample-shirt",
    ]);
  });
  it("drops admin rows colliding by id or slug, allowlist always wins", () => {
    const allow = [stubProduct({ id: "a1", slug: "shared-slug", name: "Allowlist" })];
    const admin = [
      stubProduct({ id: "a1", slug: "other", name: "Id collision" }),
      stubProduct({ id: "b2", slug: "shared-slug", name: "Slug collision" }),
      stubProduct({ id: "b3", slug: "unique", name: "Kept" }),
      stubProduct({ id: "b3", slug: "unique-2", name: "Admin duplicate" }),
    ];
    const merged = mergeStorefrontFeed(allow, admin);
    expect(merged.map((p) => p.name)).toEqual(["Allowlist", "Kept"]);
  });
  it("does not mutate its inputs", () => {
    const allow = [stubProduct({ id: "a1", slug: "s1" })];
    const admin = [stubProduct({ id: "b1", slug: "s2" })];
    mergeStorefrontFeed(allow, admin);
    expect(allow).toHaveLength(1);
    expect(admin).toHaveLength(1);
  });
});

describe("feed health status", () => {
  it("classifies ok, partial and unavailable", () => {
    const base = {
      configured: true,
      allowlistOk: true,
      publishedOk: true,
      allowlistCount: 18,
      publishedCount: 2,
      visibleCount: 20,
      projectRef: "jwccyndyaamodxjtjtfo",
      envProjectRef: "jwccyndyaamodxjtjtfo",
      expectedProjectRef: "jwccyndyaamodxjtjtfo",
      allowlistError: null,
      publishedError: null,
    };
    expect(feedHealthStatus(base)).toBe("ok");
    expect(feedHealthStatus({ ...base, publishedOk: false })).toBe("partial");
    expect(feedHealthStatus({ ...base, allowlistOk: false })).toBe("partial");
    expect(
      feedHealthStatus({ ...base, allowlistOk: false, publishedOk: false }),
    ).toBe("unavailable");
    expect(feedHealthStatus({ ...base, configured: false })).toBe("unavailable");
  });
});

describe("feed failure signal", () => {
  it("is unavailable only when unconfigured or when both sources fail", () => {
    const both = { configured: true, allowlistOk: true, publishedOk: true };
    expect(deriveFeedUnavailable(both)).toBe(false);
    expect(deriveFeedUnavailable({ ...both, publishedOk: false })).toBe(false);
    expect(deriveFeedUnavailable({ ...both, allowlistOk: false })).toBe(false);
    expect(
      deriveFeedUnavailable({ ...both, allowlistOk: false, publishedOk: false }),
    ).toBe(true);
    expect(deriveFeedUnavailable({ ...both, configured: false })).toBe(true);
  });
  it("agrees with feed health status: unavailable if and only if the signal is true", () => {
    const counts = {
      allowlistCount: 0,
      publishedCount: 0,
      visibleCount: 0,
      projectRef: null,
      envProjectRef: null,
      expectedProjectRef: "jwccyndyaamodxjtjtfo",
      allowlistError: null,
      publishedError: null,
    };
    for (const configured of [true, false]) {
      for (const allowlistOk of [true, false]) {
        for (const publishedOk of [true, false]) {
          const health = { configured, allowlistOk, publishedOk, ...counts };
          expect(deriveFeedUnavailable(health)).toBe(
            feedHealthStatus(health) === "unavailable",
          );
        }
      }
    }
  });
  it("removing one product from either source shrinks the merged feed by exactly one", () => {
    const allow = [
      stubProduct({ id: "a1", slug: "aa-shirt-001" }),
      stubProduct({ id: "a2", slug: "aa-shirt-002" }),
    ];
    const admin = [
      stubProduct({ id: "b1", slug: "admin-shirt-1" }),
      stubProduct({ id: "b2", slug: "admin-shirt-2" }),
    ];
    const full = mergeStorefrontFeed(allow, admin);
    expect(full).toHaveLength(4);
    expect(mergeStorefrontFeed(allow.slice(1), admin)).toHaveLength(3);
    expect(mergeStorefrontFeed(allow, admin.slice(1))).toHaveLength(3);
    // A single deletion can never zero the feed while other rows exist.
    expect(mergeStorefrontFeed(allow.slice(1), admin.slice(1))).toHaveLength(2);
  });
});

describe("supabase project ref parsing", () => {
  it("extracts the ref from a Supabase URL", () => {
    expect(supabaseRefFromUrl("https://jwccyndyaamodxjtjtfo.supabase.co")).toBe(
      "jwccyndyaamodxjtjtfo",
    );
    expect(supabaseRefFromUrl("https://jwccyndyaamodxjtjtfo.supabase.co/")).toBe(
      "jwccyndyaamodxjtjtfo",
    );
    expect(
      supabaseRefFromUrl("https://euoannuvovsbwxjqnriw.supabase.co/rest/v1/"),
    ).toBe("euoannuvovsbwxjqnriw");
  });
  it("returns null for non-Supabase hosts, malformed refs and missing values", () => {
    expect(supabaseRefFromUrl("https://placeholder.invalid")).toBeNull();
    expect(supabaseRefFromUrl("https://example.supabase.co.evil.test")).toBeNull();
    expect(supabaseRefFromUrl("https://short.supabase.co")).toBeNull();
    expect(supabaseRefFromUrl("not a url")).toBeNull();
    expect(supabaseRefFromUrl(undefined)).toBeNull();
    expect(supabaseRefFromUrl(null)).toBeNull();
    expect(supabaseRefFromUrl("")).toBeNull();
  });
});
