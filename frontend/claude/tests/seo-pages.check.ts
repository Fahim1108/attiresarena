import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JsonLd } from "../src/components/seo/JsonLd";
import { PRIVATE_PAGE_ROBOTS, LISTING_VARIANT_ROBOTS } from "../src/lib/seo";

/**
 * Page-level SEO guards (source-level, mirroring hero-section.check.ts):
 * importing page modules would drag in the whole server component tree,
 * so these checks pin the metadata/heading/link wiring in source. Rendered
 * <head> output still needs the live Preview pass (see implementation
 * notes) — these guards prove the wiring exists and stays put.
 */

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const page = (path: string) => read(`../src/app/${path}`);

/**
 * The category generateMetadata coming-soon branch, sliced out of source:
 * from the `available === false` branch to the available-branch SEO
 * resolution. File-level presence of hasListingParams is NOT enough —
 * the guard must prove THIS branch carries the variant check (M1).
 */
function categoryComingSoonBranch(): string {
  const src = page("(store)/category/[slug]/page.tsx");
  const start = src.indexOf("if (category.available === false)");
  const end = src.indexOf("const seo = resolveEntitySeo");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("private pages are noindex in every environment (SEO-8)", () => {
  it("account segments carry noindex at the layout level (covers all 8 account pages)", () => {
    for (const layout of [
      "(store)/account/(auth)/layout.tsx",
      "(store)/account/(dashboard)/layout.tsx",
    ]) {
      const src = page(layout);
      expect(src).toContain("PRIVATE_PAGE_ROBOTS");
      expect(src).toContain("robots: PRIVATE_PAGE_ROBOTS");
    }
    expect(PRIVATE_PAGE_ROBOTS).toEqual({ index: false, follow: false });
  });

  it("order-detail carries its own explicit noindex plus the layout export", () => {
    const src = page("(store)/account/(dashboard)/orders/[orderNumber]/page.tsx");
    expect(src).toContain('title: "Order Details"');
    expect(src).toContain("robots: PRIVATE_PAGE_ROBOTS");
  });

  it("cart, wishlist, track-order, and checkout carry explicit noindex", () => {
    for (const path of ["(store)/cart/page.tsx", "(store)/wishlist/page.tsx", "(store)/track-order/page.tsx", "(store)/checkout/page.tsx"]) {
      expect(page(path)).toContain("robots: PRIVATE_PAGE_ROBOTS");
    }
    // Checkout was tightened: no bare { index: false } without follow:false remains.
    expect(page("(store)/checkout/page.tsx")).not.toContain("robots: { index: false }");
  });

  it("admin tree, motion-preview, and loader-preview stay noindex", () => {
    expect(page("admin/layout.tsx")).toContain("robots: { index: false, follow: false }");
    expect(page("motion-preview/page.tsx")).toContain("robots: { index: false, follow: false }");
    expect(page("loader-preview/page.tsx")).toContain("robots: PRIVATE_PAGE_ROBOTS");
  });
});

describe("public pages carry canonicals + full metadata (SEO-5/9/16)", () => {
  it("home, shop, about, and contact read stored page overrides", () => {
    expect(page("(store)/page.tsx")).toContain('parsePageSeoOverride');
    expect(page("(store)/page.tsx")).toContain('"home"');
    expect(page("(store)/shop/page.tsx")).toContain('"shop"');
    expect(page("(store)/about/page.tsx")).toContain('"about"');
    expect(page("(store)/contact/page.tsx")).toContain('"contact"');
  });

  it("home overrides use an absolute title (no duplicated site name)", () => {
    expect(page("(store)/page.tsx")).toContain("{ absolute: override.title }");
    expect(page("(store)/page.tsx")).toContain("resolveSeoDefaultTitle");
  });

  it("every buildPageMetadata call site passes the resolved default image (page OG replaces the layout's)", () => {
    const paths = [
      "(store)/page.tsx",
      "(store)/shop/page.tsx",
      "(store)/category/[slug]/page.tsx",
      "(store)/brand/[slug]/page.tsx",
      "(store)/collections/[slug]/page.tsx",
      "(store)/product/[slug]/page.tsx",
      "(store)/about/page.tsx",
      "(store)/contact/page.tsx",
      "(store)/faq/page.tsx",
      "(store)/privacy-policy/page.tsx",
      "(store)/return-policy/page.tsx",
      "(store)/shipping-policy/page.tsx",
      "(store)/terms/page.tsx",
      "(store)/brands/page.tsx",
      "(store)/categories/page.tsx",
      "(store)/cart/page.tsx",
      "(store)/wishlist/page.tsx",
      "(store)/track-order/page.tsx",
      "(store)/checkout/page.tsx",
    ];
    for (const path of paths) {
      const src = page(path);
      expect(src).toContain("buildPageMetadata");
      expect(src).toContain("resolveDefaultOgImage");
      expect(src).toContain("defaultImage");
    }
  });

  it("shop and category pages noindex param variants in every listing branch (brand pages are unconditionally noindex, checked separately)", () => {
    const shop = page("(store)/shop/page.tsx");
    expect(shop).toContain("...(hasListingParams(sp) ? { robots: LISTING_VARIANT_ROBOTS } : {})");
    const category = page("(store)/category/[slug]/page.tsx");
    const outageStart = category.indexOf('if (slug === "shirts"');
    const comingSoonStart = category.indexOf("if (category.available === false)");
    const availableStart = category.indexOf("const seo = resolveEntitySeo");
    const metadataEnd = category.indexOf("export default async function CategoryPage");
    expect(outageStart).toBeGreaterThan(0);
    expect(comingSoonStart).toBeGreaterThan(outageStart);
    expect(availableStart).toBeGreaterThan(comingSoonStart);
    expect(metadataEnd).toBeGreaterThan(availableStart);
    // Outage branch: forced noindex regardless of params.
    expect(category.slice(outageStart, comingSoonStart)).toContain("robots: PRIVATE_PAGE_ROBOTS");
    // Coming-soon AND available branches: conditional variant noindex.
    expect(category.slice(comingSoonStart, availableStart)).toContain("...(hasListingParams(sp) ? { robots: LISTING_VARIANT_ROBOTS } : {})");
    expect(category.slice(availableStart, metadataEnd)).toContain("...(hasListingParams(sp) ? { robots: LISTING_VARIANT_ROBOTS } : {})");
    expect(LISTING_VARIANT_ROBOTS).toEqual({ index: false, follow: true });
  });

  it("category coming-soon branch noindexes param variants (M1: /category/pants?page=2 must not be indexable)", () => {
    const branch = categoryComingSoonBranch();
    expect(branch).toContain("...(hasListingParams(sp) ? { robots: LISTING_VARIANT_ROBOTS } : {})");
    // The fix must not change the coming-soon title/description.
    expect(branch).toContain("`${category.name} — Coming Soon`");
    expect(branch).toContain("description: category.description");
  });

  it("brand pages are noindex until brands are real (demo-only)", () => {
    expect(page("(store)/brand/[slug]/page.tsx")).toContain("robots: PRIVATE_PAGE_ROBOTS");
    expect(page("(store)/brand/[slug]/page.tsx")).toContain("demo-only");
    expect(page("(store)/brands/page.tsx")).toContain("robots: PRIVATE_PAGE_ROBOTS");
  });

  it("collections pages get per-collection titles (no shared layout default)", () => {
    const src = page("(store)/collections/[slug]/page.tsx");
    expect(src).toContain("generateMetadata");
    expect(src).toContain("Winter Collection");
    expect(src).toContain("section.title ?? section.adminLabel");
  });

  it("policies, FAQ, and categories carry canonicals via the shared builder", () => {
    for (const path of [
      "(store)/shipping-policy/page.tsx",
      "(store)/return-policy/page.tsx",
      "(store)/privacy-policy/page.tsx",
      "(store)/terms/page.tsx",
      "(store)/faq/page.tsx",
      "(store)/categories/page.tsx",
    ]) {
      expect(page(path)).toContain("buildPageMetadata");
    }
  });

  it("product pages wire stored SEO fields with fallback + canonical", () => {
    const src = page("(store)/product/[slug]/page.tsx");
    expect(src).toContain("resolveEntitySeo(product");
    expect(src).toContain("buildPageMetadata");
    expect(src).toContain("`/product/${product.slug}`");
  });

  it("category coming-soon titles reuse the Coming Soon H1 wording", () => {
    const src = page("(store)/category/[slug]/page.tsx");
    expect(src).toContain("`${category.name} — Coming Soon`");
  });

  it("shop description no longer advertises the six coming-soon categories", () => {
    const src = page("(store)/shop/page.tsx");
    expect(src).not.toContain("pants, sneakers, belts, wallets and watches");
    expect(src).toContain("Individual thrift shirts, carefully selected.");
  });
});

describe("headings (SEO-13)", () => {
  it("home keeps exactly one H1 per branch, with a descriptive populated-branch H1", () => {
    const src = page("(store)/page.tsx");
    expect(src.match(/<h1/g)?.length).toBe(3);
    expect(src).toContain('<h1 className="sr-only">Attires Arena — Thrift Shirts in Bangladesh</h1>');
    expect(src).not.toContain('<h1 className="sr-only">Attires Arena</h1>');
  });

  it("inactive hero slides demote their headings to <p>; side tiles keep <h2>", () => {
    const hero = read("../src/components/home/Hero.tsx");
    expect(hero.match(/const Heading = active \? "h2" : "p";/g)?.length).toBe(2);
    expect(hero).toContain("<Heading");
    expect(hero).toContain("</Heading>");
    // SideTile is always visible (never aria-hidden): its <h2> stays.
    expect(hero).toContain('<h2 className="max-w-[8ch] font-serif text-[30px] leading-[1.05] text-ink xl:text-[36px]">{banner.title}</h2>');
  });
});

describe("pagination links (SEO-12)", () => {
  it("catalog pagination renders real links from the shared URL builder", () => {
    const src = read("../src/components/catalog/Pagination.tsx");
    expect(src).toContain('import Link from "next/link"');
    expect(src).toContain("catalogHref(pathname, applyCatalogPatch(query, { page: p }), locked)");
    expect(src).toContain("<Link");
    expect(src).toContain('aria-current="page"');
    expect(src).not.toContain("<button");
    // Disabled prev/next spans carry no aria-label: it is not announced
    // on a plain span, and the <nav aria-label="Pagination"> labels the
    // control. The <Link> labels above stay.
    expect(src).not.toMatch(/<span[^>]*aria-label=/);
    // No rel="prev"/"next" attributes on the links (deprecated by Google;
    // the word appears only in the explanatory comment).
    expect(src).not.toMatch(/<Link[^>]*\brel=/);
  });
});

describe("category image alt (SEO-15: intentional alt=\"\")", () => {
  it("keeps alt=\"\" where the link's visible text already names the category", () => {
    const card = read("../src/components/category/CategoryCard.tsx");
    expect(card.match(/alt="" fill/g)?.length).toBe(2);
    expect(card).toContain("alt=\"\" is intentional");
    expect(card).toContain("{category.name}");
    const browse = read("../src/components/home/HomeBrowse.tsx");
    expect(browse).toContain('alt=""');
    expect(browse).toContain("alt=\"\" is intentional");
    expect(browse).toContain("{category.name}");
  });

  it("feature tiles (/categories page) use the same thumbnail photo as the homepage, not the vector illustration", () => {
    const card = read("../src/components/category/CategoryCard.tsx");
    expect(card).toContain("category.thumbnail ?? category.image");
    expect(card).toContain('variant === "feature" ? featureImage : category.image');
  });
});

describe("JSON-LD wiring (SEO-4)", () => {
  it("JsonLd escapes script-breaking characters", () => {
    const html = renderToStaticMarkup(
      createElement(JsonLd, { data: { name: "</script><script>alert(1)</script>" } }),
    );
    expect(html).toContain("application/ld+json");
    expect(html).not.toContain("</script><script>");
    expect(html).toContain("\\u003c/script\\u003e");
  });

  it("home renders Organization, product renders Product+BreadcrumbList, FAQ renders FAQPage", () => {
    expect(page("(store)/page.tsx")).toContain("<OrganizationJsonLd />");
    expect(page("(store)/product/[slug]/page.tsx")).toContain("<ProductJsonLd");
    expect(page("(store)/faq/page.tsx")).toContain("<FaqJsonLd />");
  });

  it("listing pages render BreadcrumbList JSON-LD matching their visible breadcrumbs", () => {
    for (const path of [
      "(store)/shop/page.tsx",
      "(store)/category/[slug]/page.tsx",
      "(store)/brand/[slug]/page.tsx",
      "(store)/collections/[slug]/page.tsx",
    ]) {
      expect(page(path)).toContain("BreadcrumbJsonLd");
    }
  });

  it("no VideoObject is emitted anywhere (only a video ID exists)", () => {
    const jsonLd = read("../src/components/seo/JsonLd.tsx");
    expect(jsonLd).not.toContain("VideoObject");
    // seo.ts documents the skip in a comment; assert no VideoObject TYPE is built.
    expect(read("../src/lib/seo.ts")).not.toContain('"VideoObject"');
    expect(read("../src/lib/seo.ts")).not.toContain("videoObjectJsonLd");
  });
});

describe("robots/sitemap route wiring (SEO-2/3)", () => {
  it("sitemap gates on the environment before any feed/settings read and stays dynamic", () => {
    const src = read("../src/app/sitemap.ts");
    expect(src).toContain('export const dynamic = "force-dynamic"');
    expect(src).toContain("resolveIndexingPolicy");
    expect(src).toContain("buildSitemapEntries");
    expect(src).toContain("parseSeoSitemap");
    const body = src.slice(src.indexOf("export default async function sitemap"));
    const gate = body.indexOf("if (!isProductionStorefront()) return [];");
    expect(gate).toBeGreaterThan(0);
    expect(body.indexOf("getStorefrontContent()")).toBeGreaterThan(gate);
    expect(body.indexOf("browsableShirts(")).toBeGreaterThan(gate);
    expect(body.indexOf("getCategories()")).toBeGreaterThan(gate);
  });

  it("robots.txt gates on the environment before the settings read and stays dynamic", () => {
    const src = read("../src/app/robots.ts");
    expect(src).toContain('export const dynamic = "force-dynamic"');
    expect(src).toContain("resolveIndexingPolicy");
    expect(src).toContain("buildRobots");
    expect(src).toContain("parseSeoRobots");
    const body = src.slice(src.indexOf("export default async function robots"));
    const gate = body.indexOf("if (!isProductionStorefront())");
    expect(gate).toBeGreaterThan(0);
    expect(body.indexOf("getStorefrontContent()")).toBeGreaterThan(gate);
  });
});

describe("proxy 404-gate untouched (SEO-17)", () => {
  it("keeps the shared slug-universe gate and its noindex 404 page", () => {
    const proxy = read("../src/proxy.ts");
    expect(proxy).toContain("browsableShirts({liveReview:false})");
    expect(proxy).toContain('<meta name="robots" content="noindex">');
    expect(proxy).toContain("status: 404");
  });
});

describe("homepage share image is the check-shirts photo (home OG fix)", () => {
  it("homepage wires resolveHomeOgImage into buildPageMetadata", () => {
    const src = page("(store)/page.tsx");
    expect(src).toContain("resolveHomeOgImage");
    expect(src).toContain("image: resolveHomeOgImage(settings)");
    // The homepage always emits its full metadata set (no canonical-only
    // branch left to inherit the badge from the layout).
    expect(src).not.toContain('return { alternates: { canonical: "/" } };');
  });

  it("no other page uses the homepage share image (homepage-only)", () => {
    for (const path of [
      "(store)/shop/page.tsx",
      "(store)/product/[slug]/page.tsx",
      "(store)/category/[slug]/page.tsx",
      "(store)/about/page.tsx",
      "(store)/contact/page.tsx",
    ]) {
      const src = page(path);
      expect(src).not.toContain("resolveHomeOgImage");
      expect(src).not.toContain("HOME_OG_IMAGE");
      expect(src).not.toContain("og-home.jpg");
    }
  });

  it("layout default still falls back to the logo badge (other pages unchanged)", () => {
    const src = read("../src/lib/store-settings.ts");
    expect(src).toContain("resolveDefaultOgImage(settings, base.logoBadge, base.siteName)");
  });
});
