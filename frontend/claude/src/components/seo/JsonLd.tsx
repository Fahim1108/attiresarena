import { site } from "@/config/brand";
import { faqs } from "@/content/policies";
import {
  breadcrumbJsonLd,
  canonicalUrl,
  faqJsonLd,
  organizationJsonLd,
  productJsonLd,
  resolveSeoBaseUrl,
} from "@/lib/seo";
import { getStorefrontContent, settingText } from "@/lib/store-settings";
import type { Product, Review } from "@/types";

/**
 * JSON-LD structured data (SEO-4). Server components only: the async ones
 * read stored settings for the canonical base / social links, reusing the
 * page's own data for everything else (no new feed reads). All output is
 * real data only — never invented reviews, prices, or social handles.
 * Review-only (design-preview) products never get Product markup.
 */

/** Escape script-breaking characters; JSON parsers decode the escapes. */
function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(data) }}
    />
  );
}

async function seoBaseUrl(): Promise<string> {
  const content = await getStorefrontContent();
  return resolveSeoBaseUrl(content?.settings, site.url);
}

/** Organization markup for the homepage. sameAs uses stored social links only (valid http(s) URLs); the static "#" placeholders are never emitted. description uses the stored seo_default_description, else the owner-approved site description (brand.ts) — never invented. */
export async function OrganizationJsonLd() {
  const content = await getStorefrontContent();
  const base = resolveSeoBaseUrl(content?.settings, site.url);
  const sameAs: string[] = [];
  for (const key of ["social_facebook", "social_instagram", "social_youtube", "social_tiktok"]) {
    const href = settingText(content?.settings, key);
    if (href !== null && /^https?:\/\//.test(href)) sameAs.push(href);
  }
  const description =
    settingText(content?.settings, "seo_default_description") ?? site.description;
  return (
    <JsonLd
      data={organizationJsonLd({
        name: site.name,
        url: canonicalUrl(base, "/"),
        logoUrl: canonicalUrl(base, "/brand/logo-maroon.png"),
        sameAs,
        description,
      })}
    />
  );
}

/** BreadcrumbList matching the visible Breadcrumbs on the page. Items use the same {label, href} shape; the current page resolves via currentPath. */
export async function BreadcrumbJsonLd({
  items,
  currentPath,
}: {
  items: Array<{ label: string; href?: string }>;
  currentPath: string;
}) {
  const base = await seoBaseUrl();
  return (
    <JsonLd
      data={breadcrumbJsonLd(
        items.map((item) => ({
          name: item.label,
          url: canonicalUrl(base, item.href ?? currentPath),
        })),
      )}
    />
  );
}

/** Product + BreadcrumbList markup for product pages. Renders nothing for review-only products. */
export async function ProductJsonLd({
  product,
  reviews,
  brandName,
  breadcrumbs,
  currentPath,
}: {
  product: Product;
  reviews: Review[];
  brandName?: string;
  breadcrumbs: Array<{ label: string; href?: string }>;
  currentPath: string;
}) {
  const base = await seoBaseUrl();
  const absolute = (src: string): string =>
    /^https?:\/\//.test(src) ? src : canonicalUrl(base, src);
  return (
    <>
      {product.reviewOnly !== true && (
        <JsonLd
          data={productJsonLd({
            name: product.name,
            description: product.shortDescription || product.description,
            imageUrls: product.defaultImages.map((image) => absolute(image.src)),
            url: canonicalUrl(base, currentPath),
            price: product.price,
            inStock: product.variants.some((variant) => variant.stock > 0),
            brandName: brandName ?? null,
            reviews,
          })}
        />
      )}
      <JsonLd
        data={breadcrumbJsonLd(
          breadcrumbs.map((item) => ({
            name: item.label,
            url: canonicalUrl(base, item.href ?? currentPath),
          })),
        )}
      />
    </>
  );
}

/** FAQPage markup from the same static FAQ content the page renders. */
export function FaqJsonLd() {
  return <JsonLd data={faqJsonLd(faqs)} />;
}
