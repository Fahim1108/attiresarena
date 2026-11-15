"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminActionResult } from "@/lib/admin/authorization";

/** Submit button that disables itself while its form action runs. */
export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  className = "aa-button",
  danger = false,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      data-danger={danger || undefined}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Renders the outcome of a Server Action returned via useActionState. */
export function FormMessage({ state }: { state: AdminActionResult | null }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p role="status" className="aa-notice aa-notice--success">
        {state.message}
      </p>
    );
  }
  return (
    <p role="alert" className="aa-notice aa-notice--error">
      {state.error}
    </p>
  );
}

/**
 * Destructive action guarded by a confirmation dialog. Renders its own form,
 * so it must not be nested inside another <form>.
 */
export function ConfirmSubmit({
  action,
  fields,
  buttonLabel,
  confirmTitle,
  confirmBody,
  confirmLabel = "Confirm",
  pendingLabel = "Working…",
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  buttonLabel: string;
  confirmTitle: string;
  confirmBody: string;
  confirmLabel?: string;
  pendingLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="aa-row-action aa-row-action--danger"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        {buttonLabel}
      </button>
      <dialog
        ref={dialog}
        className="aa-dialog"
        onClose={() => setOpen(false)}
        aria-label={confirmTitle}
      >
        {open ? (
          <form action={action} method="post">
            <h2>{confirmTitle}</h2>
            <p>{confirmBody}</p>
            {Object.entries(fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <div className="aa-dialog-actions">
              <button
                type="button"
                className="aa-secondary"
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
              <SubmitButton pendingLabel={pendingLabel} danger>
                {confirmLabel}
              </SubmitButton>
            </div>
          </form>
        ) : null}
      </dialog>
    </>
  );
}
