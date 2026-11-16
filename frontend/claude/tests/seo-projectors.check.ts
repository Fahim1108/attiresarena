import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parsePublishedAdminRow,
  projectPublishedAdminProduct,
  type PublishedAdminRow,
} from "../src/lib/catalog-publication";
import { dataSource } from "../src/services/adapters";

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
