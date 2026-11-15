import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parsePublishedAdminRow,
  projectPublishedAdminProduct,
  publishedMediaPublicUrl,
  type PublishedAdminRow,
} from "../src/lib/catalog-publication";
import { imagesForColor } from "../src/lib/product";
import {
  isSupabaseStoragePublicUrl,
  SmartImage,
} from "../src/components/ui/SmartImage";
import { ProductGallery } from "../src/components/product/ProductGallery";
import type { Product, ProductImage } from "../src/types";

const BASE_URL = "https://jwccyndyaamodxjtjtfo.supabase.co";
const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "55555555-5555-4555-8555-555555555555";
const MEDIA_PATHS = [
  `${OWNER_ID}/66666666-6666-4666-8666-666666666666.jpg`,
  `${OWNER_ID}/77777777-7777-4777-8777-777777777777.png`,
  `${OWNER_ID}/88888888-8888-4888-8888-888888888888.webp`,
] as const;

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
        sale_price_minor: null,
        available: 3,
      },
    ],
    media: MEDIA_PATHS.map((path, i) => ({ path, alt: `View ${i + 1}` })),
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

describe("projector multi-image projection", () => {
  it("projects every media row, in RPC (position) order, with alts", () => {
    const product = projectPublishedAdminProduct(validRow(), BASE_URL);
    expect(product).not.toBe(null);
    expect(product?.defaultImages).toHaveLength(3);
    expect(product?.defaultImages.map((image) => image.src)).toEqual(
      MEDIA_PATHS.map((path) => publishedMediaPublicUrl(BASE_URL, path)),
    );
    expect(product?.defaultImages.map((image) => image.alt)).toEqual([
      "View 1",
      "View 2",
      "View 3",
    ]);
  });

  it("falls back to the product name when a media row has no alt text", () => {
    const product = projectPublishedAdminProduct(
      validRow({
        media: [
          { path: MEDIA_PATHS[0], alt: "" },
          { path: MEDIA_PATHS[1], alt: "Side view" },
        ],
      }),
      BASE_URL,
    );
    expect(product?.defaultImages.map((image) => image.alt)).toEqual([
      "Sample Oxford Shirt",
      "Side view",
    ]);
  });

  it("shares the same image list across every color", () => {
    const product = projectPublishedAdminProduct(validRow(), BASE_URL);
    expect(product?.imagesByColor["navy-blue"]).toBe(product?.defaultImages);
    expect(product?.imagesByColor["navy-blue"]).toHaveLength(3);
  });

  it("drops invalid media rows but keeps the survivors in order", () => {
    const parsed = parsePublishedAdminRow(
      validRow({
        media: [
          { path: MEDIA_PATHS[0], alt: "First" },
          { path: "/etc/passwd", alt: "bogus" },
          { path: MEDIA_PATHS[2], alt: "Third" },
        ],
      }),
    );
    expect(parsed?.media.map((medium) => medium.path)).toEqual([
      MEDIA_PATHS[0],
      MEDIA_PATHS[2],
    ]);
  });

  it("builds a public Storage URL per media path", () => {
    expect(publishedMediaPublicUrl(BASE_URL, MEDIA_PATHS[0])).toBe(
      `${BASE_URL}/storage/v1/object/public/attires-product-drafts/${OWNER_ID}/66666666-6666-4666-8666-666666666666.jpg`,
    );
    expect(publishedMediaPublicUrl(BASE_URL, "/etc/passwd")).toBe(null);
  });
});

describe("imagesForColor fallback", () => {
  const colorImages: ProductImage[] = [
    { src: "/a.jpg", alt: "A" },
    { src: "/b.jpg", alt: "B" },
  ];
  const defaults: ProductImage[] = [{ src: "/d.jpg", alt: "D" }];

  it("returns the color list when it has images", () => {
    const product = stubProduct({
      imagesByColor: { "navy-blue": colorImages },
      defaultImages: defaults,
    });
    expect(imagesForColor(product, "navy-blue")).toBe(colorImages);
  });

  it("falls back to defaultImages for an unknown color", () => {
    const product = stubProduct({
      imagesByColor: { "navy-blue": colorImages },
      defaultImages: defaults,
    });
    expect(imagesForColor(product, "missing")).toBe(defaults);
  });

  it("falls back to defaultImages when the color list is empty", () => {
    const product = stubProduct({
      imagesByColor: { "navy-blue": [] },
      defaultImages: defaults,
    });
    expect(imagesForColor(product, "navy-blue")).toBe(defaults);
  });

  it("returns defaultImages when no color is selected", () => {
    const product = stubProduct({
      imagesByColor: { "navy-blue": colorImages },
      defaultImages: defaults,
    });
    expect(imagesForColor(product)).toBe(defaults);
  });
});

describe("Supabase Storage URLs bypass the image optimizer", () => {
  const storageUrl = publishedMediaPublicUrl(BASE_URL, MEDIA_PATHS[0])!;

  it("matches only the Storage public-object shape", () => {
    expect(isSupabaseStoragePublicUrl(storageUrl)).toBe(true);
    expect(
      isSupabaseStoragePublicUrl("/inventory/thrift-shirts/AA-SHIRT-001-front.jpg"),
    ).toBe(false);
    expect(
      isSupabaseStoragePublicUrl("https://example.com/storage/v1/object/public/x.jpg"),
    ).toBe(false);
    expect(
      isSupabaseStoragePublicUrl(
        "https://jwccyndyaamodxjtjtfo.supabase.co.evil.com/storage/v1/object/public/x.jpg",
      ),
    ).toBe(false);
    expect(
      isSupabaseStoragePublicUrl(
        "http://jwccyndyaamodxjtjtfo.supabase.co/storage/v1/object/public/x.jpg",
      ),
    ).toBe(false);
    expect(
      isSupabaseStoragePublicUrl(
        `${BASE_URL}/storage/v1/object/sign/attires-product-drafts/x.jpg?token=abc`,
      ),
    ).toBe(false);
  });

  it("renders a Storage URL as-is instead of through /_next/image", () => {
    // Regression: with remotePatterns empty, the optimizer rejects
    // Supabase hosts, so an optimized render throws (dev/test) or 400s
    // (production) and published photos never display.
    const html = renderToStaticMarkup(
      createElement(SmartImage, {
        src: storageUrl,
        alt: "Front view",
        fill: true,
        sizes: "100vw",
      }),
    );
    expect(html).toContain(storageUrl);
    expect(html).not.toContain("/_next/image");
  });

  it("still optimizes local product photos", () => {
    const html = renderToStaticMarkup(
      createElement(SmartImage, {
        src: "/inventory/thrift-shirts/AA-SHIRT-001-front.jpg",
        alt: "Shirt",
        fill: true,
        sizes: "100vw",
      }),
    );
    expect(html).toContain("/_next/image");
  });

  it("keeps serving local SVGs unoptimized", () => {
    const html = renderToStaticMarkup(
      createElement(SmartImage, {
        src: "/placeholder.svg",
        alt: "",
        width: 64,
        height: 64,
      }),
    );
    expect(html).toContain("/placeholder.svg");
    expect(html).not.toContain("/_next/image");
  });
});

describe("ProductGallery render", () => {
  const three: ProductImage[] = [
    { src: "/one.jpg", alt: "One" },
    { src: "/two.jpg", alt: "Two" },
    { src: "/three.jpg", alt: "Three" },
  ];

  it("renders thumbnails, main images and navigation for N images", () => {
    const html = renderToStaticMarkup(
      createElement(ProductGallery, { images: three, productName: "Shirt" }),
    );
    expect(html).toContain("Show image 1 of 3");
    expect(html).toContain("Show image 2 of 3");
    expect(html).toContain("Show image 3 of 3");
    expect(html).toContain('alt="One"');
    expect(html).toContain('alt="Two"');
    expect(html).toContain('alt="Three"');
    // Main-gallery arrows are labelled "slide": they navigate images
    // plus the optional video slide (the zoom modal keeps image-only
    // "Previous/Next image" labels). Renamed by the video-slide work.
    expect(html).toContain('aria-label="Previous slide"');
    expect(html).toContain('aria-label="Next slide"');
    expect(html).toContain('aria-label="Open zoomed image"');
  });

  it("renders a single image without prev/next navigation", () => {
    const html = renderToStaticMarkup(
      createElement(ProductGallery, {
        images: [{ src: "/only.jpg", alt: "Only" }],
        productName: "Shirt",
      }),
    );
    expect(html).toContain("Show image 1 of 1");
    expect(html).toContain('alt="Only"');
    expect(html).not.toContain('aria-label="Previous image"');
    expect(html).not.toContain('aria-label="Next image"');
    expect(html).toContain('aria-label="Open zoomed image"');
  });

  it("renders an honest empty state instead of an empty box", () => {
    const html = renderToStaticMarkup(
      createElement(ProductGallery, { images: [], productName: "Shirt" }),
    );
    expect(html).toContain("No photo available for this product.");
    expect(html).not.toContain('aria-label="Open zoomed image"');
    expect(html).not.toContain("Show image");
  });

  it("renders Supabase Storage gallery URLs as-is", () => {
    const storageImages: ProductImage[] = MEDIA_PATHS.map((path, i) => ({
      src: publishedMediaPublicUrl(BASE_URL, path)!,
      alt: `View ${i + 1}`,
    }));
    const html = renderToStaticMarkup(
      createElement(ProductGallery, {
        images: storageImages,
        productName: "Sample Oxford Shirt",
      }),
    );
    for (const image of storageImages) {
      expect(html).toContain(image.src);
    }
    expect(html).not.toContain("/_next/image");
  });
});
