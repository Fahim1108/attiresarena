import Link from "next/link";
import { Notice } from "@/components/admin/ui";
import {
  ContactDetailsForm,
  GeneralDisplayForm,
  StoreNameForm,
} from "@/components/admin/settings/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import {
  getStoreSettingsMap,
  saveGeneralDisplaySettings,
  saveStoreSettings,
} from "@/lib/admin/settings";

export default async function GeneralSettingsPage() {
  const settings = await getStoreSettingsMap();

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="General settings"
          description="Store name, contact details and display preferences. Only owners can change settings."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Settings
          </p>
        </PageHeader>
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
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Store name</CardTitle>
              </CardHeader>
              <CardContent>
                <StoreNameForm action={saveStoreSettings} settings={settings} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Contact details</CardTitle>
              </CardHeader>
              <CardContent>
                <ContactDetailsForm action={saveStoreSettings} settings={settings} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Display preferences</CardTitle>
                <CardDescription>
                  Currency and timezone labels and the low-stock threshold display value. Display-only: these do not change prices, dates or inventory behaviour.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GeneralDisplayForm
                  action={saveGeneralDisplaySettings}
                  settings={settings}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
