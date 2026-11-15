import { HomepageView } from "@/components/home/HomepageView";
import { getActiveHomepageWidgets } from "@/lib/store-settings";
import { getProducts, getCollection, getBrands, getCategories, getHomepageProducts, getStorefrontSettings } from "@/services";

export default async function HomePage() {
  const [settings, categories, brands, candidates, newArrivals, featured, catalogue, widgets] = await Promise.all([
    getStorefrontSettings(), getCategories(), getBrands(), getHomepageProducts(), getCollection('new-arrivals'), getCollection('featured'), getProducts({pageSize:500}), getActiveHomepageWidgets(),
  ]);
  // A failed data call is not an empty collection: show the honest
  // unavailable state instead of "coming soon". A genuinely empty
  // catalogue (data call succeeded, zero products) keeps "coming soon".
  const catalogueUnavailable = catalogue.catalogueUnavailable === true && catalogue.items.length === 0;
  return <>{catalogue.items.length > 0 && <h1 className="sr-only">Attires Arena</h1>}<HomepageView settings={settings} data={{ sizingProducts:catalogue.items, categories, brands, candidates, newArrivals, featured, bestSellers: [] }} widgets={widgets} />{catalogueUnavailable ? <section className="container py-12 text-center" aria-labelledby="catalogue-unavailable" data-catalogue-unavailable><h1 id="catalogue-unavailable" className="text-balance font-display text-3xl text-primary">The catalogue is temporarily unavailable</h1><p className="mt-3 text-ink-muted">We could not load the collection just now. Please try again in a moment.</p></section> : !catalogue.items.length&&<section className="container py-12 text-center" aria-labelledby="collection-coming-soon" data-catalogue-empty><h1 id="collection-coming-soon" className="text-balance font-display text-3xl text-primary">Our collection is coming soon</h1><p className="mt-3 text-ink-muted">We’re preparing our next collection. Products will appear here once their details and availability are verified.</p></section>}</>;
}
