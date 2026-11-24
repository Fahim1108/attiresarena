import type { Metadata } from "next";
import { Suspense } from "react";
import { HomepageView } from "@/components/home/HomepageView";
import { Hero } from "@/components/home/Hero";
import { OrganizationJsonLd } from "@/components/seo/JsonLd";
import { CategorySkeleton, ProductGridSkeleton, SizeBrowseSkeleton } from "@/components/ui/LoadingSkeleton";
import { buildPageMetadata, parsePageSeoOverride, resolveDefaultOgImage, resolveHomeOgImage, resolveTwitterCard } from "@/lib/seo";
import { getActiveHomepageWidgets, getStorefrontContent, applyHeroOverride, applyPromoOverride, resolveBannerImageUrls, resolveSeoDefaultDescription, resolveSeoDefaultTitle, settingText } from "@/lib/store-settings";
import { getProducts, getCollection, getBrands, getCategories, getHomepageProducts, getStorefrontSettings } from "@/services";
import type { StorefrontSettings } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const [content, s] = await Promise.all([getStorefrontContent(), getStorefrontSettings()]);
  const settings = content?.settings ?? null;
  const override = parsePageSeoOverride(content?.settings?.["seo_page_overrides"], "home");
  // The homepage ALWAYS emits its full metadata set (it used to return
  // only the canonical when no override existed, inheriting the layout's
  // OG image — the small logo badge — and Google picked the Belt category
  // tile as the search thumbnail instead of a shirt). The values below
  // are the same resolvers the layout uses, so title/description/OG
  // title/description are unchanged; only the share image changes, to
  // the check-shirts photo (a stored seo_og_image_url still wins via
  // resolveHomeOgImage returning null). Robots, keywords, verification
  // and icons still come from the layout (not defined here).
  // A home title override replaces the WHOLE title (absolute): the layout
  // default title already carries the site name, so routing the override
  // through the `%s | Site` template would duplicate it.
  return buildPageMetadata({
    siteName: s.siteName,
    path: "/",
    title: override?.title
      ? { absolute: override.title }
      : { absolute: resolveSeoDefaultTitle(s.siteName, settings) },
    description: override?.description ?? resolveSeoDefaultDescription(s.description, settings),
    image: resolveHomeOgImage(settings),
    defaultImage: resolveDefaultOgImage(settings, s.logo.badge, s.siteName),
    ogTitle: settingText(settings, "seo_og_title") ?? undefined,
    ogDescription: settingText(settings, "seo_og_description") ?? undefined,
    twitterCard: resolveTwitterCard(settings) ?? "summary_large_image",
  });
}

/**
 * HERO SPEED (round 2 — Preview 2026-11-21: blank white ~6s on first
 * load, "Loading categories / sizes / products"): the page used to await
 * the WHOLE catalogue (feed RPCs + categories + collections + widgets)
 * before returning ANY JSX, so the hero — static slides that need no
 * catalogue data — waited for the slowest Supabase call. The hero now
 * renders as soon as its own inputs (settings + stored content) resolve,
 * and everything below it streams in behind Suspense with the same
 * skeletons the route loading state already showed. Measured on the old
 * Preview (curl, this task): homepage TTFB ~4.6s cold / ~1.3–1.7s warm,
 * category page ~2.0s warm, staging Supabase answering an empty 401 in
 * 0.4–1.25s — every Supabase round-trip costs a sizable fraction of a
 * second, and the page was paying for ~10 of them before first paint.
 * The hero still waits for settings + content (unavoidable: stored
 * banners override the static slides), but no longer for the catalogue.
 */
async function HomepageCatalogue({
  settings,
  hero,
  promoBanners,
}: {
  settings: StorefrontSettings;
  hero: StorefrontSettings["hero"];
  promoBanners: StorefrontSettings["promoBanners"];
}) {
  const [categories, brands, candidates, newArrivals, featured, catalogue, widgets] = await Promise.all([
    getCategories(), getBrands(), getHomepageProducts(), getCollection('new-arrivals'), getCollection('featured'), getProducts({pageSize:500}), getActiveHomepageWidgets(),
  ]);
  // A failed data call is not an empty collection: show the honest
  // unavailable state instead of "coming soon". A genuinely empty
  // catalogue (data call succeeded, zero products) keeps "coming soon".
  const catalogueUnavailable = catalogue.catalogueUnavailable === true && catalogue.items.length === 0;
  return <>{catalogue.items.length > 0 && <h1 className="sr-only">Attires Arena — Thrift Shirts in Bangladesh</h1>}<HomepageView settings={{ ...settings, hero, promoBanners, homepage: settings.homepage.filter((s) => s.type !== "hero") }} data={{ sizingProducts:catalogue.items, categories, brands, candidates, newArrivals, featured, bestSellers: [] }} widgets={widgets} />{catalogueUnavailable ? <section className="container py-12 text-center" aria-labelledby="catalogue-unavailable" data-catalogue-unavailable><h1 id="catalogue-unavailable" className="text-balance font-display text-3xl text-primary">The catalogue is temporarily unavailable</h1><p className="mt-3 text-ink-muted">We could not load the collection just now. Please try again in a moment.</p></section> : !catalogue.items.length&&<section className="container py-12 text-center" aria-labelledby="collection-coming-soon" data-catalogue-empty><h1 id="collection-coming-soon" className="text-balance font-display text-3xl text-primary">Our collection is coming soon</h1><p className="mt-3 text-sm text-ink-muted">We’re preparing our next collection. Products will appear here once their details and availability are verified.</p></section>}</>;
}

export default async function HomePage() {
  const [settings, content] = await Promise.all([
    getStorefrontSettings(), getStorefrontContent(),
  ]);
  // Stored hero/promo banners replace the static slides/promotions when
  // their images are displayable; banners whose images cannot be served
  // are skipped, so the built-in slides stay until the banner-media
  // storage policy is applied. No stored banners keeps the static hero.
  const bannerImageUrls = await resolveBannerImageUrls(content?.banners ?? null);
  const bannerImageUrl = (path: string): string | null => bannerImageUrls.get(path) ?? null;
  const hero = applyHeroOverride(settings.hero, content?.banners ?? null, bannerImageUrl);
  const promoBanners = applyPromoOverride(settings.promoBanners, content?.banners ?? null, bannerImageUrl);
  return <><OrganizationJsonLd /><Hero hero={hero} uppercase={settings.theme.typography.headingUppercaseHero} logoSrc={settings.logo.primary} /><Suspense fallback={<div className="container space-y-8 py-8"><CategorySkeleton /><SizeBrowseSkeleton /><ProductGridSkeleton /></div>}><HomepageCatalogue settings={settings} hero={hero} promoBanners={promoBanners} /></Suspense></>;
}
