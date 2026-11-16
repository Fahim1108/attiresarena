import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { logo, site } from "@/config";
import { BrandWordmark } from "@/components/brand/BrandCard";
import { CatalogView } from "@/components/catalog/CatalogView";
import { BreadcrumbJsonLd } from "@/components/seo/JsonLd";
import { DemoNotice } from "@/components/ui";
import { parseProductQuery } from "@/lib/catalog-query";
import { buildPageMetadata, PRIVATE_PAGE_ROBOTS, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { getBrandBySlug, getBrands, getProducts } from "@/services";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const [brand, content] = await Promise.all([getBrandBySlug((await params).slug), getStorefrontContent()]);
  if (!brand) return {};
  // Brand pages are demo-only until brands are real: the live adapter
  // returns zero brands, so these pages 404 live. Noindex regardless of
  // the global toggle; revisit when real brands exist.
  return buildPageMetadata({
    siteName: site.name,
    path: `/brand/${brand.slug}`,
    title: brand.name,
    ...(brand.description ? { description: brand.description } : {}),
    image: brand.logo ? { url: brand.logo.src, alt: brand.logo.alt } : null,
    defaultImage: resolveDefaultOgImage(content?.settings, logo.badge, site.name),
    robots: PRIVATE_PAGE_ROBOTS,
    twitterCard: resolveTwitterCard(content?.settings) ?? "summary_large_image",
  });
}

export default async function BrandPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const query = { ...parseProductQuery(await searchParams), brandSlugs: [slug] };
  const [result, brands] = await Promise.all([getProducts(query), getBrands()]);
  const breadcrumbs = [{ label: "Home", href: "/" }, { label: "Brands", href: "/brands" }, { label: brand.name }];
  return (
    <>
      <BreadcrumbJsonLd items={breadcrumbs} currentPath={`/brand/${slug}`} />
      <CatalogView
      title={brand.name}
      breadcrumbs={breadcrumbs}
      query={query}
      result={result}
      brands={brands}
      locked={{ brand: slug }}
      banner={
        <div className="mt-6 space-y-3">
          <div className="flex h-28 items-center justify-center rounded-card border border-line bg-[#FAF9F8] sm:h-36">
            <BrandWordmark brand={brand} className="text-3xl sm:text-5xl" />
          </div>
          <DemoNotice>Demonstration brand page. Brand names are sample entries and do not represent confirmed inventory, authorised resale or partnerships.</DemoNotice>
        </div>
      }
      />
    </>
  );
}
