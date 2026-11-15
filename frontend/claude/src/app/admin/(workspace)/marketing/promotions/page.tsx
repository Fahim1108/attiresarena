import Link from "next/link";
import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import { BannerList } from "@/components/admin/content/banner-list";
import { BannerForm } from "@/components/admin/content/forms";
import { getBanners, saveBanner } from "@/lib/admin/content";

export default async function PromotionsPage() {
  const banners = await getBanners();
  const promos = (banners ?? []).filter((banner) => banner.placement === "promo");

  return (
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Marketing"
        title="Promotions"
        description="Promotional banner campaigns. Coupon campaigns live under Coupons."
      />
      <Panel title="Coupon campaigns">
        <p>
          Coupons are managed under{" "}
          <Link href="/admin/sales/coupons">Sales → Coupons</Link>, including
          the first-order rule. This page does not duplicate coupon
          management.
        </p>
      </Panel>
      <Panel title="Add promotional banner">
        <BannerForm action={saveBanner} defaultPlacement="promo" />
      </Panel>
      <Panel title="Promotional banners">
        {banners === null ? (
          <Notice kind="warning">Banners could not be loaded. Try again later.</Notice>
        ) : (
          <BannerList
            banners={promos}
            emptyTitle="No promotional banners yet"
            emptyDescription="Add a promotional banner above. Promotional banners are stored here and apply once the storefront wiring reads them."
            editHref={(id) => `/admin/content/banners?edit=${id}`}
          />
        )}
      </Panel>
    </main>
  );
}
