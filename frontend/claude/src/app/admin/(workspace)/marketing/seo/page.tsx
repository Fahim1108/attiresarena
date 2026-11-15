import Link from "next/link";
import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import {
  SeoExtendedForm,
  SeoSettingsForm,
} from "@/components/admin/marketing/forms";
import { BrandImageForm } from "@/components/admin/settings/forms";
import {
  clearBrandImage,
  getStoreSettingsMap,
  saveSeoExtendedSettings,
  saveSeoSettings,
  settingString,
  signedStorageUrl,
  uploadBrandImage,
} from "@/lib/admin/settings";

export default async function SeoPage() {
  const settings = await getStoreSettingsMap();
  const socialPath = settingString(settings, "seo_social_image_path");
  const socialUrl = await signedStorageUrl(socialPath || null);

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Marketing"
        title="SEO settings"
        description="Default titles, descriptions, sharing previews, robots and sitemap choices."
      />
      <Notice kind="info">
        Saved SEO values apply to page metadata on the next page load.
        Tracking integrations (Meta Pixel, Google Analytics) live under{" "}
        <Link href="/admin/marketing/promotions">Promotions</Link>. Only
        owners can change settings.
      </Notice>
      {settings === null ? (
        <Notice kind="warning">
          Settings could not be loaded. Try again later.
        </Notice>
      ) : (
        <>
          <Panel title="Titles and descriptions">
            <SeoSettingsForm action={saveSeoSettings} settings={settings} />
          </Panel>
          <Panel
            title="Sharing, robots and sitemap"
            description="Keywords, Open Graph sharing, Twitter cards, canonical URL, search-engine robots and sitemap choices."
          >
            <SeoExtendedForm action={saveSeoExtendedSettings} settings={settings} />
          </Panel>
          <Panel
            title="Social sharing image"
            description="The image shown when a store link is shared. Stored privately; shown here via a signed URL."
          >
            <BrandImageForm
              action={uploadBrandImage}
              clearAction={clearBrandImage}
              kind="social"
              label="Social sharing image"
              currentUrl={socialUrl}
              hasCurrent={Boolean(socialPath)}
            />
          </Panel>
        </>
      )}
    </main>
  );
}
