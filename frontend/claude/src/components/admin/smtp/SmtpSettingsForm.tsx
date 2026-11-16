"use client";

import { useActionState, useRef, useState } from "react";
import type { AdminActionResult } from "@/lib/admin/authorization";
import type { SmtpStatus } from "@/lib/admin/smtp";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import styles from "@/components/admin/sales/sales-refresh.module.css";

/** Shape of every SMTP Server Action used with useActionState. */
export type SmtpAction = (
  prev: AdminActionResult | null,
  formData: FormData,
) => Promise<AdminActionResult>;

/**
 * SMTP settings: write-only password field, an explicit test send to an
 * owner-entered address, and a confirmed removal. The saved password is
 * never displayed back — the field always starts empty and saving
 * replaces the whole configuration. Rendered only for staff in the
 * settings area (owner); the Server Actions re-check that permission
 * themselves. Part of the removable SMTP module: no other module
 * imports this component.
 */
export function SmtpSettingsForm({
  status,
  saveAction,
  testAction,
  deleteAction,
}: {
  status: SmtpStatus | null;
  saveAction: SmtpAction;
  testAction: SmtpAction;
  deleteAction: SmtpAction;
}) {
  const [saveState, saveFormAction] = useActionState(saveAction, null);
  const [testState, testFormAction] = useActionState(testAction, null);
  const [deleteState, deleteFormAction] = useActionState(deleteAction, null);
  const [showPassword, setShowPassword] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // When the status is known, a test send is blocked with a reason instead
  // of failing; when the status could not be loaded, the attempt runs and
  // the action reports honestly.
  const testBlocked =
    status !== null && (!status.configured || !status.enabled);
  const testBlockReason =
    status !== null && !status.configured
      ? "Save the SMTP settings first, then send a test email."
      : "SMTP is disabled. Enable it above, save, then send a test email.";

  return (
    <div>
      <form action={saveFormAction} method="post">
        <div className={styles.formGrid}>
          <div className="aa-field">
            <label htmlFor="smtp-host">SMTP host</label>
            <input
              id="smtp-host"
              name="host"
              type="text"
              required
              maxLength={255}
              placeholder="smtp.example.com…"
              defaultValue={status?.host ?? ""}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
          <div className="aa-field">
            <label htmlFor="smtp-port">Port</label>
            <input
              id="smtp-port"
              name="port"
              type="number"
              inputMode="numeric"
              required
              min={1}
              max={65535}
              placeholder="465…"
              defaultValue={status?.port ?? 465}
              autoComplete="off"
            />
            <p className="aa-hint">
              Common ports: 465 for implicit TLS, 587 for STARTTLS.
            </p>
          </div>
          <div className="aa-field">
            <span className="aa-check-row">
              <label>
                <input
                  type="checkbox"
                  name="secure"
                  defaultChecked={status?.secure ?? true}
                />
                Use TLS/SSL encryption
              </label>
            </span>
            <p className="aa-hint">
              On for port 465. Off means the connection starts unencrypted.
            </p>
          </div>
          <div className="aa-field">
            <label htmlFor="smtp-username">Username</label>
            <input
              id="smtp-username"
              name="username"
              type="text"
              required
              maxLength={254}
              placeholder="mailbox@example.com…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="aa-hint">
              The saved username is never shown again — enter it afresh
              whenever settings are saved.
            </p>
          </div>
          <div className="aa-field">
            <label htmlFor="smtp-password">Password</label>
            <input
              id="smtp-password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              maxLength={500}
              placeholder="SMTP password…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="aa-hint">
              Enter the password every time you save — saving replaces
              the whole configuration, and the saved password is never
              shown again.
            </p>
            <span className="aa-check-row">
              <label>
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(event) => setShowPassword(event.target.checked)}
                />
                Show password
              </label>
            </span>
          </div>
          <div className="aa-field">
            <label htmlFor="smtp-from">Sender email address</label>
            <input
              id="smtp-from"
              name="from_address"
              type="email"
              required
              maxLength={254}
              placeholder="hello@example.com…"
              defaultValue={status?.from_address ?? ""}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="aa-hint">
              The From address on the test email. Some providers only allow
              the account&apos;s own address here.
            </p>
          </div>
          <div className="aa-field">
            <span className="aa-check-row">
              <label>
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={status?.enabled ?? true}
                />
                Enable SMTP
              </label>
            </span>
            <p className="aa-hint">
              When off, no email is sent, including test emails.
            </p>
          </div>
        </div>
        <FormMessage state={saveState} />
        <div className="aa-form-actions">
          <SubmitButton pendingLabel="Saving…">Save SMTP settings</SubmitButton>
        </div>
      </form>

      <form action={testFormAction} method="post">
        <p className={styles.sectionNote}>
          Send one test email to confirm the mail server can deliver.
          Nothing else is sent from this panel — no order or customer
          email is wired up.
        </p>
        <div className="aa-field">
          <label htmlFor="smtp-test-email">Send the test email to</label>
          <input
            id="smtp-test-email"
            name="test_email"
            type="email"
            required
            maxLength={254}
            placeholder="you@example.com…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
        <FormMessage state={testBlocked ? null : testState} />
        {testBlocked ? (
          <p role="status" className="aa-notice aa-notice--info">
            {testBlockReason}
          </p>
        ) : null}
        <div className="aa-form-actions">
          {testBlocked ? (
            <button type="button" className="aa-secondary" disabled>
              Send test email
            </button>
          ) : (
            <SubmitButton pendingLabel="Sending…" className="aa-secondary">
              Send test email
            </SubmitButton>
          )}
        </div>
      </form>

      {status?.configured ? (
        <div className={styles.dangerZone}>
          <p className={styles.sectionNote}>
            Removing the settings deletes the saved host, credentials and
            sender address. No email will be sent afterwards.
          </p>
          <div className={styles.actionRow}>
            <button
              type="button"
              className={`${styles.dangerButton} aa-button`}
              data-danger
              onClick={() => {
                setDialogOpen(true);
                dialog.current?.showModal();
              }}
            >
              Remove SMTP settings
            </button>
          </div>
          <dialog
            ref={dialog}
            className="aa-dialog"
            onClose={() => setDialogOpen(false)}
            aria-label="Remove SMTP settings"
          >
            {dialogOpen ? (
              <form action={deleteFormAction} method="post">
                <h2>Remove SMTP settings?</h2>
                <p>
                  The saved SMTP host, credentials and sender address will
                  be deleted. You will need to enter them again to
                  reconnect email.
                </p>
                <FormMessage state={deleteState} />
                <input type="hidden" name="confirm" value="1" />
                <div className="aa-dialog-actions">
                  <button
                    type="button"
                    className="aa-secondary"
                    onClick={() => dialog.current?.close()}
                  >
                    Cancel
                  </button>
                  <SubmitButton pendingLabel="Removing…" danger>
                    Remove settings
                  </SubmitButton>
                </div>
              </form>
            ) : null}
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
