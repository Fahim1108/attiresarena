import type { MetadataRoute } from "next";
import { site } from "@/config/brand";
import { parseSeoRobots } from "@/lib/admin/settings-shared";
import { buildRobots, resolveIndexingPolicy, resolveSeoBaseUrl } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { isProductionStorefront } from "@/lib/storefront-policy";

/**
 * Live robots.txt. Dynamic on purpose: it must reflect the stored robots
 * toggle and the deployment environment on every fetch — a cached copy
 * that ignores a toggle flip would be launch-blocking. Preview/dev always
 * serves Disallow: / with no sitemap reference, regardless of the toggle.
 */
// The route must re-evaluate per request; the settings read below is
// cache:"no-store", and this flag keeps Next from serving a build-time copy.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Environment gate FIRST (symmetric with sitemap.ts): off-production
  // the policy ignores the stored toggle and the body is Disallow: /
  // regardless, so skip the settings read entirely. The returned body
  // is identical to the ungated path's disallow-all output.
  if (!isProductionStorefront()) {
    return buildRobots({
      policy: resolveIndexingPolicy({ isProduction: false, robots: null }),
      baseUrl: site.url,
    });
  }
  const content = await getStorefrontContent();
  const policy = resolveIndexingPolicy({
    isProduction: true,
    robots: parseSeoRobots(content?.settings?.["seo_robots"]),
  });
  return buildRobots({
    policy,
    baseUrl: resolveSeoBaseUrl(content?.settings, site.url),
  });
}
