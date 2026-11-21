import Link from "next/link";
import { Notice } from "@/components/admin/ui";
import { BannerList } from "@/components/admin/content/banner-list";
import { BannerForm } from "@/components/admin/content/forms";
import {
  CustomCodeForm,
  MarketingSettingsForm,
} from "@/components/admin/marketing/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import { getBanners, saveBanner } from "@/lib/admin/content";
import { isOwner, requireStaff } from "@/lib/admin/authorization";
import {
  getStoreSettingsMap,
  saveCustomCode,
  saveMarketingSettings,
} from "@/lib/admin/settings";

export default async function PromotionsPage() {
  const session = await requireStaff();
  const owner = isOwner(session);
  // Settings loaders require the owner-only settings area and redirect
  // other staff, so they run only for owners; everyone else sees the
  // banner campaigns below. `undefined` = not an owner, `null` = failed.
  const [banners, settings] = await Promise.all([
    getBanners(),
    owner ? getStoreSettingsMap() : Promise.resolve(undefined),
  ]);
  const promos = (banners ?? []).filter((banner) => banner.placement === "promo");

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Promotions"
          description="Promotional banners and tracking integrations. Coupon campaigns live under Coupons."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Marketing
          </p>
        </PageHeader>
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Coupon campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-admin-text">
              Coupons are managed under{" "}
              <Link href="/admin/sales/coupons">Sales → Coupons</Link>, including
              the first-order rule. This page does not duplicate coupon
              management.
            </p>
          </CardContent>
        </Card>
        {settings === undefined ? (
          <Notice kind="info">
            Tracking and custom-code settings can only be changed by the
            owner. Banner campaigns below are available to you.
          </Notice>
        ) : settings === null ? (
          <Notice kind="warning">
            Marketing settings could not be loaded. Banner campaigns below
            still work; tracking settings need the settings tables.
            Try again later.
          </Notice>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Tracking</CardTitle>
                <CardDescription>
                  Meta Pixel and Google Analytics settings. Tracking code loads only when an ID is saved.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MarketingSettingsForm action={saveMarketingSettings} settings={settings} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Custom header and footer code</CardTitle>
                <CardDescription>
                  Owner-only. Code saved here runs on every storefront page.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {owner ? (
                  <CustomCodeForm action={saveCustomCode} settings={settings} />
                ) : (
                  <Notice kind="info">
                    Custom code can only be changed by the owner. Ask the owner
                    to save or remove header and footer code.
                  </Notice>
                )}
              </CardContent>
            </Card>
          </>
        )}
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Add promotional banner</CardTitle>
          </CardHeader>
          <CardContent>
            <BannerForm action={saveBanner} defaultPlacement="promo" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Promotional banners</CardTitle>
          </CardHeader>
          <CardContent>
            {banners === null ? (
              <Notice kind="warning">Banners could not be loaded. Try again later.</Notice>
            ) : (
              <BannerList
                banners={promos}
                emptyTitle="No promotional banners yet"
                emptyDescription="Add a promotional banner above. Promotional banners replace the built-in promotions on the next page load; a banner whose image cannot be served is skipped."
                editHref={(id) => `/admin/content/banners?edit=${id}`}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
