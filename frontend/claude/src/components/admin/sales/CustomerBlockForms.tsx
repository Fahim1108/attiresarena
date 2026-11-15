"use client";

import { useActionState } from "react";
import { formatDateTime } from "@/lib/admin/format";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { SalesAction } from "./types";

/**
 * Block / unblock forms for a customer profile. Blocking is an admin record
 * only: checkout does not consult it, and the UI says so wherever the
 * block state is shown.
 */
export function CustomerBlockForms({
  phone,
  blocked,
  blockedReason,
  blockedAt,
  blockAction,
  unblockAction,
  canManage,
}: {
  phone: string;
  blocked: boolean;
  blockedReason: string | null;
  blockedAt: string | null;
  blockAction: SalesAction;
  unblockAction: SalesAction;
  canManage: boolean;
}) {
  const [blockState, blockFormAction] = useActionState(blockAction, null);
  const [unblockState, unblockFormAction] = useActionState(unblockAction, null);

  if (!canManage) {
    return (
      <p className="aa-notice aa-notice--info">
        Your role can view customers but cannot block or unblock them. Ask an
        owner or order manager if this customer needs to be blocked.
      </p>
    );
  }

  if (blocked) {
    return (
      <div>
        <p className="aa-notice aa-notice--warning">
          This customer is blocked.
          {blockedReason ? ` Reason: ${blockedReason}.` : ""}
          {blockedAt ? ` Blocked ${formatDateTime(blockedAt)}.` : ""} Blocking is an admin
          record only — checkout does not check it, so this phone can still place orders.
        </p>
        <form action={unblockFormAction} method="post">
          <input type="hidden" name="phone" value={phone} />
          <div className="aa-field">
            <label htmlFor="unblock-note">Unblock note (optional)</label>
            <input
              id="unblock-note"
              name="note"
              maxLength={500}
              placeholder="Why is this customer unblocked?"
            />
          </div>
          <FormMessage state={unblockState} />
          <div className="aa-form-actions">
            <SubmitButton pendingLabel="Unblocking…">Unblock customer</SubmitButton>
          </div>
        </form>
      </div>
    );
  }

  return (
    <form action={blockFormAction} method="post">
      <input type="hidden" name="phone" value={phone} />
      <div className="aa-field">
        <label htmlFor="block-reason">Reason for blocking (required)</label>
        <textarea
          id="block-reason"
          name="reason"
          required
          minLength={3}
          maxLength={500}
          placeholder="Why is this customer blocked? For example: repeated fake orders."
        />
        <p className="aa-hint">
          Blocking only records the decision here. It does not stop checkout — wiring
          enforcement into checkout is a separate future step.
        </p>
      </div>
      <FormMessage state={blockState} />
      <div className="aa-form-actions">
        <SubmitButton pendingLabel="Blocking…" danger>
          Block customer
        </SubmitButton>
      </div>
    </form>
  );
}
