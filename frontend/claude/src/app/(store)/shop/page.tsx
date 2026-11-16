import type { Metadata } from "next";
import { logo, site } from "@/config";
import { CatalogView } from "@/components/catalog/CatalogView";
import { BreadcrumbJsonLd } from "@/components/seo/JsonLd";
import { parseProductQuery } from "@/lib/catalog-query";
import { buildPageMetadata, hasListingParams, LISTING_VARIANT_ROBOTS, parsePageSeoOverride, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { getBrands, getProducts } from "@/services";

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const [content, sp] = await Promise.all([getStorefrontContent(), searchParams]);
  const override = parsePageSeoOverride(content?.settings?.["seo_page_overrides"], "shop");
  return buildPageMetadata({
    siteName: site.name,
    path: "/shop",
    title: override?.title ?? "Shop",
    // Shirts-only reality, in wording already present in the codebase (the
    // live Shirts category description). The old six-category description
    // advertised categories that are coming soon by design.
    description: override?.description ?? "Individual thrift shirts, carefully selected.",
    defaultImage: resolveDefaultOgImage(content?.settings, logo.badge, site.name),
    twitterCard: resolveTwitterCard(content?.settings) ?? "summary_large_image",
    // Filter/search/sort/page variants canonicalize to the clean listing
    // URL (above) and carry noindex — the clean URL is the indexable one.
    ...(hasListingParams(sp) ? { robots: LISTING_VARIANT_ROBOTS } : {}),
  });
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const query = parseProductQuery(await searchParams);
  const [result, brands] = await Promise.all([getProducts(query), getBrands()]);
  const title = query.search ? `Results for “${query.search}”` : query.offers ? "Offers" : query.sort === "newest" ? "New Arrivals" : "All Products";
  const breadcrumbs = [{ label: "Home", href: "/" }, { label: "Shop" }];
  return <>
    <BreadcrumbJsonLd items={breadcrumbs} currentPath="/shop" />
    <CatalogView title={title} breadcrumbs={breadcrumbs} query={query} result={result} brands={brands} />
  </>;
}
