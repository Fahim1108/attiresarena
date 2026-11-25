import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { logo, site } from "@/config";
import { CatalogView } from "@/components/catalog/CatalogView";
import { BreadcrumbJsonLd } from "@/components/seo/JsonLd";
import { ButtonLink, SmartImage } from "@/components/ui";
import { parseProductQuery } from "@/lib/catalog-query";
import { subcategoryChipGroup } from "@/lib/category-hierarchy";
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
  // Hierarchy (client feedback 2026-11-24 item 3): inside ANY
  // primary's page its secondaries are selectable sub-options (with
  // live counts); on a secondary's own page an "All <Parent>" chip
  // leads back alongside its siblings. Shirts keeps its canonical
  // deduped list (Casual/Formal/Check); every other category uses
  // its real DB children by parentId (see subcategoryChipGroup).
  const chipGroup = subcategoryChipGroup(category, allCategories);
  const subs = chipGroup?.items ?? [];
  // Chip counts come from the canonical sub-page query itself, not
  // the facets: facets count the same product under every duplicate
  // DB row for a type (raw id match + canonical-key match), so
  // summing them would double-count (Formal 1+1=2 on Preview
  // 2026-11-21). One in-memory query per type over the already
  // memoized feed (no extra Supabase round-trip); the chip count
  // then always equals what the chip links to, on every page —
  // facets on a sub page are computed over the sub-filtered base
  // and would show the other types as 0.
  const subTotals = chipGroup
    ? await Promise.all(
        subs.map((s) =>
          getProducts({ categorySlugs: [s.slug], pageSize: 1 }).then((r) => r.total),
        ),
      )
    : [];
  // "All <Parent>" leads the chips on EVERY page in the group (it
  // was missing on /category/shirts itself). Its count is the full
  // parent total: on a sub-category page the facets are computed
  // over the sub-filtered base, so subCount(parent) there would
  // show the sub count, not the total — one extra in-memory query
  // over the already memoized feed (no extra Supabase round-trip).
  const parentTotal = chipGroup
    ? slug === chipGroup.parent.slug
      ? result.total
      : (await getProducts({ categorySlugs: [chipGroup.parent.slug], pageSize: 1 })).total
    : 0;
  const subcategories = chipGroup
    ? [
        { slug: chipGroup.parent.slug, name: `All ${chipGroup.parent.name}`, count: parentTotal },
        ...subs.map((s, i) => ({ slug: s.slug, name: s.name, count: subTotals[i] ?? 0 })),
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
