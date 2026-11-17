import { notFound } from "next/navigation";
import { staffSession } from "@/lib/admin/access";
import { isProductionStorefront } from "@/lib/storefront-policy";
import { DraftMediaForm } from "@/components/admin/access/DraftMediaForm";
import { Card, CardContent } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";

export default async function DraftMedia() {
  if (isProductionStorefront()) notFound();
  const { roles } = await staffSession();
  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader title="Private draft media">
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Catalog
          </p>
        </PageHeader>
        <Card>
          <CardContent>
            {roles.some((r) => r === "owner" || r === "product_manager") ? (
              <DraftMediaForm />
            ) : (
              <p>Your role cannot upload draft images.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
