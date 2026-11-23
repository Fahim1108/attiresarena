import { Notice } from "@/components/admin/ui";
import { DeliverySettingsForm, StoreSettingsForm, TestDataEraseForm } from "@/components/admin/settings/forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import { eraseTestData, getStoreSettingsMap, getTestDataEraseCounts, saveDeliverySettings, saveStoreSettings } from "@/lib/admin/settings";

export default async function StoreSettingsPage() {
  const settings = await getStoreSettingsMap();
  const eraseCounts = await getTestDataEraseCounts();

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Store settings"
          description="Contact details, social links, footer text, delivery zones and test data erase. Only owners can change settings."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Settings
          </p>
        </PageHeader>
        <Notice kind="info">
          Saved values apply on the next page load — the storefront footer
          and contact details read these settings live. Delivery settings
          also change the checkout charge and the advance amount.
        </Notice>
        {settings === null ? (
          <Notice kind="warning">
            Settings could not be loaded. Try again later.
          </Notice>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Contact, socials and footer</CardTitle>
              </CardHeader>
              <CardContent>
                <StoreSettingsForm action={saveStoreSettings} settings={settings} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Delivery zones</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-admin-text-secondary">
                  Pick the district that pays the Inside charge and set both
                  charges. The product delivery card, the announcement bar,
                  the checkout charge and the advance amount all follow
                  these values.
                </p>
                <DeliverySettingsForm action={saveDeliverySettings} settings={settings} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Danger zone</CardTitle>
              </CardHeader>
              <CardContent>
                <TestDataEraseForm action={eraseTestData} counts={eraseCounts} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
