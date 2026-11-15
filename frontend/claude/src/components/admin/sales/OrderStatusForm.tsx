"use client";

import { useActionState, useRef, useState } from "react";
import {
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  type OrderStatus,
} from "@/lib/admin/constants";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { SalesAction } from "./types";

function stockNote(status: OrderStatus): string {
  if (status === "delivered") {
    return "Delivered sets available stock to zero for every item in this order.";
  }
  if (status === "cancelled" || status === "returned") {
    return "This restores the ordered quantities to stock.";
  }
  return "Status change only — stock is unchanged.";
}

/** Status-change form with a confirmation dialog. Only legal moves are offered. */
export function OrderStatusForm({
  orderId,
  currentStatus,
  expectedUpdatedAt,
  action,
}: {
  orderId: string;
  currentStatus: OrderStatus;
  expectedUpdatedAt: string;
  action: SalesAction;
}) {
  const allowed = ORDER_TRANSITIONS[currentStatus];
  const [selected, setSelected] = useState<OrderStatus | "">(allowed[0] ?? "");
  const [state, formAction] = useActionState(action, null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // After a successful change the page reloads with a new current status;
  // fall back to the first still-legal option instead of a stale selection.
  const active: OrderStatus | "" =
    selected !== "" && allowed.includes(selected) ? selected : (allowed[0] ?? "");

  if (allowed.length === 0) {
    return (
      <p className="aa-notice aa-notice--info">
        This order is {ORDER_STATUS_LABELS[currentStatus]} and has no further status changes.
      </p>
    );
  }

  return (
    <div>
      <FormMessage state={dialogOpen ? null : state} />
      <div className="aa-field">
        <label htmlFor="order-status-select">Change status</label>
        <select
          id="order-status-select"
          value={active}
          onChange={(event) => setSelected(event.target.value as OrderStatus)}
        >
          {allowed.map((status) => (
            <option key={status} value={status}>
              {ORDER_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {active !== "" ? <p className="aa-hint">{stockNote(active)}</p> : null}
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
          Change status
        </button>
      </div>

      <dialog
        ref={dialog}
        className="aa-dialog"
        onClose={() => setDialogOpen(false)}
        aria-label="Confirm status change"
      >
        {dialogOpen && active !== "" ? (
          <form action={formAction} method="post">
            <h2>
              Change status to {ORDER_STATUS_LABELS[active]}?
            </h2>
            <p>
              This order is currently {ORDER_STATUS_LABELS[currentStatus]}. {stockNote(active)}
            </p>
            <input type="hidden" name="id" value={orderId} />
            <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt} />
            <input type="hidden" name="new_status" value={active} />
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
