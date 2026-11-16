import type { Metadata } from "next";
import { logo, site } from "@/config";
import { buildPageMetadata, PRIVATE_PAGE_ROBOTS, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { WishlistView } from "@/components/account/WishlistView";
import { Breadcrumbs } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getStorefrontContent();
  return buildPageMetadata({ siteName: site.name, path: "/wishlist", title: "Wishlist", defaultImage: resolveDefaultOgImage(content?.settings, logo.badge, site.name), twitterCard: resolveTwitterCard(content?.settings) ?? "summary_large_image", robots: PRIVATE_PAGE_ROBOTS });
}

export default function WishlistPage() {
  return (
    <div className="container py-6 sm:py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Wishlist" }]} />
      <h1 className="mt-4 text-balance font-serif text-4xl text-ink sm:text-5xl">Wishlist</h1>
      <p className="mb-8 mt-2 text-sm text-ink-muted">Saved in this browser. Sign in to sync your wishlist across devices.</p>
      <WishlistView />
    </div>
  );
}
