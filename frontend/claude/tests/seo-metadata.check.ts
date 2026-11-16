import { describe, it, expect } from "vitest";
import {
  breadcrumbJsonLd,
  buildPageMetadata,
  buildSitemapEntries,
  extractRowSeoFields,
  faqJsonLd,
  hasListingParams,
  mergeSeoKeywords,
  organizationJsonLd,
  parseGoogleVerification,
  parsePageSeoOverride,
  productJsonLd,
  resolveDefaultOgImage,
  resolveEntitySeo,
  resolveGlobalKeywords,
  resolveTwitterCard,
  SEO_OG_LOCALE,
} from "../src/lib/seo";

describe("parsePageSeoOverride (SEO-6)", () => {
  it("returns the stored override for the requested slug", () => {
    expect(
      parsePageSeoOverride(
        { shop: { title: "  Shop Thrift  ", description: "Best shirts." }, home: { title: "Home", description: "" } },
        "shop",
      ),
    ).toEqual({ title: "Shop Thrift", description: "Best shirts." });
  });

  it("returns null when the slug has no entry", () => {
    expect(parsePageSeoOverride({ home: { title: "Home", description: "" } }, "shop")).toBe(null);
    expect(parsePageSeoOverride({}, "about")).toBe(null);
    expect(parsePageSeoOverride(null, "contact")).toBe(null);
    expect(parsePageSeoOverride("nope", "home")).toBe(null);
  });

  it("empty/whitespace fields degrade to no override, never blanking", () => {
    expect(parsePageSeoOverride({ shop: { title: "   ", description: "" } }, "shop")).toBe(null);
    expect(parsePageSeoOverride({ shop: { title: "Only Title", description: "  " } }, "shop")).toEqual({
      title: "Only Title",
    });
  });

  it("ignores non-string fields", () => {
    expect(parsePageSeoOverride({ shop: { title: 42, description: ["x"] } }, "shop")).toBe(null);
  });
});

describe("resolveTwitterCard", () => {
  it("returns the stored card when valid", () => {
    expect(resolveTwitterCard({ seo_twitter_card: "summary" })).toBe("summary");
    expect(resolveTwitterCard({ seo_twitter_card: "summary_large_image" })).toBe("summary_large_image");
  });

  it("returns null for absent or invalid values", () => {
    expect(resolveTwitterCard({})).toBe(null);
    expect(resolveTwitterCard(null)).toBe(null);
    expect(resolveTwitterCard({ seo_twitter_card: "app" })).toBe(null);
  });
});

describe("resolveEntitySeo (SEO-7 single render rule)", () => {
  const fallback = { name: "Oxford Shirt", description: "A crisp shirt." };

  it("falls back byte-identically when no SEO data flows", () => {
    expect(resolveEntitySeo({}, fallback)).toEqual({ title: "Oxford Shirt", description: "A crisp shirt." });
    expect(resolveEntitySeo({ seoTitle: null, seoDescription: null, metaKeywords: null }, fallback)).toEqual({
      title: "Oxford Shirt",
      description: "A crisp shirt.",
    });
    expect(resolveEntitySeo({ seoTitle: "   ", seoDescription: "" }, fallback)).toEqual({
      title: "Oxford Shirt",
      description: "A crisp shirt.",
    });
  });

  it("uses trimmed SEO values when present", () => {
    expect(
      resolveEntitySeo(
        { seoTitle: "  Best Oxford Shirt  ", seoDescription: "  Finest cotton.  " },
        fallback,
      ),
    ).toEqual({ title: "Best Oxford Shirt", description: "Finest cotton." });
  });

  it("truncates only SEO-sourced values at the wider 160/320 caps", () => {
    const resolved = resolveEntitySeo(
      { seoTitle: "t".repeat(200), seoDescription: "d".repeat(400) },
      fallback,
    );
    expect(resolved.title).toBe("t".repeat(160));
    expect(resolved.description).toBe("d".repeat(320));
    // Fallbacks pass through untouched (byte-identical fallback rule).
    const longFallback = { name: "n".repeat(200), description: "x".repeat(400) };
    expect(resolveEntitySeo({}, longFallback)).toEqual({ title: "n".repeat(200), description: "x".repeat(400) });
  });

  it("renders every value legal under either write cap in full", () => {
    // Legacy thrift caps 70/160 and admin-panel caps 160/320 both fit.
    expect(resolveEntitySeo({ seoTitle: "t".repeat(70) }, fallback).title).toHaveLength(70);
    expect(resolveEntitySeo({ seoTitle: "t".repeat(160) }, fallback).title).toHaveLength(160);
    expect(resolveEntitySeo({ seoDescription: "d".repeat(160) }, fallback).description).toHaveLength(160);
    expect(resolveEntitySeo({ seoDescription: "d".repeat(320) }, fallback).description).toHaveLength(320);
  });

  it("parses keywords from the admin-panel shape only, capped at 20", () => {
    expect(
      resolveEntitySeo({ metaKeywords: "shirts, Dhaka, , thrift  ,shirts" }, fallback).keywords,
    ).toEqual(["shirts", "Dhaka", "thrift", "shirts"]);
    const many = Array.from({ length: 25 }, (_, i) => `k${i}`).join(",");
    expect(resolveEntitySeo({ metaKeywords: many }, fallback).keywords).toHaveLength(20);
    expect(resolveEntitySeo({ metaKeywords: "   " }, fallback).keywords).toBeUndefined();
    expect(resolveEntitySeo({}, fallback).keywords).toBeUndefined();
  });
});

describe("extractRowSeoFields", () => {
  it("extracts trimmed SEO fields leniently, never failing a row", () => {
    expect(
      extractRowSeoFields(
        { seo_title: "  T  ", seo_description: "D", meta_keywords: "a,b" },
        { keywords: true },
      ),
    ).toEqual({ seoTitle: "T", seoDescription: "D", metaKeywords: "a,b" });
    expect(extractRowSeoFields({}, { keywords: true })).toEqual({
      seoTitle: null,
      seoDescription: null,
      metaKeywords: null,
    });
    expect(
      extractRowSeoFields({ seo_title: 42, seo_description: "", meta_keywords: null }, { keywords: true }),
    ).toEqual({ seoTitle: null, seoDescription: null, metaKeywords: null });
  });

  it("never extracts keywords for thrift rows", () => {
    expect(
      extractRowSeoFields({ seo_title: "T", seo_description: "D", meta_keywords: "a,b" }, { keywords: false }),
    ).toEqual({ seoTitle: "T", seoDescription: "D", metaKeywords: null });
  });
});

describe("parseGoogleVerification (SEO-11)", () => {
  it("accepts a trimmed token", () => {
    expect(parseGoogleVerification("  abcDEF123_-xyz  ")).toBe("abcDEF123_-xyz");
  });

  it("rejects empty, over-long, whitespace-bearing, and markup-bearing values", () => {
    expect(parseGoogleVerification("")).toBe(null);
    expect(parseGoogleVerification("   ")).toBe(null);
    expect(parseGoogleVerification(null)).toBe(null);
    expect(parseGoogleVerification(42)).toBe(null);
    expect(parseGoogleVerification("x".repeat(501))).toBe(null);
    expect(parseGoogleVerification("abc def")).toBe(null);
    expect(parseGoogleVerification('abc"><script')).toBe(null);
    expect(parseGoogleVerification("x".repeat(500))).toBe("x".repeat(500));
  });
});

describe("hasListingParams (SEO-12)", () => {
  it("is false for a clean listing URL", () => {
    expect(hasListingParams({})).toBe(false);
    expect(hasListingParams({ utm_source: "google", fbclid: "x" })).toBe(false);
    expect(hasListingParams({ q: "  " })).toBe(false);
    expect(hasListingParams({ page: undefined })).toBe(false);
  });

  it("is true for any recognized filter/search/sort/page param", () => {
    for (const key of ["q", "category", "brand", "sizes", "shirt", "collection", "available", "min", "max", "sort", "offers", "page"]) {
      expect(hasListingParams({ [key]: "1" })).toBe(true);
    }
    expect(hasListingParams({ sizes: ["M", "L"] })).toBe(true);
    expect(hasListingParams({ page: "1" })).toBe(true);
  });
});

describe("buildSitemapEntries (SEO-2)", () => {
  const base = {
    baseUrl: "https://attiresarena.com",
    products: [
      { slug: "aa-shirt-001", createdAt: "2026-10-24T00:00:00Z" },
      { slug: "fixture-shirt", createdAt: "2026-10-24T00:00:00Z", reviewOnly: true },
      { slug: "dateless-shirt", createdAt: "not-a-date" },
    ],
    categories: [
      { slug: "shirts", available: true },
      { slug: "pants", available: false },
    ],
    policySlugs: ["shipping-policy", "return-policy", "privacy-policy", "terms"],
  };

  it("always includes home, about, contact, and FAQ even with all toggles off", () => {
    const entries = buildSitemapEntries({
      ...base,
      toggles: { includeShop: false, includeCategories: false, includePolicies: false, includeProducts: false },
    });
    expect(entries.map((entry) => entry.url)).toEqual([
      "https://attiresarena.com/",
      "https://attiresarena.com/about",
      "https://attiresarena.com/contact",
      "https://attiresarena.com/faq",
    ]);
    expect(entries[0]?.priority).toBe(1);
  });

  it("treats null toggles as all off", () => {
    expect(buildSitemapEntries({ ...base, toggles: null })).toHaveLength(4);
  });

  it("honours each toggle independently", () => {
    const all = buildSitemapEntries({
      ...base,
      toggles: { includeShop: true, includeCategories: true, includePolicies: true, includeProducts: true },
    });
    const urls = all.map((entry) => entry.url);
    expect(urls).toContain("https://attiresarena.com/shop");
    expect(urls).toContain("https://attiresarena.com/category/shirts");
    expect(urls).not.toContain("https://attiresarena.com/category/pants");
    for (const slug of base.policySlugs) expect(urls).toContain(`https://attiresarena.com/${slug}`);
    expect(urls).toContain("https://attiresarena.com/product/aa-shirt-001");
    expect(urls).toContain("https://attiresarena.com/product/dateless-shirt");
    expect(urls).not.toContain("https://attiresarena.com/product/fixture-shirt");
  });

  it("uses the creation/publication date as lastModified and omits it when unparsable", () => {
    const entries = buildSitemapEntries({
      ...base,
      toggles: { includeShop: false, includeCategories: false, includePolicies: false, includeProducts: true },
    });
    const dated = entries.find((entry) => entry.url.endsWith("/aa-shirt-001"));
    expect(dated?.lastModified).toBe("2026-10-24T00:00:00Z");
    expect(dated?.priority).toBe(0.6);
    const dateless = entries.find((entry) => entry.url.endsWith("/dateless-shirt"));
    expect(dateless?.lastModified).toBeUndefined();
  });

  it("never emits brands, collections, indexes, private paths, or query strings", () => {
    const entries = buildSitemapEntries({
      ...base,
      toggles: { includeShop: true, includeCategories: true, includePolicies: true, includeProducts: true },
    });
    for (const entry of entries) {
      expect(entry.url).not.toContain("?");
      expect(entry.url).not.toMatch(/\/(brand|brands|collections|categories|admin|account|auth|cart|checkout|wishlist|track-order)(\/|$)/);
      expect(entry).not.toHaveProperty("changeFrequency");
    }
  });
});

describe("buildPageMetadata (SEO-5/9/10)", () => {
  const defaultImage = { url: "/brand/logo-badge.jpg", width: 540, height: 540, alt: "Attires Arena" };

  it("emits title, description, canonical, OG, and Twitter with the full rendered title", () => {
    const meta = buildPageMetadata({
      siteName: "Attires Arena",
      path: "/shop",
      title: "Shop",
      description: "Individual thrift shirts, carefully selected.",
      image: { url: "/images/x.jpg", alt: "Shirts" },
      defaultImage,
    });
    expect(meta.title).toBe("Shop");
    expect(meta.description).toBe("Individual thrift shirts, carefully selected.");
    const alternates = meta.alternates as unknown as { canonical?: unknown };
    expect(alternates.canonical).toBe("/shop");
    const og = meta.openGraph as unknown as { siteName?: unknown; title?: unknown; description?: unknown; url?: unknown; locale?: unknown; type?: unknown; images?: Array<{ url?: unknown; alt?: unknown }> };
    expect(og.siteName).toBe("Attires Arena");
    expect(og.title).toBe("Shop | Attires Arena");
    expect(og.description).toBe("Individual thrift shirts, carefully selected.");
    expect(og.url).toBe("/shop");
    expect(og.locale).toBe("en_US");
    expect(og.locale).toBe(SEO_OG_LOCALE);
    expect(og.type).toBe("website");
    expect(og.images).toEqual([{ url: "/images/x.jpg", alt: "Shirts" }]);
    const twitter = meta.twitter as unknown as { card?: unknown; title?: unknown; images?: unknown };
    expect(twitter.card).toBe("summary_large_image");
    expect(twitter.title).toBe("Shop | Attires Arena");
    expect(twitter.images).toEqual(["/images/x.jpg"]);
  });

  it("supports absolute titles (home overrides) without the template suffix", () => {
    const meta = buildPageMetadata({
      siteName: "Attires Arena",
      path: "/",
      title: { absolute: "Custom Home Title" },
      description: "Custom.",
      defaultImage,
    });
    expect(meta.title).toEqual({ absolute: "Custom Home Title" });
    const og = meta.openGraph as unknown as { title?: unknown };
    expect(og.title).toBe("Custom Home Title");
  });

  it("always emits the default image when no page image is given (page OG replaces the layout's)", () => {
    const meta = buildPageMetadata({
      siteName: "Attires Arena",
      path: "/faq",
      title: "FAQ",
      description: "Quick answers.",
      defaultImage,
    });
    const og = meta.openGraph as unknown as { siteName?: unknown; images?: unknown };
    expect(og.siteName).toBe("Attires Arena");
    expect(og.images).toEqual([defaultImage]);
    const twitter = meta.twitter as unknown as { images?: unknown };
    expect(twitter.images).toEqual(["/brand/logo-badge.jpg"]);
  });

  it("honours OG title/description overrides and explicit robots + stored card", () => {
    const meta = buildPageMetadata({
      siteName: "Attires Arena",
      path: "/brand/demo",
      title: "Demo",
      description: "Page description.",
      defaultImage,
      ogTitle: "Share Title",
      ogDescription: "Share description.",
      robots: { index: false, follow: false },
      twitterCard: "summary",
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.description).toBe("Page description.");
    const og = meta.openGraph as unknown as { title?: unknown; description?: unknown; images?: unknown };
    expect(og.title).toBe("Share Title");
    expect(og.description).toBe("Share description.");
    expect(og.images).toEqual([defaultImage]);
    const twitter = meta.twitter as unknown as { card?: unknown; title?: unknown; description?: unknown; images?: unknown };
    expect(twitter.card).toBe("summary");
    expect(twitter.title).toBe("Share Title");
    expect(twitter.description).toBe("Share description.");
    expect(twitter.images).toEqual(["/brand/logo-badge.jpg"]);
  });

  it("emits keywords only when present", () => {
    expect(buildPageMetadata({ siteName: "Attires Arena", path: "/x", title: "X", defaultImage, keywords: ["a"] }).keywords).toEqual(["a"]);
    expect(buildPageMetadata({ siteName: "Attires Arena", path: "/x", title: "X", defaultImage }).keywords).toBeUndefined();
  });
});

describe("resolveDefaultOgImage / resolveGlobalKeywords / mergeSeoKeywords (SEO-10)", () => {
  it("prefers a valid absolute stored OG URL, without guessed dimensions", () => {
    expect(resolveDefaultOgImage({ seo_og_image_url: " https://cdn.example.com/og.jpg " }, "/brand/logo-badge.jpg", "Attires Arena")).toEqual({ url: "https://cdn.example.com/og.jpg" });
  });

  it("falls back to the logo badge with measured dimensions and the site name as alt", () => {
    expect(resolveDefaultOgImage({}, "/brand/logo-badge.jpg", "Attires Arena")).toEqual({ url: "/brand/logo-badge.jpg", width: 540, height: 540, alt: "Attires Arena" });
    expect(resolveDefaultOgImage({ seo_og_image_url: "/relative/path.jpg" }, "/brand/logo-badge.jpg", "Attires Arena")).toEqual({ url: "/brand/logo-badge.jpg", width: 540, height: 540, alt: "Attires Arena" });
    expect(resolveDefaultOgImage(null, "/brand/logo-badge.jpg", "Attires Arena")).toEqual({ url: "/brand/logo-badge.jpg", width: 540, height: 540, alt: "Attires Arena" });
  });

  it("parses global keywords (split, trim, drop empty, cap 20)", () => {
    expect(resolveGlobalKeywords({ seo_keywords: "thrift, shirts,,  vintage " })).toEqual(["thrift", "shirts", "vintage"]);
    expect(resolveGlobalKeywords({})).toEqual([]);
    expect(resolveGlobalKeywords(null)).toEqual([]);
    expect(resolveGlobalKeywords({ seo_keywords: Array.from({ length: 25 }, (_, i) => `k${i}`).join(",") })).toHaveLength(20);
  });

  it("merges global + page keywords, deduped and capped", () => {
    expect(mergeSeoKeywords(["thrift", "shirts"], ["vintage", "thrift"])).toEqual(["thrift", "shirts", "vintage"]);
    expect(mergeSeoKeywords(["a"], undefined)).toEqual(["a"]);
    expect(mergeSeoKeywords([], [])).toEqual([]);
  });
});

describe("JSON-LD builders (SEO-4)", () => {
  it("builds Organization with sameAs only when links exist", () => {
    expect(
      organizationJsonLd({ name: "Attires Arena", url: "https://attiresarena.com/", logoUrl: "https://attiresarena.com/brand/logo-maroon.png", sameAs: [] }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Attires Arena",
      url: "https://attiresarena.com/",
      logo: "https://attiresarena.com/brand/logo-maroon.png",
    });
    const withSocial = organizationJsonLd({
      name: "Attires Arena",
      url: "https://attiresarena.com/",
      logoUrl: "https://attiresarena.com/brand/logo-maroon.png",
      sameAs: ["https://facebook.com/attiresarena"],
    });
    expect(withSocial.sameAs).toEqual(["https://facebook.com/attiresarena"]);
  });

  it("builds Product offers with BDT price and real availability, no SKU", () => {
    const data = productJsonLd({
      name: "Oxford Shirt",
      description: "Crisp.",
      imageUrls: ["https://attiresarena.com/api/product-media/a/b.jpg"],
      url: "https://attiresarena.com/product/oxford",
      price: 550,
      inStock: true,
      brandName: null,
      reviews: [],
    });
    expect(data["@type"]).toBe("Product");
    expect(data.offers).toEqual({
      "@type": "Offer",
      price: 550,
      priceCurrency: "BDT",
      availability: "https://schema.org/InStock",
      url: "https://attiresarena.com/product/oxford",
    });
    expect(data).not.toHaveProperty("sku");
    expect(data).not.toHaveProperty("aggregateRating");
    expect(data).not.toHaveProperty("brand");
    const out = productJsonLd({
      name: "X", description: "", imageUrls: [], url: "https://attiresarena.com/product/x",
      price: 100, inStock: false, reviews: [],
    });
    expect((out.offers as { availability?: unknown }).availability).toBe("https://schema.org/OutOfStock");
    expect(out).not.toHaveProperty("description");
    expect(out).not.toHaveProperty("image");
  });

  it("emits aggregateRating ONLY when real approved reviews exist", () => {
    const data = productJsonLd({
      name: "Oxford Shirt", description: "Crisp.", imageUrls: [],
      url: "https://attiresarena.com/product/oxford", price: 550, inStock: true,
      reviews: [{ rating: 5 }, { rating: 4 }, { rating: 4 }],
    });
    expect(data.aggregateRating).toEqual({ "@type": "AggregateRating", ratingValue: 4.3, reviewCount: 3 });
  });

  it("builds BreadcrumbList with positions and absolute items", () => {
    expect(
      breadcrumbJsonLd([
        { name: "Home", url: "https://attiresarena.com/" },
        { name: "Shirts", url: "https://attiresarena.com/category/shirts" },
      ]),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://attiresarena.com/" },
        { "@type": "ListItem", position: 2, name: "Shirts", item: "https://attiresarena.com/category/shirts" },
      ],
    });
  });

  it("builds FAQPage from the static FAQ groups", () => {
    const data = faqJsonLd([{ items: [{ q: "Q1?", a: "A1." }] }, { items: [{ q: "Q2?", a: "A2." }] }]);
    expect(data["@type"]).toBe("FAQPage");
    expect(data.mainEntity).toEqual([
      { "@type": "Question", name: "Q1?", acceptedAnswer: { "@type": "Answer", text: "A1." } },
      { "@type": "Question", name: "Q2?", acceptedAnswer: { "@type": "Answer", text: "A2." } },
    ]);
  });
});
