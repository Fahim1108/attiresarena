"use client";

import { useActionState, useState } from "react";
import { RECOVERY_STATUS_LABELS, type RecoveryStatus } from "@/lib/admin/constants";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { SalesAction } from "./types";

/**
 * Manual recovery actions. Only Contacted/Lost are offered: Recovered is
 * recorded automatically from a linked purchase and the database refuses
 * manual Recovered changes, so no such button exists.
 */
export function RecoveryActions({
  sessionId,
  expectedUpdatedAt,
  currentRecovery,
  action,
}: {
  sessionId: string;
  expectedUpdatedAt: string;
  currentRecovery: RecoveryStatus;
  action: SalesAction;
}) {
  const options: RecoveryStatus[] =
    currentRecovery === "pending"
      ? ["contacted", "lost"]
      : currentRecovery === "contacted"
        ? ["lost"]
        : [];
  const [target, setTarget] = useState<RecoveryStatus>(options[0] ?? "contacted");
  const [note, setNote] = useState("");
  const [state, formAction] = useActionState(action, null);
  // After a successful change the page reloads with a new recovery status;
  // fall back to the first still-available option instead of a stale one.
  const activeTarget: RecoveryStatus = options.includes(target) ? target : (options[0] ?? "contacted");

  if (options.length === 0) {
    return (
      <p className="aa-notice aa-notice--info">
        This checkout is marked {RECOVERY_STATUS_LABELS[currentRecovery]} and has no further
        manual recovery actions.
        {currentRecovery === "recovered"
          ? " Recovered was recorded automatically from a linked purchase."
          : ""}
      </p>
    );
  }

  return (
    <form action={formAction} method="post">
      <input type="hidden" name="id" value={sessionId} />
      <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt} />
      <fieldset className="aa-field">
        <legend>Mark as</legend>
        <span className="aa-check-row">
          {options.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="new_status"
                value={option}
                checked={activeTarget === option}
                onChange={() => setTarget(option)}
              />
              {RECOVERY_STATUS_LABELS[option]}
            </label>
          ))}
        </span>
      </fieldset>
      <div className="aa-field">
        <label htmlFor="recovery-note">Follow-up note (required)</label>
        <textarea
          id="recovery-note"
          name="note"
          required
          minLength={3}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What happened when you followed up? For example: called, customer asked to reorder tomorrow."
        />
        <p className="aa-hint">
          {note.trim().length} of 500 characters. The note is saved in the recovery history.
        </p>
      </div>
      <FormMessage state={state} />
      <div className="aa-form-actions">
        <SubmitButton pendingLabel="Saving…">
          Mark as {RECOVERY_STATUS_LABELS[activeTarget]}
        </SubmitButton>
      </div>
    </form>
  );
}
