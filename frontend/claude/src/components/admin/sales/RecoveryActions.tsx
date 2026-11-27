"use client";

import { useActionState } from "react";
import { RECOVERY_STATUS_LABELS, type RecoveryStatus } from "@/lib/admin/constants";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { SalesAction } from "./types";

/**
 * Manual recovery actions: exactly two buttons, no follow-up note.
 * "Mark as Lost" writes recovery_status='lost' through the existing
 * RPC (the server action supplies the fixed staff note the RPC and
 * the recovery log still require). "Mark as Revived" posts
 * new_status='recovered'; the database records Recovered only from a
 * linked purchase, so the action refuses it with an explanation until
 * that rule is changed by migration — see setRecoveryStatus in
 * lib/admin/incomplete.ts. No messages are sent from this panel.
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
  const [state, formAction] = useActionState(action, null);

  if (currentRecovery === "lost" || currentRecovery === "recovered") {
    return (
      <>
        <FormMessage state={state} />
        <p className="aa-notice aa-notice--info">
          This checkout is marked {RECOVERY_STATUS_LABELS[currentRecovery]} and has no further
          manual recovery actions.
          {currentRecovery === "recovered"
            ? " Recovered was recorded automatically from a linked purchase."
            : ""}
        </p>
      </>
    );
  }

  return (
    <div>
      <FormMessage state={state} />
      <div className="aa-form-actions">
        <form action={formAction} method="post">
          <input type="hidden" name="id" value={sessionId} />
          <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt} />
          <input type="hidden" name="new_status" value="lost" />
          <SubmitButton pendingLabel="Saving…">Mark as Lost</SubmitButton>
        </form>
        <form action={formAction} method="post">
          <input type="hidden" name="id" value={sessionId} />
          <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt} />
          <input type="hidden" name="new_status" value="recovered" />
          <SubmitButton pendingLabel="Saving…">Mark as Revived</SubmitButton>
        </form>
      </div>
    </div>
  );
}
