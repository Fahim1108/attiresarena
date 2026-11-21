"use client";

import { useActionState, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import {
  formatDateTime,
  formatMoney,
  paymentProviderLabel,
  paymentSubmissionStatusLabel,
} from "@/lib/admin/format";
import type { PaymentSubmission } from "@/lib/admin/orders";
import { Badge } from "@/components/ui/Badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/design-system/Card";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { SalesAction } from "./types";

/**
 * Advance-payment verification card (migration 20261121000100): the
 * bKash/Nagad receipt the customer submitted with the order — provider,
 * Transaction ID, sender number, advance amount, and verification
 * status — with Mark verified / Reject actions. Both actions confirm
 * first and always report a real success or error message; nothing
 * here is a silent void action. Admin design-system tokens only
 * (Card, Badge, aa-button / aa-secondary); no new colours or fonts.
 */
export function PaymentVerificationCard({
  submission,
  isSample,
  verifyAction,
}: {
  /** Latest submission for the order, or null when none was recorded. */
  submission: PaymentSubmission | null;
  isSample: boolean;
  verifyAction: SalesAction;
}) {
  const [state, formAction] = useActionState(verifyAction, null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [verdict, setVerdict] = useState<"verified" | "rejected" | null>(null);
  const [copied, setCopied] = useState(false);

  const openDialog = (next: "verified" | "rejected") => {
    setVerdict(next);
    setDialogOpen(true);
    dialog.current?.showModal();
  };

  const copyTransactionId = async () => {
    if (!submission) return;
    try {
      await navigator.clipboard.writeText(submission.transaction_id);
    } catch {
      // Clipboard API unavailable (older browsers, insecure context):
      // fall back to a selected textarea so the copy still works.
      const area = document.createElement("textarea");
      area.value = submission.transaction_id;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const badgeTone =
    submission?.status === "verified"
      ? "success"
      : submission?.status === "rejected"
        ? "neutral"
        : "warning";

  return (
    <Card>
      <CardHeader>
        <CardTitle headingLevel="h2">Advance payment</CardTitle>
        <CardDescription>
          The bKash/Nagad receipt submitted with this order. Verify it against
          the payment app before confirming the order.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isSample ? (
          <p className="aa-notice aa-notice--warning" role="status">
            Verification is unavailable while live order data cannot be loaded.
            This sample record cannot be verified.
          </p>
        ) : !submission ? (
          <p className="text-sm leading-6 text-admin-text-secondary">
            No advance payment submission was recorded for this order. If the
            order was placed before payment records were introduced, the
            Transaction ID and sender number are in the order note on the
            invoice above.
          </p>
        ) : (
          <div className="space-y-4">
            <FormMessage state={dialogOpen ? null : state} />
            <dl className="aa-fact-grid">
              <div>
                <dt>Provider</dt>
                <dd>{paymentProviderLabel(submission.provider)}</dd>
              </div>
              <div>
                <dt>Transaction ID</dt>
                <dd>
                  <code className="font-mono">{submission.transaction_id}</code>{" "}
                  <button
                    type="button"
                    className="aa-secondary inline-flex items-center gap-1"
                    onClick={copyTransactionId}
                    aria-label={`Copy Transaction ID ${submission.transaction_id}`}
                  >
                    {copied ? (
                      <Check size={14} strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <Copy size={14} strokeWidth={2} aria-hidden="true" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </dd>
              </div>
              <div>
                <dt>Sender number</dt>
                <dd>{submission.sender_number}</dd>
              </div>
              <div>
                <dt>Advance paid</dt>
                <dd>{formatMoney(submission.advance_minor)}</dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>
                  <time dateTime={submission.submitted_at}>
                    {formatDateTime(submission.submitted_at)}
                  </time>
                </dd>
              </div>
              {submission.verified_at ? (
                <div>
                  <dt>Decided</dt>
                  <dd>
                    <time dateTime={submission.verified_at}>
                      {formatDateTime(submission.verified_at)}
                    </time>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Status</dt>
                <dd>
                  <Badge tone={badgeTone}>
                    {paymentSubmissionStatusLabel(submission.status)}
                  </Badge>
                </dd>
              </div>
            </dl>
            {submission.status === "submitted" ? (
              <div className="aa-form-actions">
                <button
                  type="button"
                  className="aa-button"
                  onClick={() => openDialog("verified")}
                >
                  Mark verified
                </button>
                <button
                  type="button"
                  className="aa-secondary"
                  onClick={() => openDialog("rejected")}
                >
                  Reject
                </button>
              </div>
            ) : (
              <p className="text-sm leading-6 text-admin-text-secondary">
                {submission.status === "verified"
                  ? "This payment was verified. The order's payment status is Paid."
                  : "This payment was rejected. Its Transaction ID is free for a corrected re-submission."}
              </p>
            )}
          </div>
        )}
      </CardContent>

      <dialog
        ref={dialog}
        className="aa-dialog"
        onClose={() => {
          setDialogOpen(false);
          setVerdict(null);
        }}
        aria-label="Confirm payment verification"
      >
        {dialogOpen && verdict && submission ? (
          <form action={formAction} method="post">
            <h2>
              {verdict === "verified"
                ? "Mark this advance payment verified?"
                : "Reject this advance payment?"}
            </h2>
            <p>
              {verdict === "verified" ? (
                <>
                  {paymentProviderLabel(submission.provider)} Transaction ID{" "}
                  <code className="font-mono">{submission.transaction_id}</code>{" "}
                  from {submission.sender_number} will be marked verified, and
                  the order&apos;s payment status will become Paid. Confirm
                  the order afterwards to start packing.
                </>
              ) : (
                <>
                  {paymentProviderLabel(submission.provider)} Transaction ID{" "}
                  <code className="font-mono">{submission.transaction_id}</code>{" "}
                  from {submission.sender_number} will be marked rejected.
                  The Transaction ID will be free for a corrected
                  re-submission, and the order&apos;s payment status will not
                  change.
                </>
              )}
            </p>
            <input type="hidden" name="submission_id" value={submission.id} />
            <input type="hidden" name="verdict" value={verdict} />
            <FormMessage state={state} />
            <div className="aa-dialog-actions">
              <button
                type="button"
                className="aa-secondary"
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
              <SubmitButton pendingLabel={verdict === "verified" ? "Verifying…" : "Rejecting…"}>
                {verdict === "verified" ? "Confirm verification" : "Confirm rejection"}
              </SubmitButton>
            </div>
          </form>
        ) : null}
      </dialog>
    </Card>
  );
}
