"use client";

import { useActionState, useRef, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { SalesAction } from "./types";

/** Activate/deactivate toggle and guarded delete for one coupon row. */
export function CouponRowActions({
  couponId,
  code,
  active,
  hasRedemptions,
  toggleAction,
  deleteAction,
}: {
  couponId: string;
  code: string;
  active: boolean;
  hasRedemptions: boolean;
  toggleAction: SalesAction;
  deleteAction: SalesAction;
}) {
  const [toggleState, toggleFormAction] = useActionState(toggleAction, null);
  const [deleteState, deleteFormAction] = useActionState(deleteAction, null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <span className="aa-cell-actions">
      <form action={toggleFormAction} method="post" style={{ display: "inline" }}>
        <input type="hidden" name="id" value={couponId} />
        <input type="hidden" name="active" value={active ? "false" : "true"} />
        <button type="submit" className="aa-row-action">
          {active ? "Deactivate" : "Activate"}
        </button>
      </form>{" "}
      {hasRedemptions ? (
        <button
          type="button"
          className="aa-row-action aa-row-action--danger"
          disabled
          title="This coupon has been used and cannot be deleted. Deactivate it instead."
        >
          Delete
        </button>
      ) : (
        <button
          type="button"
          className="aa-row-action aa-row-action--danger"
          onClick={() => {
            setDialogOpen(true);
            dialog.current?.showModal();
          }}
        >
          Delete
        </button>
      )}
      {toggleState && !toggleState.ok ? <FormMessage state={toggleState} /> : null}
      <dialog
        ref={dialog}
        className="aa-dialog"
        onClose={() => setDialogOpen(false)}
        aria-label={`Delete coupon ${code}`}
      >
        {dialogOpen ? (
          <form action={deleteFormAction} method="post">
            <h2>Delete coupon {code}?</h2>
            <p>
              This coupon has never been used. Deleting it is permanent; you can
              deactivate it instead if you might need it later.
            </p>
            <input type="hidden" name="id" value={couponId} />
            <FormMessage state={deleteState} />
            <div className="aa-dialog-actions">
              <button
                type="button"
                className="aa-secondary"
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
              <SubmitButton pendingLabel="Deleting…" danger>
                Delete coupon
              </SubmitButton>
            </div>
          </form>
        ) : null}
      </dialog>
    </span>
  );
}
