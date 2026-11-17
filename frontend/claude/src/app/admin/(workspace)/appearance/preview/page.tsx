import { Notice } from "@/components/admin/ui";
import { Card, CardContent } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import { staffSession } from "@/lib/admin/access";

export default async function AppearanceUnavailable() {
  await staffSession();
  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader title="Appearance management">
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Appearance
          </p>
        </PageHeader>
        <Card>
          <CardContent>
            <Notice kind="warning">
              Unavailable: the preserved design editor has no real CMS
              persistence yet. Storefront settings cannot be published from
              this module.
            </Notice>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
