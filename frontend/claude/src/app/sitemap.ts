import type { MetadataRoute } from "next";
import { site } from "@/config/brand";
import { policyPages } from "@/content/policies";
import { parseSeoRobots, parseSeoSitemap } from "@/lib/admin/settings-shared";
import {
  buildSitemapEntries,
  resolveIndexingPolicy,
  resolveSeoBaseUrl,
} from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { isProductionStorefront } from "@/lib/storefront-policy";
import { getCategories } from "@/services";
import { browsableShirts } from "@/services/adapters/owner-catalogue";

/**
 * Live sitemap. Dynamic on purpose: it must reflect the stored robots +
 * sitemap toggles and the live catalogue on every fetch — a cached copy
 * would advertise stale URLs. Preview/dev always returns [] (empty
 * sitemap), regardless of the toggles; production with indexing off also
 * returns []. Products come from `browsableShirts({ liveReview: false })`
 * — the SAME feed the proxy 404-gate and product pages use — so a sitemap
 * URL can never 404-gate (SEO-17 slug-universe parity). Review fixtures
 * are filtered out by the builder.
 */
// The route must re-evaluate per request; the feed/settings reads below
// are cache:"no-store", and this flag keeps Next from serving a
// build-time copy.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Environment gate FIRST: never read feeds off-production.
  if (!isProductionStorefront()) return [];
  const content = await getStorefrontContent();
  const policy = resolveIndexingPolicy({
    isProduction: true,
    robots: parseSeoRobots(content?.settings?.["seo_robots"]),
  });
  if (!policy.sitemapAllowed) return [];
  const [products, categories] = await Promise.all([
    browsableShirts({ liveReview: false }),
    getCategories(),
  ]);
  return buildSitemapEntries({
    baseUrl: resolveSeoBaseUrl(content?.settings, site.url),
    toggles: parseSeoSitemap(content?.settings?.["seo_sitemap"]),
    products,
    categories,
    policySlugs: Object.keys(policyPages),
  });
}
