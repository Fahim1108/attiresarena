import Link from "next/link";
import { StatusBadge, Notice } from "@/components/admin/ui";
import { LayoutTabs } from "@/components/admin/LayoutTabs";
import { AnnouncementForm } from "@/components/admin/content/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import { getAnnouncementBarValue, getBanners } from "@/lib/admin/content";
import { saveAnnouncementBar } from "@/lib/admin/settings";
import { header, homepageSections } from "@/config";

export default async function HomepageContentPage() {
  const [announcement, banners] = await Promise.all([
    getAnnouncementBarValue(),
    getBanners(),
  ]);
  const heroBanners = (banners ?? []).filter((banner) => banner.placement === "hero");
  const fallbackText = header.announcement.left ?? "";

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Homepage content"
          description="Announcement bar, hero slides and homepage sections."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Content
          </p>
        </PageHeader>
        <LayoutTabs current="homepage-sections" />
        <Notice kind="info">
          Saved settings apply on the next page load once the storefront
          wiring for that setting is connected. The announcement bar and hero
          slides are stored here; their storefront rendering is connected
          through the shared storefront settings, which this module does not
          modify. Policy-page text (see Pages) already applies on the next
          page load.
        </Notice>
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Announcement bar</CardTitle>
            <CardDescription>
              The message shown above the header on desktop and tablet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AnnouncementForm
              action={saveAnnouncementBar}
              initialText={announcement?.text ?? fallbackText}
              initialVisible={announcement?.visible ?? header.announcement.enabled}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle headingLevel="h2">Hero slides</CardTitle>
              <CardDescription className="mt-1">
                Hero banners in display order. Manage images, links and visibility under Banners.
              </CardDescription>
            </div>
            <Link className="aa-row-action shrink-0" href="/admin/content/banners">
              Manage banners
            </Link>
          </CardHeader>
          <CardContent>
            {banners === null ? (
              <Notice kind="warning">Banners could not be loaded. Try again later.</Notice>
            ) : heroBanners.length === 0 ? (
              <p className="text-sm leading-6 text-admin-text-secondary">
                No hero banners are saved yet, so the storefront shows its
                built-in campaign slides. Add a banner to replace them.
              </p>
            ) : (
              <ol className="list-decimal space-y-2 pl-6 text-sm leading-6">
                {heroBanners.map((banner) => (
                  <li key={banner.id}>
                    {banner.title}{" "}
                    <StatusBadge tone={banner.visible ? "success" : "neutral"}>
                      {banner.visible ? "Visible" : "Hidden"}
                    </StatusBadge>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Homepage sections</CardTitle>
            <CardDescription>
              Section order and visibility are defined in the storefront code and change with a deployment. They are shown here read-only so the current layout is visible in one place.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-6 text-sm leading-6">
              {homepageSections.map((section) => (
                <li key={section.id}>
                  {section.adminLabel}{" "}
                  <StatusBadge tone={section.enabled ? "success" : "neutral"}>
                    {section.enabled ? "Enabled" : "Disabled"}
                  </StatusBadge>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
