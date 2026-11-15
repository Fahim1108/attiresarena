import Link from "next/link";
import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import {
  ContactDetailsForm,
  GeneralDisplayForm,
  StoreNameForm,
} from "@/components/admin/settings/forms";
import {
  getStoreSettingsMap,
  saveGeneralDisplaySettings,
  saveStoreSettings,
} from "@/lib/admin/settings";

export default async function GeneralSettingsPage() {
  const settings = await getStoreSettingsMap();

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Settings"
        title="General settings"
        description="Store name, contact details and display preferences. Only owners can change settings."
      />
      <Notice kind="info">
        SEO defaults and per-page overrides live under{" "}
        <Link href="/admin/marketing/seo">Marketing → SEO settings</Link>.
        Nothing on this page changes products, prices or checkout.
      </Notice>
      {settings === null ? (
        <Notice kind="warning">
          Settings could not be loaded. Try again later.
        </Notice>
      ) : (
        <>
          <Panel title="Store name">
            <StoreNameForm action={saveStoreSettings} settings={settings} />
          </Panel>
          <Panel title="Contact details">
            <ContactDetailsForm action={saveStoreSettings} settings={settings} />
          </Panel>
          <Panel
            title="Display preferences"
            description="Currency and timezone labels and the low-stock threshold display value. Display-only: these do not change prices, dates or inventory behaviour."
          >
            <GeneralDisplayForm
              action={saveGeneralDisplaySettings}
              settings={settings}
            />
          </Panel>
        </>
      )}
    </main>
  );
}
