import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import { PasswordForm } from "@/components/admin/settings/password-form";
import { changeOwnPassword } from "@/lib/admin/account";
import { requireStaff } from "@/lib/admin/authorization";

export default async function PasswordSettingsPage() {
  await requireStaff();

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Settings"
        title="Change password"
        description="Change your own staff account password."
      />
      <Notice kind="info">
        Your session is already verified with your authenticator, so no
        current password is asked here. After changing, sign in again on
        other devices with the new password.
      </Notice>
      <Panel title="New password">
        <PasswordForm action={changeOwnPassword} />
      </Panel>
    </main>
  );
}
