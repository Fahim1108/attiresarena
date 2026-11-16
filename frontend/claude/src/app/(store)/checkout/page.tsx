import type { Metadata } from "next";
import { logo, site } from "@/config";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { buildPageMetadata, PRIVATE_PAGE_ROBOTS, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { Breadcrumbs } from "@/components/ui";
import { getManualPaymentConfiguration } from "@/services";
import { checkoutOrdersEnabled } from "@/lib/checkout/config";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getStorefrontContent();
  return buildPageMetadata({ siteName: site.name, path: "/checkout", title: "Checkout", defaultImage: resolveDefaultOgImage(content?.settings, logo.badge, site.name), twitterCard: resolveTwitterCard(content?.settings) ?? "summary_large_image", robots: PRIVATE_PAGE_ROBOTS });
}

export default async function CheckoutPage() {
  const configuration = await getManualPaymentConfiguration();
  return (
    <div className="container py-6 sm:py-8">
      <Breadcrumbs items={[{ label: "Cart", href: "/cart" }, { label: "Checkout" }]} />
      <h1 className="mb-6 mt-4 text-balance font-serif text-4xl text-ink sm:text-5xl">Checkout</h1>
      <CheckoutForm manualPaymentConfiguration={configuration} orderingEnabled={checkoutOrdersEnabled()} />
    </div>
  );
}
