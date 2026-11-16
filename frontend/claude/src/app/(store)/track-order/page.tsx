import type { Metadata } from "next";
import { logo, site } from "@/config";
import { buildPageMetadata, PRIVATE_PAGE_ROBOTS, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { TrackOrderForm } from "@/components/account/TrackOrderForm";
import { Breadcrumbs } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getStorefrontContent();
  return buildPageMetadata({ siteName: site.name, path: "/track-order", title: "Track Order", defaultImage: resolveDefaultOgImage(content?.settings, logo.badge, site.name), twitterCard: resolveTwitterCard(content?.settings) ?? "summary_large_image", robots: PRIVATE_PAGE_ROBOTS });
}

export default function TrackOrderPage() {
  return (
    <div className="container max-w-3xl py-6 sm:py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Track Order" }]} />
      <h1 className="mt-4 text-balance font-serif text-4xl text-ink sm:text-5xl">Track your order</h1>
      <p className="mb-8 mt-2 text-sm text-ink-muted">Enter the order number from your confirmation message.</p>
      <TrackOrderForm />
    </div>
  );
}
