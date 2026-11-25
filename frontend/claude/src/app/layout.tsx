import type { Metadata, Viewport } from "next";
import { motionVariables } from "@/config/motion";

import { ThemeStyle } from "@/components/theme/ThemeStyle";
import { CustomCodeSlot, MarketingScripts } from "@/components/MarketingScripts";
import { CartProvider } from "@/context/CartContext";
import { StorefrontProvider } from "@/context/StorefrontContext";
import { ToastProvider } from "@/context/ToastContext";
import { WishlistProvider } from "@/context/WishlistContext";
import { applyAnnouncementOverride, applyBrandOverride, applyCustomizeOverride, applyFooterLinksOverride, applyFooterOverride, applyNavigationOverride, applySiteNameOverride, getStorefrontContent, parseMarketingSettings, resolveStorefrontMetadata, settingText } from "@/lib/store-settings";
import { SAMPLE_STORE_PHONE } from "@/config/footer";
import { brandMediaUrl } from "@/lib/brand-media-delivery";
import { getInitialCart, getStorefrontSettings, getProducts } from "@/services";
import "@fontsource-variable/cormorant-garamond";
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-bengali";
import "@fontsource-variable/playfair-display";
import "@fontsource/allura/latin-400.css";
import "./globals.css";
import "./motion.css";

// Approved catalogue/cart IDs must be read at request time, not frozen into an empty build snapshot.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const [s, content] = await Promise.all([getStorefrontSettings(), getStorefrontContent()]);
  const siteName = applySiteNameOverride(s.siteName, content?.settings ?? null);
  return resolveStorefrontMetadata(
    { siteName, siteUrl: s.siteUrl, description: s.description, logoBadge: s.logo.badge, faviconUrl: brandMediaUrl(settingText(content?.settings ?? null, "favicon_storage_path")) ?? undefined },
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
  // Stored settings replace the static values field by field; without
  // stored values each override returns the static config unchanged
  // (same reference), so the storefront renders exactly as before.
  // Store name + logo + favicon come from store_settings; navigation,
  // footer links and theme customize come from layout_settings (the
  // anonymous policy must allowlist those keys — see migration
  // 20261119000900 — or the layout read returns empty and the static
  // config is kept). Footer tagline/contact are handled by
  // applyFooterOverride; only the link columns change here.
  // Stored announcement-bar text/visibility replaces the static bar the
  // same way; without a stored value the static bar is unchanged.
  const siteName = applySiteNameOverride(settings.siteName, content?.settings ?? null);
  const logo = applyBrandOverride(settings.logo, content?.settings ?? null, siteName);
  const theme = applyCustomizeOverride(settings.theme, content?.layout ?? null);
  const header = applyNavigationOverride(applyAnnouncementOverride(settings.header, content?.settings ?? null), content?.layout ?? null);
  const footer = applyFooterLinksOverride(applyFooterOverride(settings.footer, content?.settings ?? null), content?.layout ?? null);
  // Client feedback item 8: until the owner saves a real store phone in
  // admin (contact_phone), Preview/staging shows a clearly-marked sample
  // number so the footer design can be reviewed. Production never shows
  // a sample: without a saved number the footer shows no phone at all.
  const footerPhone = footer.contact.phone;
  const footerWithPhone = process.env.VERCEL_ENV === "preview" && (!footerPhone || footerPhone.includes("X"))
    ? { ...footer, contact: { ...footer.contact, phone: SAMPLE_STORE_PHONE } }
    : footer;
  return (
    <html lang="en" >
      <head>
        <ThemeStyle theme={theme} />
        <style>{motionVariables}</style>
      </head>
      <body>
        <CustomCodeSlot code={marketing.headCode} label="header" />
        <MarketingScripts marketing={marketing} />
        <StorefrontProvider settings={{ ...settings, siteName, logo, theme, header, footer: footerWithPhone }}>
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
