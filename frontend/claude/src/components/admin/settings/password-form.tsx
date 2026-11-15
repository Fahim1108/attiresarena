"use client";

import { useActionState } from "react";
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
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            name="password"
            type="password"
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
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
      </div>
    </form>
  );
}
