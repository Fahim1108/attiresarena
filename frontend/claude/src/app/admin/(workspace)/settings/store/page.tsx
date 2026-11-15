import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import { StoreSettingsForm } from "@/components/admin/settings/forms";
import { getStoreSettingsMap, saveStoreSettings } from "@/lib/admin/settings";

export default async function StoreSettingsPage() {
  const settings = await getStoreSettingsMap();

  return (
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Settings"
        title="Store settings"
        description="Contact details, social links and footer text. Only owners can change settings."
      />
      <Notice kind="info">
        Saved values apply on the next page load once the storefront wiring
        for the footer and contact page reads them. Nothing here changes
        products, prices or checkout.
      </Notice>
      {settings === null ? (
        <Notice kind="warning">
          Settings could not be loaded. Try again later.
        </Notice>
      ) : (
        <Panel title="Contact, socials and footer">
          <StoreSettingsForm action={saveStoreSettings} settings={settings} />
        </Panel>
      )}
    </main>
  );
}
