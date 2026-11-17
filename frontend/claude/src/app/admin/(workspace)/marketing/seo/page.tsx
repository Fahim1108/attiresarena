import Link from "next/link";
import { Notice } from "@/components/admin/ui";
import {
  SeoExtendedForm,
  SeoSettingsForm,
} from "@/components/admin/marketing/forms";
import { BrandImageForm } from "@/components/admin/settings/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
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
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="SEO settings"
          description="Default titles, descriptions, sharing previews, robots and sitemap choices."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Marketing
          </p>
        </PageHeader>
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
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Titles and descriptions</CardTitle>
              </CardHeader>
              <CardContent>
                <SeoSettingsForm action={saveSeoSettings} settings={settings} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Sharing, robots and sitemap</CardTitle>
                <CardDescription>
                  Keywords, Open Graph sharing, Twitter cards, canonical URL, search-engine robots and sitemap choices.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SeoExtendedForm action={saveSeoExtendedSettings} settings={settings} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Social sharing image</CardTitle>
                <CardDescription>
                  The image shown when a store link is shared. Stored privately; shown here via a signed URL.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BrandImageForm
                  action={uploadBrandImage}
                  clearAction={clearBrandImage}
                  kind="social"
                  label="Social sharing image"
                  currentUrl={socialUrl}
                  hasCurrent={Boolean(socialPath)}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
