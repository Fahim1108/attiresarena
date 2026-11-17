import { Notice } from "@/components/admin/ui";
import { StoreSettingsForm } from "@/components/admin/settings/forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import { getStoreSettingsMap, saveStoreSettings } from "@/lib/admin/settings";

export default async function StoreSettingsPage() {
  const settings = await getStoreSettingsMap();

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Store settings"
          description="Contact details, social links and footer text. Only owners can change settings."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Settings
          </p>
        </PageHeader>
        <Notice kind="info">
          Saved values apply on the next page load — the storefront footer
          and contact details read these settings live. Nothing here changes
          products, prices or checkout.
        </Notice>
        {settings === null ? (
          <Notice kind="warning">
            Settings could not be loaded. Try again later.
          </Notice>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Contact, socials and footer</CardTitle>
            </CardHeader>
            <CardContent>
              <StoreSettingsForm action={saveStoreSettings} settings={settings} />
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
