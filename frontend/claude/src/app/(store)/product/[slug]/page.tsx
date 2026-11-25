import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductDetailClient } from "@/components/product/ProductDetailClient";
import { ProductDeliveryInfo } from "@/components/product/ProductDeliveryInfo";
import { ProductSizeProvider, SameSizeRecommendations } from "@/components/product/ProductSizeContext";
import { ReviewList } from "@/components/product/ReviewList";
import { ProductJsonLd } from "@/components/seo/JsonLd";
import { Accordion, Breadcrumbs } from "@/components/ui";
import { commerce, logo, site } from "@/config";
import { officialShirtSizeGuide } from "@/config/shirt-size-guide";
import { readOwnReview } from "@/lib/customer/reviews";
import { customerSession } from "@/lib/customer/session";
import { buildPageMetadata, mergeSeoKeywords, resolveDefaultOgImage, resolveEntitySeo, resolveGlobalKeywords, resolveTwitterCard } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { getBrands, getCategories, getProductBySlug, getProducts, getReviews, getSizeGuide } from "@/services";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Public inventory is read live; an empty draft catalogue must not freeze dynamic fallback routes.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const [product, content] = await Promise.all([getProductBySlug((await params).slug), getStorefrontContent()]);
  if (!product) return {};
  // Stored SEO values win when the feed carries them (SEO-7); otherwise
  // name + shortDescription/description, exactly as before.
  const seo = resolveEntitySeo(product, {
    name: product.name,
    description: product.shortDescription || product.description,
  });
  const image = product.defaultImages[0];
  return buildPageMetadata({
    siteName: site.name,
    path: `/product/${product.slug}`,
    title: seo.title,
    ...(seo.description ? { description: seo.description } : {}),
    // Page keywords replace the layout globals, so the entity keywords
    // carry the globals along (deduped, capped).
    keywords: mergeSeoKeywords(resolveGlobalKeywords(content?.settings), seo.keywords),
    image: image ? { url: image.src, alt: image.alt } : null,
    defaultImage: resolveDefaultOgImage(content?.settings, logo.badge, site.name),
    twitterCard: resolveTwitterCard(content?.settings) ?? "summary_large_image",
  });
}

export default async function ProductPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const sp = await searchParams;
  const [brands, categories, reviews, related, sizeGuide, session] = await Promise.all([
    getBrands(),
    getCategories(),
    getReviews(product.id),
    getProducts({pageSize:500, inStock:true}).then(r=>r.items),
    product.sizeGuideId ? getSizeGuide(product.sizeGuideId) : Promise.resolve(null),
    // React.cache dedupes with the header menu's session read. The
    // session prop is advisory (the proxy does not refresh customer
    // sessions on product pages); the review action authenticates
    // inside itself and is authoritative.
    customerSession(),
  ]);
  // The author's own review (any status) is a separate prop: it must
  // never feed the approved list, the average/count, or JSON-LD.
  const ownReview = session ? await readOwnReview(session.client, product.id) : null;
  const reviewRating={average:reviews.length?reviews.reduce((sum,r)=>sum+r.rating,0)/reviews.length:0,count:reviews.length};
  const brand = brands.find((b) => b.id === product.brandId);
  const category = categories.find((c) => c.id === product.categoryId);
  // Size guide lives in its own section below the accordion (item 12:
  // the old details accordion is gone) — no button, no modal.
  // Stored guide wins; shirts fall back to the official shirt guide.
  const effectiveSizeGuide = sizeGuide ?? (product.categoryId === "cat-shirts" ? officialShirtSizeGuide : null);
  const breadcrumbItems = [
    { label: "Home", href: "/" },
    ...(category ? [{ label: category.name, href: `/category/${category.slug}` }] : []),
    { label: product.name },
  ];

  return (
    <ProductSizeProvider product={product}><div className="pb-10">
      <div className="container pt-5 sm:pt-8">
        <ProductJsonLd product={product} reviews={reviews} brandName={brand?.name} breadcrumbs={breadcrumbItems} currentPath={`/product/${product.slug}`} />
        <Breadcrumbs
          items={breadcrumbItems}
        />
        <div className="mt-5">
          <ProductDetailClient product={{...product,rating:reviewRating}} brandName={brand?.name} initialColorId={typeof sp.color === "string" ? sp.color : undefined} sizeGuide={effectiveSizeGuide} />
        </div>

        {product.reviewOnly&&<section className="mt-8 rounded-card border border-line p-5" aria-labelledby="review-details"><h2 id="review-details" className="font-serif text-2xl">Product details</h2><p className="mt-3 whitespace-pre-line">{product.description}</p>{product.details.length>0&&<ul className="mt-3 list-disc space-y-1 pl-5">{product.details.map(detail=><li key={detail}>{detail}</li>)}</ul>}<p className="mt-3 text-xs text-ink-muted">Preview only. Saving details does not verify or publish this garment.</p></section>}
        <div className="mt-14 grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
          {!product.reviewOnly && (
          <Accordion
            defaultOpen={["description"]}
            items={[
              { id: "description", title: "Description", content: <p>{product.description}</p> },
              {
                id: "delivery",
                title: "Delivery & Returns",
                content: (
                  <p>
                    Cash on Delivery is available across Bangladesh. You can check the item before paying the rider. Unused items with tags can be returned or exchanged within {commerce.returnWindowDays} days.
                  </p>
                ),
              },
            ]}
          />
          )}
          <ProductDeliveryInfo className={product.reviewOnly ? "lg:col-start-2" : undefined} />
        </div>
        <div className="mt-16">
          <ReviewList reviews={reviews} signedIn={session !== null} ownReview={ownReview} productId={product.id} />
        </div>

        <SameSizeRecommendations product={product} candidates={related} brands={brands}/>
      </div>
    </div></ProductSizeProvider>
  );
}
