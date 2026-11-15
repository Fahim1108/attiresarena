import Script from "next/script";
import type { MarketingSettings } from "@/lib/store-settings";

/**
 * Deferred third-party scripts + owner custom code for the storefront.
 * Server component only. Renders NOTHING when nothing is configured, so
 * an unconfigured store loads zero third-party code.
 *
 * - Meta Pixel: base snippet + PageView, deferred (afterInteractive), only
 *   when a valid pixel ID is stored and the PageView toggle is on. The
 *   other event toggles (ViewContent, AddToCart, InitiateCheckout,
 *   Purchase) are stored configuration; firing them needs event wiring in
 *   the product/cart/checkout components, which is a separate follow-up.
 * - Google Analytics: gtag snippet, deferred (lazyOnload), only when a
 *   valid measurement ID is stored.
 * - Custom code: owner-only slots, rendered verbatim from the SSR stream
 *   (parser-inserted, so scripts run). The header slot renders at the top
 *   of the body stream and the footer slot at the end of the body; neither
 *   is sanitised, by design — see the risk note in the admin UI. Never put
 *   secrets in custom code: it is served on every page.
 */
export function MarketingScripts({
  marketing,
}: {
  marketing: MarketingSettings;
}) {
  const pixelEnabled =
    marketing.pixelId !== null &&
    (marketing.pixelEvents === null || marketing.pixelEvents.PageView);
  return (
    <>
      {pixelEnabled && marketing.pixelId !== null ? (
        <>
          <Script
            id="meta-pixel"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '${marketing.pixelId}');fbq('track', 'PageView');`,
            }}
          />
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              src={`https://www.facebook.com/tr?id=${marketing.pixelId}&ev=PageView&noscript=1`}
              alt=""
            />
          </noscript>
        </>
      ) : null}
      {marketing.gaMeasurementId !== null ? (
        <>
          <Script
            id="google-analytics-src"
            strategy="lazyOnload"
            src={`https://www.googletagmanager.com/gtag/js?id=${marketing.gaMeasurementId}`}
          />
          <Script
            id="google-analytics"
            strategy="lazyOnload"
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${marketing.gaMeasurementId}');`,
            }}
          />
        </>
      ) : null}
    </>
  );
}

export function CustomCodeSlot({
  code,
  label,
}: {
  code: string | null;
  label: string;
}) {
  if (!code) return null;
  return (
    <div
      data-custom-code={label}
      style={{ display: "contents" }}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: code }}
    />
  );
}
