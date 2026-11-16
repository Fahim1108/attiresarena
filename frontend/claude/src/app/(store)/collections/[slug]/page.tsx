import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { logo, site } from "@/config";
import { ProductGrid } from "@/components/product/ProductGrid";
import { BreadcrumbJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs, SectionHeading } from "@/components/ui";
import { selectHomepageCollections } from "@/lib/merchandising";
import { buildPageMetadata, PRIVATE_PAGE_ROBOTS, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { getCollection, getBrands, getProducts, getHomepageProducts, getStorefrontSettings } from "@/services";

// Collections are public listings: they follow the global indexing toggle
// (no forced noindex) and each carries its own title so collection pages
// never share the layout default title. Titles mirror the page's own H1s.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const content = await getStorefrontContent();
  const twitterCard = resolveTwitterCard(content?.settings) ?? "summary_large_image";
  const defaultImage = resolveDefaultOgImage(content?.settings, logo.badge, site.name);
  const path = `/collections/${slug}`;
  if (slug === "winter") {
    const result = await getProducts({ collection: "winter", inStock: true, pageSize: 100 });
    if (result.catalogueUnavailable === true && !result.items.length) {
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
    if (!result.items.length) {
      return buildPageMetadata({
        siteName: site.name,
        path,
        title: "Winter Collection — Coming Soon",
        description: "We're expanding our collection. Stay tuned.",
        defaultImage,
        twitterCard,
      });
    }
    const image = result.items[0]?.defaultImages[0];
    return buildPageMetadata({
      siteName: site.name,
      path,
      title: "Winter Collection",
      image: image ? { url: image.src, alt: image.alt } : null,
      defaultImage,
      twitterCard,
    });
  }
  const [settings, candidates] = await Promise.all([getStorefrontSettings(), getHomepageProducts()]);
  const section = settings.homepage.find(s => s.id === slug && s.enabled && ["new-arrivals", "featured", "trending", "most-popular"].includes(s.type));
  if (!section) return {};
  const products = slug === "new-arrivals" || slug === "featured"
    ? await getCollection(slug)
    : selectHomepageCollections(settings.homepage, candidates).get(section.id) ?? [];
  if (!products.length) return {};
  const image = products[0]?.defaultImages[0];
  return buildPageMetadata({
    siteName: site.name,
    path,
    title: section.title ?? section.adminLabel,
    ...(section.subtitle ? { description: section.subtitle } : {}),
    image: image ? { url: image.src, alt: image.alt } : null,
    defaultImage,
    twitterCard,
  });
}

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if(slug==='winter'){
    const [result,brands]=await Promise.all([getProducts({collection:'winter',inStock:true,pageSize:100}),getBrands()]);
    if(result.catalogueUnavailable===true&&!result.items.length) return <div className="container py-16 text-center"><SectionHeading as="h1" title="Catalogue unavailable"/><p>The catalogue could not be loaded. Please try again in a moment.</p></div>;
    if(!result.items.length) return <div className="container py-16 text-center"><SectionHeading as="h1" title="Coming Soon"/><p>We&apos;re expanding our collection. Stay tuned.</p></div>;
    return <div className="container py-8"><SectionHeading as="h1" title="Winter Collection"/><ProductGrid products={result.items} brands={brands} columns={4}/></div>;
  }
  const [settings, candidates, brands] = await Promise.all([getStorefrontSettings(), getHomepageProducts(), getBrands()]);
  const section = settings.homepage.find(s => s.id === slug && s.enabled && ["new-arrivals", "featured", "trending", "most-popular"].includes(s.type));
  if (!section) notFound();
  const products = slug==='new-arrivals'||slug==='featured'
    ? await getCollection(slug)
    : selectHomepageCollections(settings.homepage, candidates).get(section.id) ?? [];
  if (!products.length) notFound();
  const breadcrumbs = [{ label: "Home", href: "/" }, { label: section.title ?? section.adminLabel }];
  return (
    <div className="container py-8">
      <BreadcrumbJsonLd items={breadcrumbs} currentPath={`/collections/${slug}`} />
      <Breadcrumbs items={breadcrumbs} />
      <SectionHeading as="h1" className="mt-5" title={section.title ?? section.adminLabel} subtitle={section.subtitle} />
      <ProductGrid products={products} brands={brands} columns={4} className="md:!grid-cols-4" />
    </div>
  );
}
