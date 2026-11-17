import { formatDateTime } from "@/lib/admin/format";
import {
  deleteSmtpConfig,
  readSmtpStatus,
  saveSmtpConfig,
  sendSmtpTest,
  type SmtpStatus,
} from "@/lib/admin/smtp";
import { Notice, StatusBadge } from "@/components/admin/ui";
import { SmtpSettingsForm } from "@/components/admin/smtp/SmtpSettingsForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import styles from "@/components/admin/sales/sales-refresh.module.css";

export const metadata = { title: "Email (SMTP)" };

function SmtpStatusRow({ status }: { status: SmtpStatus }) {
  if (!status.configured) {
    return (
      <div className={styles.statusRow} role="status">
        <StatusBadge tone="neutral">Not connected</StatusBadge>
        <span className={styles.sectionNote}>
          No SMTP settings are saved. Nothing is sent by email.
        </span>
      </div>
    );
  }
  return (
    <div className={styles.statusRow} role="status">
      <StatusBadge tone={status.enabled ? "success" : "warning"}>
        {status.enabled ? "Connected" : "Connected — email off"}
      </StatusBadge>
      <span className={styles.statusChip}>Password saved (never shown)</span>
      {status.host ? (
        <span className={styles.statusChip}>
          {status.host}:{status.port ?? "—"}
          {status.secure ? " · TLS" : ""}
        </span>
      ) : null}
      {status.from_address ? (
        <span className={styles.statusChip}>From {status.from_address}</span>
      ) : null}
      {status.updated_at ? (
        <span className={styles.statusChip}>Updated {formatDateTime(status.updated_at)}</span>
      ) : null}
    </div>
  );
}

/**
 * SMTP settings page — part of the DISTINCT REMOVABLE SMTP module
 * (keep-or-drop undecided by the owner). Settings + test-send only; no
 * email is wired to checkout or orders. Removal = delete this page +
 * the smtp lib/form files + the nav link + drop the migration.
 */
export default async function SmtpPage() {
  const status = await readSmtpStatus();

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Email (SMTP)"
          description="Connect a mail server so a test email can confirm delivery. Only the store owner can change these settings."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            System
          </p>
        </PageHeader>

        <Notice kind="warning">
          This email module is under review — whether to keep it has not been
          decided yet. No order or customer email is sent automatically: the
          only email this panel can send is the test email below.
        </Notice>

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">SMTP settings</CardTitle>
            <CardDescription>
              The password is stored as a secret and is never shown again. Saving replaces the whole configuration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status === null ? (
              <>
                <Notice kind="warning">
                  SMTP settings could not be loaded. The database setup for
                  SMTP may not be applied yet. Saving or testing will fail
                  until it is.
                </Notice>
                <SmtpSettingsForm
                  status={null}
                  saveAction={saveSmtpConfig}
                  testAction={sendSmtpTest}
                  deleteAction={deleteSmtpConfig}
                />
              </>
            ) : (
              <>
                <SmtpStatusRow status={status} />
                <SmtpSettingsForm
                  status={status}
                  saveAction={saveSmtpConfig}
                  testAction={sendSmtpTest}
                  deleteAction={deleteSmtpConfig}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
