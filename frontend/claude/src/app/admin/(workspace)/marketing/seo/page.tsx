import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import { SeoSettingsForm } from "@/components/admin/marketing/forms";
import { BrandImageForm } from "@/components/admin/settings/forms";
import {
  clearBrandImage,
  getStoreSettingsMap,
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
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Marketing"
        title="SEO settings"
        description="Default titles, descriptions, per-page overrides and the social sharing image."
      />
      <Notice kind="info">
        Saved SEO values apply once the document metadata wiring reads
        them. Only owners can change settings.
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
      <Panel title="Google Analytics">
        <p>
          No analytics integration is configured. A codebase search found no
          Google Analytics, tag manager or measurement ID, so there is no
          tracking field here — a field that did nothing would be
          misleading. Traffic and sales reporting lives under{" "}
          <a href="/admin/analytics">Analytics</a>, built from order data.
        </p>
      </Panel>
    </main>
  );
}
