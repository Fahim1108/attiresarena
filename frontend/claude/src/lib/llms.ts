import "server-only";
import { site } from "@/config/brand";
import { parseSeoRobots, parseSeoSitemap } from "@/lib/admin/settings-shared";
import {
  buildLlmsTxt,
  resolveIndexingPolicy,
  resolveSeoBaseUrl,
} from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { isProductionStorefront } from "@/lib/storefront-policy";
import { getCategories } from "@/services";
import { browsableShirts } from "@/services/adapters/owner-catalogue";

/**
 * Shared loader for /llms.txt (full: false) and /llms-full.txt
 * (full: true). Same gating as the sitemap, in the same order:
 * environment gate FIRST (Preview/dev serves the minimal no-content
 * response without reading feeds), then the shared indexing policy
 * (production + toggle OFF also serves the minimal response). Only
 * production + indexing ON lists the real published catalogue, from
 * the SAME feed as the sitemap (`browsableShirts({ liveReview: false })`
 * + `getCategories()`), so an llms.txt URL can never 404-gate or
 * advertise a fixture. The sitemap inclusion toggles gate this file
 * too (review fix S1): parseSeoSitemap is read the same way
 * src/app/sitemap.ts reads it, and includeProducts / includeCategories
 * off omits that whole section — unparsable/missing toggles list
 * neither, the same null = all-off rule as the sitemap builder.
 */
async function loadLlmsText(full: boolean): Promise<string> {
  if (!isProductionStorefront()) {
    return buildLlmsTxt({
      baseUrl: site.url,
      allowed: false,
      products: [],
      categories: [],
    });
  }
  const content = await getStorefrontContent();
  const policy = resolveIndexingPolicy({
    isProduction: true,
    robots: parseSeoRobots(content?.settings?.["seo_robots"]),
  });
  if (!policy.sitemapAllowed) {
    return buildLlmsTxt({
      baseUrl: site.url,
      allowed: false,
      products: [],
      categories: [],
    });
  }
  const toggles = parseSeoSitemap(content?.settings?.["seo_sitemap"]);
  const [products, categories] = await Promise.all([
    browsableShirts({ liveReview: false }),
    getCategories(),
  ]);
  return buildLlmsTxt({
    baseUrl: resolveSeoBaseUrl(content?.settings, site.url),
    allowed: true,
    products: products.map((product) => ({
      slug: product.slug,
      name: product.name,
      price: product.price,
      description: product.shortDescription || product.description,
      reviewOnly: product.reviewOnly,
    })),
    categories: categories.map((category) => ({
      slug: category.slug,
      name: category.name,
      available: category.available,
    })),
    includeProducts: toggles?.includeProducts ?? false,
    includeCategories: toggles?.includeCategories ?? false,
    full,
  });
}

/** Plain-text response for an llms route: `full` selects llms-full.txt. */
export async function llmsResponse(full: boolean): Promise<Response> {
  const text = await loadLlmsText(full);
  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
