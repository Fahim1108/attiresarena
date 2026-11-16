"use client";

import { useActionState, useRef, useState } from "react";
import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_TRANSITIONS,
  type PaymentStatus,
} from "@/lib/admin/constants";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { SalesAction } from "./types";

function paymentNote(status: PaymentStatus): string {
  if (status === "paid") {
    return "Marks the cash-on-delivery amount as received. The order status is unchanged.";
  }
  if (status === "refunded") {
    return "Marks the payment as refunded. This cannot be undone — refunded is final.";
  }
  return "Payment status change only — the order status is unchanged.";
}

/** Payment-status form with a confirmation dialog. Only legal moves are offered. */
export function PaymentStatusForm({
  orderId,
  currentPaymentStatus,
  expectedUpdatedAt,
  action,
  idPrefix = "payment-status",
}: {
  orderId: string;
  currentPaymentStatus: PaymentStatus;
  expectedUpdatedAt: string;
  action: SalesAction;
  /** Prefix for the select id; the order list passes a per-card prefix so ids stay unique. */
  idPrefix?: string;
}) {
  const allowed = PAYMENT_TRANSITIONS[currentPaymentStatus];
  const [selected, setSelected] = useState<PaymentStatus | "">(allowed[0] ?? "");
  const [state, formAction] = useActionState(action, null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // After a successful change the page reloads with a new payment status;
  // fall back to the first still-legal option instead of a stale selection.
  const active: PaymentStatus | "" =
    selected !== "" && allowed.includes(selected) ? selected : (allowed[0] ?? "");

  if (allowed.length === 0) {
    return (
      <p className="aa-notice aa-notice--info">
        This payment is {PAYMENT_STATUS_LABELS[currentPaymentStatus]} and has no further
        payment changes.
      </p>
    );
  }

  return (
    <div>
      <FormMessage state={dialogOpen ? null : state} />
      <div className="aa-field">
        <label htmlFor={`${idPrefix}-select`}>Change payment status</label>
        <select
          id={`${idPrefix}-select`}
          value={active}
          onChange={(event) => setSelected(event.target.value as PaymentStatus)}
        >
          {allowed.map((status) => (
            <option key={status} value={status}>
              {PAYMENT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {active !== "" ? <p className="aa-hint">{paymentNote(active)}</p> : null}
      </div>
      <div className="aa-form-actions">
        <button
          type="button"
          className="aa-button"
          disabled={active === ""}
          onClick={() => {
            setDialogOpen(true);
            dialog.current?.showModal();
          }}
        >
          Change payment status
        </button>
      </div>

      <dialog
        ref={dialog}
        className="aa-dialog"
        onClose={() => setDialogOpen(false)}
        aria-label="Confirm payment status change"
      >
        {dialogOpen && active !== "" ? (
          <form action={formAction} method="post">
            <h2>
              Change payment status to {PAYMENT_STATUS_LABELS[active]}?
            </h2>
            <p>
              This payment is currently {PAYMENT_STATUS_LABELS[currentPaymentStatus]}.{" "}
              {paymentNote(active)}
            </p>
            <input type="hidden" name="id" value={orderId} />
            <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt} />
            <input type="hidden" name="new_payment_status" value={active} />
            <FormMessage state={state} />
            <div className="aa-dialog-actions">
              <button
                type="button"
                className="aa-secondary"
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
              <SubmitButton pendingLabel="Changing…">Confirm change</SubmitButton>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
