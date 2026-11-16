import type { Metadata } from "next";
import { logo, site } from "@/config";
import { buildPageMetadata, PRIVATE_PAGE_ROBOTS, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { CartView } from "@/components/cart/CartView";
import { Breadcrumbs } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getStorefrontContent();
  return buildPageMetadata({ siteName: site.name, path: "/cart", title: "Your Cart", defaultImage: resolveDefaultOgImage(content?.settings, logo.badge, site.name), twitterCard: resolveTwitterCard(content?.settings) ?? "summary_large_image", robots: PRIVATE_PAGE_ROBOTS });
}

export default function CartPage() {
  return (
    <div className="container py-6 sm:py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Cart" }]} />
      <h1 className="mb-6 mt-4 text-balance font-serif text-4xl text-ink sm:text-5xl">Your Cart</h1>
      <CartView />
    </div>
  );
}
