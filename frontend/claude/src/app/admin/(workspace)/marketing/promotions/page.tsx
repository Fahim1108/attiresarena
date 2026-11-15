import Link from "next/link";
import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import { BannerList } from "@/components/admin/content/banner-list";
import { BannerForm } from "@/components/admin/content/forms";
import {
  CustomCodeForm,
  MarketingSettingsForm,
  SmsSecretForm,
} from "@/components/admin/marketing/forms";
import { getBanners, saveBanner } from "@/lib/admin/content";
import { isOwner, requireStaff } from "@/lib/admin/authorization";
import {
  getSmsSecretStatus,
  getStoreSettingsMap,
  removeSmsSecret,
  saveCustomCode,
  saveMarketingSettings,
  saveSmsSecret,
} from "@/lib/admin/settings";

export default async function PromotionsPage() {
  const session = await requireStaff();
  const owner = isOwner(session);
  // Settings loaders require the owner-only settings area and redirect
  // other staff, so they run only for owners; everyone else sees the
  // banner campaigns below. `undefined` = not an owner, `null` = failed.
  const [banners, settings, smsSecretConfigured] = await Promise.all([
    getBanners(),
    owner ? getStoreSettingsMap() : Promise.resolve(undefined),
    owner ? getSmsSecretStatus().catch(() => null) : Promise.resolve(null),
  ]);
  const promos = (banners ?? []).filter((banner) => banner.placement === "promo");

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Marketing"
        title="Promotions"
        description="Promotional banners, tracking integrations and SMS marketing. Coupon campaigns live under Coupons."
      />
      <Panel title="Coupon campaigns">
        <p>
          Coupons are managed under{" "}
          <Link href="/admin/sales/coupons">Sales → Coupons</Link>, including
          the first-order rule. This page does not duplicate coupon
          management.
        </p>
      </Panel>
      {settings === undefined ? (
        <Notice kind="info">
          Tracking, SMS and custom-code settings can only be changed by the
          owner. Banner campaigns below are available to you.
        </Notice>
      ) : settings === null ? (
        <Notice kind="warning">
          Marketing settings could not be loaded. Banner campaigns below
          still work; tracking and SMS settings need the settings tables.
          Try again later.
        </Notice>
      ) : (
        <>
          <Panel
            title="Tracking and SMS marketing"
            description="Meta Pixel, Google Analytics and SMS provider settings. Tracking code loads only when an ID is saved."
          >
            <MarketingSettingsForm action={saveMarketingSettings} settings={settings} />
          </Panel>
          <Panel
            title="SMS secret"
            description="The provider API key or secret. Stored write-only and never shown again."
          >
            <SmsSecretForm
              action={saveSmsSecret}
              removeAction={removeSmsSecret}
              secretConfigured={smsSecretConfigured}
            />
          </Panel>
          <Panel
            title="Custom header and footer code"
            description="Owner-only. Code saved here runs on every storefront page."
          >
            {owner ? (
              <CustomCodeForm action={saveCustomCode} settings={settings} />
            ) : (
              <Notice kind="info">
                Custom code can only be changed by the owner. Ask the owner
                to save or remove header and footer code.
              </Notice>
            )}
          </Panel>
        </>
      )}
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
