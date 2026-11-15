import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import { BannerList } from "@/components/admin/content/banner-list";
import { BannerForm } from "@/components/admin/content/forms";
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
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Content"
        title="Banners"
        description="Hero and promotional banners. Images are stored privately and shown here via signed URLs."
      />
      <Notice kind="info">
        Banner order and visibility are stored here. Hero slides on the
        storefront render through the shared storefront settings, which this
        module does not modify, so saved banners apply once that wiring is
        connected.
      </Notice>
      {editing ? (
        <Panel title={`Edit banner — ${editing.title}`}>
          <BannerForm action={saveBanner} banner={editing} defaultPlacement={editing.placement} />
        </Panel>
      ) : (
        <Panel title="Add banner">
          <BannerForm action={saveBanner} defaultPlacement="hero" />
        </Panel>
      )}
      <Panel title="All banners">
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
      </Panel>
    </main>
  );
}
