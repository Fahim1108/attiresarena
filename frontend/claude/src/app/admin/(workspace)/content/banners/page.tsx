import { Notice } from "@/components/admin/ui";
import { LayoutTabs } from "@/components/admin/LayoutTabs";
import { BannerList } from "@/components/admin/content/banner-list";
import { BannerForm } from "@/components/admin/content/forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import { getBanners, saveBanner } from "@/lib/admin/content";

export default async function BannersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : "";
  const banners = await getBanners();
  const editing = (banners ?? []).find((banner) => banner.id === editId);

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Banners"
          description="Hero and promotional banners. Images are stored privately and shown here via signed URLs."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Content
          </p>
        </PageHeader>
        <LayoutTabs current="hero-slider" />
        <Notice kind="info">
          Saved banners apply on the next page load. Hero banners replace
          the built-in slides and promotional banners replace the built-in
          promotions; a banner whose image cannot be served is skipped and
          the built-in content stays.
        </Notice>
        {editing ? (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">{`Edit banner — ${editing.title}`}</CardTitle>
            </CardHeader>
            <CardContent>
              <BannerForm action={saveBanner} banner={editing} defaultPlacement={editing.placement} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Add banner</CardTitle>
            </CardHeader>
            <CardContent>
              <BannerForm action={saveBanner} defaultPlacement="hero" />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">All banners</CardTitle>
          </CardHeader>
          <CardContent>
            {banners === null ? (
              <Notice kind="warning">Banners could not be loaded. Try again later.</Notice>
            ) : (
              <BannerList
                banners={banners}
                emptyTitle="No banners yet"
                emptyDescription="Add a banner above. Until then the storefront shows its built-in slides."
                editHref={(id) => `/admin/content/banners?edit=${id}`}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
