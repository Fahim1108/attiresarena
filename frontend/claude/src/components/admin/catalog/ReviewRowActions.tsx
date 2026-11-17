"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";

/** Shape of the moderation Server Action used with useActionState. */
export type ModerateReviewAction = (
  prev: AdminActionResult | null,
  formData: FormData,
) => Promise<AdminActionResult>;

/**
 * Approve/Reject row actions for one review, following the coupon
 * toggle shape (small FormData forms, one shared action state).
 * Re-moderation is allowed: approving an approved review (or
 * rejecting a rejected one) simply re-sets the status.
 */
export function ReviewRowActions({
  reviewId,
  author,
  moderateAction,
}: {
  reviewId: string;
  author: string;
  moderateAction: ModerateReviewAction;
}) {
  const [state, formAction] = useActionState(moderateAction, null);
  return (
    <div className="aa-cell-actions">
      <form action={formAction} method="post" style={{ display: "inline" }}>
        <input type="hidden" name="id" value={reviewId} />
        <input type="hidden" name="approved" value="true" />
        <button
          type="submit"
          className="aa-row-action"
          aria-label={`Approve review by ${author}`}
        >
          Approve
        </button>
      </form>{" "}
      <form action={formAction} method="post" style={{ display: "inline" }}>
        <input type="hidden" name="id" value={reviewId} />
        <input type="hidden" name="approved" value="false" />
        <button
          type="submit"
          className="aa-row-action"
          aria-label={`Reject review by ${author}`}
        >
          Reject
        </button>
      </form>
      {state && !state.ok ? <FormMessage state={state} /> : null}
    </div>
  );
}
