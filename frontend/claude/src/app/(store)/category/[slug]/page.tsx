import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { logo, site } from "@/config";
import { CatalogView } from "@/components/catalog/CatalogView";
import { BreadcrumbJsonLd } from "@/components/seo/JsonLd";
import { ButtonLink, SmartImage } from "@/components/ui";
import { parseProductQuery } from "@/lib/catalog-query";
import { isShirtSubcategory, shirtSubcategories } from "@/lib/category-hierarchy";
import { buildPageMetadata, hasListingParams, LISTING_VARIANT_ROBOTS, PRIVATE_PAGE_ROBOTS, resolveDefaultOgImage, resolveEntitySeo, resolveTwitterCard } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { getBrands, getCategories, getCategoryBySlug, getProducts } from "@/services";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: SearchParams }): Promise<Metadata> {
  const [{ slug }, sp, content] = await Promise.all([params, searchParams, getStorefrontContent()]);
  const category = await getCategoryBySlug(slug);
  if (!category) return {};
  const twitterCard = resolveTwitterCard(content?.settings) ?? "summary_large_image";
  const defaultImage = resolveDefaultOgImage(content?.settings, logo.badge, site.name);
  const path = `/category/${slug}`;
  // Honest branch parity with the page: the outage state and the
  // coming-soon state carry matching titles instead of the bare category
  // name. The coming-soon title reuses the page's own "Coming Soon" H1
  // wording; the adapter already supplies "Coming soon." as the
  // description for non-shirt categories.
  // SEO-14-over-SEO-7 precedence: the outage and coming-soon branches
  // intentionally use these honest state titles instead of stored SEO
  // values, which apply only in the available branch below.
  if (slug === "shirts" && category.catalogueUnavailable === true && category.available === false) {
    return buildPageMetadata({
      siteName: site.name,
      path,
      title: "Catalogue unavailable",
      description: "The catalogue could not be loaded. Please try again in a moment.",
      robots: PRIVATE_PAGE_ROBOTS,
      defaultImage,
      twitterCard,
    });
  }
  if (category.available === false) {
    return buildPageMetadata({
      siteName: site.name,
      path,
      title: `${category.name} — Coming Soon`,
      description: category.description,
      defaultImage,
      twitterCard,
      ...(hasListingParams(sp) ? { robots: LISTING_VARIANT_ROBOTS } : {}),
    });
  }
  const seo = resolveEntitySeo(category, { name: category.name, description: category.description });
  return buildPageMetadata({
    siteName: site.name,
    path,
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    image: { url: category.image.src, alt: category.image.alt },
    defaultImage,
    twitterCard,
    ...(hasListingParams(sp) ? { robots: LISTING_VARIANT_ROBOTS } : {}),
  });
}

export default async function CategoryPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();
  const breadcrumbs = [{ label: "Home", href: "/" }, { label: "Categories", href: "/categories" }, { label: category.name }];
  // Shirts only: non-shirt categories show "coming soon" BY DESIGN
  // regardless of feed health, so the unavailable state applies only to
  // the one listing category. A failed feed must not masquerade as an
  // empty Shirts collection.
  if(slug==='shirts'&&category.catalogueUnavailable===true&&category.available===false) return <section className="container animate-dropdown-in py-16 text-center"><h1 className="text-balance font-serif text-4xl text-primary">Catalogue unavailable</h1><p className="mt-4 text-ink-muted">The catalogue could not be loaded. Please try again in a moment.</p><ButtonLink href="/category/shirts" className="mt-6">Try again</ButtonLink></section>;
  if(category.available===false) return <><BreadcrumbJsonLd items={breadcrumbs} currentPath={`/category/${slug}`} /><section className="container animate-dropdown-in py-16 text-center"><h1 className="text-balance font-serif text-4xl text-primary">Coming Soon</h1><p className="mt-4 text-ink-muted">We&apos;re expanding our collection. Stay tuned.</p><ButtonLink href="/category/shirts" className="mt-6">Explore Shirts</ButtonLink></section></>;
  const query = { ...parseProductQuery(await searchParams), categorySlugs: [slug] };
  const [result, brands, allCategories] = await Promise.all([getProducts(query), getBrands(), getCategories()]);
  // Hierarchy: inside Shirts, Casual/Formal/Check are selectable
  // sub-options (with live counts); on a sub-category page an "All
  // Shirts" chip leads back to the full Shirts listing.
  const showShirtTypes = slug === "shirts" || isShirtSubcategory(category);
  const subs = showShirtTypes ? shirtSubcategories(allCategories) : [];
  const subCount = (s: string) => result.facets.categories.find((c) => c.slug === s)?.count ?? 0;
  const subcategories = showShirtTypes
    ? [
        ...(slug === "shirts"
          ? []
          : [{ slug: "shirts", name: "All Shirts", count: subCount("shirts") }]),
        ...subs.map((s) => ({ slug: s.slug, name: s.name, count: subCount(s.slug) })),
      ]
    : undefined;
  return (
    <>
      <BreadcrumbJsonLd items={breadcrumbs} currentPath={`/category/${slug}`} />
      <CatalogView
        title={category.name}
        description={category.description}
        breadcrumbs={breadcrumbs}
        query={query}
        result={result}
        brands={brands}
        locked={{ category: slug }}
        subcategories={subcategories}
        currentSubcategory={slug}
        banner={
          category.banner ? (
            <div className="relative mt-4 aspect-[21/9] overflow-hidden rounded-card">
              <SmartImage
                src={category.banner.src}
                alt={category.name}
                fill
                sizes="(min-width:1024px) 1024px, 100vw"
                className="object-cover"
              />
            </div>
          ) : undefined
        }
      />
    </>
  );
}
