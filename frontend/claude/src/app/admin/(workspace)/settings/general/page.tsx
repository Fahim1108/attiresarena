import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import { StoreNameForm } from "@/components/admin/settings/forms";
import { SeoSettingsForm } from "@/components/admin/marketing/forms";
import {
  getStoreSettingsMap,
  saveSeoSettings,
  saveStoreSettings,
} from "@/lib/admin/settings";

export default async function GeneralSettingsPage() {
  const settings = await getStoreSettingsMap();

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Settings"
        title="General settings"
        description="Store name, SEO defaults and currency. Only owners can change settings."
      />
      {settings === null ? (
        <Notice kind="warning">
          Settings could not be loaded. Try again later.
        </Notice>
      ) : (
        <>
          <Panel title="Store name">
            <StoreNameForm action={saveStoreSettings} settings={settings} />
          </Panel>
          <Panel
            title="SEO defaults"
            description="Defaults used when a page has no override. Per-page overrides are included below."
          >
            <SeoSettingsForm action={saveSeoSettings} settings={settings} />
          </Panel>
        </>
      )}
      <Panel title="Currency">
        <p>
          The store sells in <strong>BDT (Bangladeshi Taka)</strong> only.
          Currency is a fixed storefront fact and cannot be changed here.
        </p>
      </Panel>
    </main>
  );
}
