import type { Metadata, Viewport } from "next";
import { motionVariables } from "@/config/motion";

import { ThemeStyle } from "@/components/theme/ThemeStyle";
import { CustomCodeSlot, MarketingScripts } from "@/components/MarketingScripts";
import { CartProvider } from "@/context/CartContext";
import { StorefrontProvider } from "@/context/StorefrontContext";
import { ToastProvider } from "@/context/ToastContext";
import { WishlistProvider } from "@/context/WishlistContext";
import { applyFooterOverride, getStorefrontContent, parseMarketingSettings, resolveStorefrontMetadata } from "@/lib/store-settings";
import { checkoutOrdersEnabled } from "@/lib/checkout/config";
import { getInitialCart, getStorefrontSettings, getProducts } from "@/services";
import "@fontsource-variable/cormorant-garamond";
import "@fontsource-variable/inter";
import "@fontsource-variable/playfair-display";
import "@fontsource/allura/latin-400.css";
import "./globals.css";
import "./motion.css";

// Approved catalogue/cart IDs must be read at request time, not frozen into an empty build snapshot.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const [s, content] = await Promise.all([getStorefrontSettings(), getStorefrontContent()]);
  return resolveStorefrontMetadata(
    { siteName: s.siteName, siteUrl: s.siteUrl, description: s.description, logoBadge: s.logo.badge },
    content?.settings ?? null,
  );
}

export const viewport: Viewport = {
  themeColor: "#6B0202",
  width: "device-width",
  initialScale: 1,
  // Lets env(safe-area-inset-*) report real values so the fixed bottom nav
  // clears notches and gesture bars; zoom is intentionally left enabled.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [settings, initialCart, catalogue, content] = await Promise.all([getStorefrontSettings(), getInitialCart(), getProducts({pageSize:500}), getStorefrontContent()]);
  const marketing = parseMarketingSettings(content?.settings ?? null);
  // Stored footer values (social links, contact details, about text) replace
  // the static footer field by field; without stored values this returns the
  // static footer unchanged, so the storefront renders exactly as before.
  const footer = applyFooterOverride(settings.footer, content?.settings ?? null);
  return (
    <html lang="en" >
      <head>
        <ThemeStyle theme={settings.theme} />
        <style>{motionVariables}</style>
      </head>
      <body>
        <CustomCodeSlot code={marketing.headCode} label="header" />
        <MarketingScripts marketing={marketing} />
        {!checkoutOrdersEnabled() ? (
          <aside className="design-preview-notice" aria-label="Design preview notice">Our collection is being prepared. Ordering is not yet available.</aside>
        ) : null}
        <StorefrontProvider settings={{ ...settings, footer }}>
          <ToastProvider>
            <WishlistProvider approvedProductIds={catalogue.items.map(p=>p.id)}>
              <CartProvider approvedProducts={catalogue.items} initialItems={initialCart} approvedVariantIds={catalogue.items.flatMap(p=>p.variants.filter(v=>v.stock>0).map(v=>v.id))}>
                <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-white">
                  Skip to content
                </a>
                {children}
              </CartProvider>
            </WishlistProvider>
          </ToastProvider>
        </StorefrontProvider>
        <CustomCodeSlot code={marketing.bodyCode} label="footer" />
      </body>
    </html>
  );
}
