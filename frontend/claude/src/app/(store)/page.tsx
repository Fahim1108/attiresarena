import type { Metadata } from "next";
import { HomepageView } from "@/components/home/HomepageView";
import { OrganizationJsonLd } from "@/components/seo/JsonLd";
import { buildPageMetadata, parsePageSeoOverride, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";
import { getActiveHomepageWidgets, getStorefrontContent, resolveSeoDefaultDescription, resolveSeoDefaultTitle, settingText } from "@/lib/store-settings";
import { getProducts, getCollection, getBrands, getCategories, getHomepageProducts, getStorefrontSettings } from "@/services";

export async function generateMetadata(): Promise<Metadata> {
  const [content, s] = await Promise.all([getStorefrontContent(), getStorefrontSettings()]);
  const override = parsePageSeoOverride(content?.settings?.["seo_page_overrides"], "home");
  if (!override) {
    // No override: inherit the layout default title/description/OG wholesale
    // (a page-level openGraph object would REPLACE the layout's, so only the
    // canonical is added here) and add only the root canonical.
    return { alternates: { canonical: "/" } };
  }
  // A home title override replaces the WHOLE title (absolute): the layout
  // default title already carries the site name, so routing the override
  // through the `%s | Site` template would duplicate it. The full OG set is
  // emitted (a page-level openGraph replaces the layout's), honouring the
  // stored OG-specific title/description for sharing.
  const settings = content?.settings ?? null;
  return buildPageMetadata({
    siteName: s.siteName,
    path: "/",
    title: override.title
      ? { absolute: override.title }
      : { absolute: resolveSeoDefaultTitle(s.siteName, settings) },
    description: override.description ?? resolveSeoDefaultDescription(s.description, settings),
    defaultImage: resolveDefaultOgImage(settings, s.logo.badge, s.siteName),
    ogTitle: settingText(settings, "seo_og_title") ?? undefined,
    ogDescription: settingText(settings, "seo_og_description") ?? undefined,
    twitterCard: resolveTwitterCard(settings) ?? "summary_large_image",
  });
}

export default async function HomePage() {
  const [settings, categories, brands, candidates, newArrivals, featured, catalogue, widgets] = await Promise.all([
    getStorefrontSettings(), getCategories(), getBrands(), getHomepageProducts(), getCollection('new-arrivals'), getCollection('featured'), getProducts({pageSize:500}), getActiveHomepageWidgets(),
  ]);
  // A failed data call is not an empty collection: show the honest
  // unavailable state instead of "coming soon". A genuinely empty
  // catalogue (data call succeeded, zero products) keeps "coming soon".
  const catalogueUnavailable = catalogue.catalogueUnavailable === true && catalogue.items.length === 0;
  return <><OrganizationJsonLd />{catalogue.items.length > 0 && <h1 className="sr-only">Attires Arena — Thrift Shirts in Bangladesh</h1>}<HomepageView settings={settings} data={{ sizingProducts:catalogue.items, categories, brands, candidates, newArrivals, featured, bestSellers: [] }} widgets={widgets} />{catalogueUnavailable ? <section className="container py-12 text-center" aria-labelledby="catalogue-unavailable" data-catalogue-unavailable><h1 id="catalogue-unavailable" className="text-balance font-display text-3xl text-primary">The catalogue is temporarily unavailable</h1><p className="mt-3 text-ink-muted">We could not load the collection just now. Please try again in a moment.</p></section> : !catalogue.items.length&&<section className="container py-12 text-center" aria-labelledby="collection-coming-soon" data-catalogue-empty><h1 id="collection-coming-soon" className="text-balance font-display text-3xl text-primary">Our collection is coming soon</h1><p className="mt-3 text-ink-muted">We’re preparing our next collection. Products will appear here once their details and availability are verified.</p></section>}</>;
}
