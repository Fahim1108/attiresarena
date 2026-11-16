import type { Metadata } from "next";
import { logo, site } from "@/config";
import { BrandCard } from "@/components/brand/BrandCard";
import { buildPageMetadata, PRIVATE_PAGE_ROBOTS, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { Breadcrumbs, ButtonLink, DemoNotice, EmptyState } from "@/components/ui";
import { getBrands, getProducts } from "@/services";

// The brands index is noindex for the same demo-only reason as the
// brand pages: brand listings are demonstration entries only until
// brands are real; revisit when real brands exist.
export async function generateMetadata(): Promise<Metadata> {
  const content = await getStorefrontContent();
  return buildPageMetadata({ siteName: site.name, path: "/brands", title: "Brands", description: "Brand listings will appear here once the collection is ready.", defaultImage: resolveDefaultOgImage(content?.settings, logo.badge, site.name), twitterCard: resolveTwitterCard(content?.settings) ?? "summary_large_image", robots: PRIVATE_PAGE_ROBOTS });
}

export default async function BrandsPage() {
  const [brands, all] = await Promise.all([getBrands(), getProducts({ pageSize: 1 })]);
  const counts = Object.fromEntries(all.facets.brands.map((b) => [b.slug, b.count]));
  return (
    <div className="container py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Brands" }]} />
      <h1 className="mt-4 text-balance font-serif text-4xl text-ink sm:text-5xl">Shop by Brand</h1>
      <DemoNotice className="mt-4 max-w-2xl">Brand listings are demonstration entries only. They do not represent confirmed inventory, authorised resale or official partnerships.</DemoNotice>
      {brands.length ? (
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {brands.map((b) => (
            <li key={b.id}>
              <BrandCard brand={b} productCount={counts[b.slug] ?? 0} className="h-28 sm:h-32" />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No brands available"
          description="Brand listings will appear here once the collection is ready."
          action={<ButtonLink href="/shop">Browse products</ButtonLink>}
        />
      )}
    </div>
  );
}
