"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";

export function PasswordForm({
  action,
}: {
  action: (
    prev: AdminActionResult | null,
    form: FormData,
  ) => Promise<AdminActionResult>;
}) {
  const [state, formAction] = useActionState(action, null);
  const [showPasswords, setShowPasswords] = useState(false);
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field aa-field--full">
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            name="currentPassword"
            type={showPasswords ? "text" : "password"}
            autoComplete="current-password"
            spellCheck={false}
            maxLength={128}
            required
          />
          <p className="aa-hint">
            Your current password is checked first. If it is wrong, nothing
            is changed.
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            name="password"
            type={showPasswords ? "text" : "password"}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
          <p className="aa-hint">
            12–128 characters, with at least one letter and one number.
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            name="confirmPassword"
            type={showPasswords ? "text" : "password"}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </div>
      </div>
      <div className="aa-check-row" style={{ marginTop: "0.75rem" }}>
        <label>
          <input
            type="checkbox"
            checked={showPasswords}
            onChange={(event) => setShowPasswords(event.target.checked)}
          />{" "}
          Show passwords
        </label>
      </div>
      <div className="aa-form-actions">
        <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
      </div>
    </form>
  );
}
