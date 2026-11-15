import Link from "next/link";
import { PageHeading, Panel, StatusBadge, Notice } from "@/components/admin/ui";
import { AnnouncementForm } from "@/components/admin/content/forms";
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
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Content"
        title="Homepage content"
        description="Announcement bar, hero slides and homepage sections."
      />
      <Notice kind="info">
        Saved settings apply on the next page load once the storefront
        wiring for that setting is connected. The announcement bar and hero
        slides are stored here; their storefront rendering is connected
        through the shared storefront settings, which this module does not
        modify. Policy-page text (see Pages) already applies on the next
        page load.
      </Notice>
      <Panel
        title="Announcement bar"
        description="The message shown above the header on desktop and tablet."
      >
        <AnnouncementForm
          action={saveAnnouncementBar}
          initialText={announcement?.text ?? fallbackText}
          initialVisible={announcement?.visible ?? header.announcement.enabled}
        />
      </Panel>
      <Panel
        title="Hero slides"
        description="Hero banners in display order. Manage images, links and visibility under Banners."
        actions={
          <Link className="aa-row-action" href="/admin/content/banners">
            Manage banners
          </Link>
        }
      >
        {banners === null ? (
          <Notice kind="warning">Banners could not be loaded. Try again later.</Notice>
        ) : heroBanners.length === 0 ? (
          <p className="aa-muted">
            No hero banners are saved yet, so the storefront shows its
            built-in campaign slides. Add a banner to replace them.
          </p>
        ) : (
          <ul>
            {heroBanners.map((banner, index) => (
              <li key={banner.id}>
                {index + 1}. {banner.title}{" "}
                <StatusBadge tone={banner.visible ? "success" : "neutral"}>
                  {banner.visible ? "Visible" : "Hidden"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel
        title="Homepage sections"
        description="Section order and visibility are defined in the storefront code and change with a deployment. They are shown here read-only so the current layout is visible in one place."
      >
        <ul>
          {homepageSections.map((section) => (
            <li key={section.id}>
              {section.adminLabel}{" "}
              <StatusBadge tone={section.enabled ? "success" : "neutral"}>
                {section.enabled ? "Enabled" : "Disabled"}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  );
}
