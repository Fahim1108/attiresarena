"use client";

import { useActionState } from "react";
import { RECOVERY_STATUS_LABELS, type RecoveryStatus } from "@/lib/admin/constants";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { SalesAction } from "./types";

/**
 * Manual recovery actions: no follow-up note, one button per state.
 * "Mark as Lost" writes recovery_status='lost' through the existing
 * RPC (the server action supplies the fixed staff note the RPC and
 * the recovery log still require). "Mark as Revived" writes
 * recovery_status='pending' — the Lost row goes back in the
 * follow-up queue (migration 20261127000100 allows lost -> pending
 * in the guard trigger and the RPC allowlist). Revived is only
 * offered on Lost rows: on a pending row it would be a no-op, and
 * on a contacted row the trigger still refuses contacted -> pending,
 * so showing it there would only ever error. "Recovered" is never
 * offered: the database records it only from a linked purchase.
 * No messages are sent from this panel.
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

  if (currentRecovery === "recovered") {
    return (
      <>
        <FormMessage state={state} />
        <p className="aa-notice aa-notice--info">
          This checkout is marked {RECOVERY_STATUS_LABELS[currentRecovery]} and has no further
          manual recovery actions. Recovered was recorded automatically from a linked purchase.
        </p>
      </>
    );
  }

  const showRevived = currentRecovery === "lost";

  return (
    <div>
      <FormMessage state={state} />
      <div className="aa-form-actions">
        {!showRevived && (
          <form action={formAction} method="post">
            <input type="hidden" name="id" value={sessionId} />
            <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt} />
            <input type="hidden" name="new_status" value="lost" />
            <SubmitButton pendingLabel="Saving…">Mark as Lost</SubmitButton>
          </form>
        )}
        {showRevived && (
          <form action={formAction} method="post">
            <input type="hidden" name="id" value={sessionId} />
            <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt} />
            <input type="hidden" name="new_status" value="pending" />
            <SubmitButton pendingLabel="Saving…">Mark as Revived</SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
