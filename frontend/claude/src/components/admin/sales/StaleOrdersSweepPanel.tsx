"use client";

import { useActionState, useRef, useState } from "react";
import type { SweepPreview } from "@/lib/admin/orders";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { SalesAction } from "./types";

type PreviewResult =
  | { ok: true; preview: SweepPreview }
  | { ok: false; error: string };

/**
 * Manual run for the 3-hour unverified-order rule. An automatic sweep
 * also runs every 15 minutes (pg_cron, migration
 * 20261119000200), so this panel is for an on-demand review: staff
 * review the dry-run counts in a confirmation dialog, then confirm.
 * The dialog always shows how many orders would be cancelled AND how
 * many would be skipped (already sent to the courier) before anything
 * is written.
 */
export function StaleOrdersSweepPanel({
  previewAction,
  runAction,
}: {
  previewAction: () => Promise<PreviewResult>;
  runAction: SalesAction;
}) {
  const [preview, setPreview] = useState<SweepPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [state, formAction] = useActionState(runAction, null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadPreview = async () => {
    setLoadingPreview(true);
    setPreviewError(null);
    let result: PreviewResult;
    try {
      result = await previewAction();
    } catch {
      setLoadingPreview(false);
      setPreviewError("The unverified-order count could not be read. Try again.");
      return;
    }
    setLoadingPreview(false);
    if (!result.ok) {
      setPreviewError(result.error);
      return;
    }
    setPreview(result.preview);
    setDialogOpen(true);
    dialog.current?.showModal();
  };

  return (
    <div>
      <p>
        Orders that stay Pending for more than 3 hours hold stock that no
        one else can buy. Reviewing them here cancels the stale ones and
        returns their items to stock. An automatic sweep also runs every
        15 minutes — use this panel to review and run it on demand.
      </p>
      <FormMessage state={dialogOpen ? null : state} />
      {previewError ? (
        <p role="alert" className="aa-notice aa-notice--error">
          {previewError}
        </p>
      ) : null}
      <div className="aa-form-actions">
        <button
          type="button"
          className="aa-secondary"
          onClick={loadPreview}
          disabled={loadingPreview}
        >
          {loadingPreview ? "Checking…" : "Review unverified orders"}
        </button>
      </div>

      <dialog
        ref={dialog}
        className="aa-dialog"
        onClose={() => setDialogOpen(false)}
        aria-label="Confirm unverified-order review"
      >
        {dialogOpen && preview ? (
          <form action={formAction} method="post">
            <h2>Cancel unverified orders older than 3 hours?</h2>
            <p role="status">
              {preview.stale === 0
                ? "No pending order is older than 3 hours. Nothing would change."
                : `${preview.would_cancel} stale order${preview.would_cancel === 1 ? "" : "s"} would be cancelled and restocked.`}
              {preview.skipped > 0
                ? ` ${preview.skipped} stale order${preview.skipped === 1 ? " was" : "s were"} skipped because ${preview.skipped === 1 ? "it already has" : "they already have"} a courier booking.`
                : ""}
            </p>
            <p>
              Cancelled orders cannot be restored from here, and their
              items return to stock immediately. Orders already sent to
              the courier are never cancelled by this review.
            </p>
            <FormMessage state={state} />
            <input type="hidden" name="confirm" value="1" />
            <div className="aa-dialog-actions">
              <button
                type="button"
                className="aa-secondary"
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
              {preview.would_cancel === 0 ? (
                <button type="button" className="aa-button" disabled>
                  Nothing to cancel
                </button>
              ) : (
                <SubmitButton pendingLabel="Reviewing…">
                  {`Cancel ${preview.would_cancel} order${preview.would_cancel === 1 ? "" : "s"} and restock`}
                </SubmitButton>
              )}
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
