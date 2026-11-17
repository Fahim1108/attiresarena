import { Notice } from "@/components/admin/ui";
import { PasswordForm } from "@/components/admin/settings/password-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import { changeOwnPassword } from "@/lib/admin/account";
import { requireStaff } from "@/lib/admin/authorization";

export default async function PasswordSettingsPage() {
  await requireStaff();

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Change password"
          description="Change your own staff account password."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Settings
          </p>
        </PageHeader>
        <Notice kind="info">
          Enter your current password first — it is checked before anything
          changes, and a wrong current password leaves your password
          untouched. After changing, sign in again on other devices with the
          new password.
        </Notice>
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">New password</CardTitle>
          </CardHeader>
          <CardContent>
            <PasswordForm action={changeOwnPassword} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
