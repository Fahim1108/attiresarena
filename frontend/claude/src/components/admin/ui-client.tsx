"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminActionResult } from "@/lib/admin/authorization";

/**
 * BUTTON STANDARD (Admin Panel v2, owner item 6). Every admin surface
 * follows this; other builders use these primitives instead of inventing
 * their own buttons:
 *
 * 1. Every button is ALWAYS VISIBLE with a CLEAR TEXT LABEL. Never a
 *    hover-reveal-only label, never an icon-only button without an
 *    accessible name.
 * 2. Danger (red) styling is ONLY for destructive actions, and every
 *    destructive action goes through <ConfirmSubmit> with a specific
 *    confirm label ("Delete banner", not "Confirm"). Never use red for
 *    emphasis, navigation, or ordinary submits.
 * 3. Submits use <SubmitButton> (or the explicit <DangerSubmitButton>
 *    variant inside a confirmation dialog): the button disables itself
 *    while the action runs and shows a pending label ending in "…".
 * 4. Navigation uses <Link>, never a button with an onClick navigation.
 *    Actions use <button type="button"|"submit">, never a div onClick.
 */

/**
 * Move keyboard focus to the first invalid field in a form after a failed
 * submit, so keyboard and screen-reader users land on the first problem
 * instead of the top of the page. No-op when the form has no invalid
 * field. Call from an effect that watches the action state.
 */
export function focusFirstInvalid(form: HTMLFormElement | null): void {
  if (!form) return;
  const invalid = form.querySelector<HTMLElement>("[aria-invalid='true']");
  if (invalid) invalid.focus();
}

/** Submit button that disables itself while its form action runs. */
export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  className = "aa-button",
  danger = false,
  disabled = false,
  ariaLabel,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  /**
   * Kept for existing callers. New code uses the explicit
   * <DangerSubmitButton> variant instead of this boolean.
   */
  danger?: boolean;
  /** Extra disable reason on top of the pending state (e.g. already first). */
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={className}
      data-danger={danger || undefined}
      aria-label={ariaLabel}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * Explicit destructive-submit variant (confirmation dialogs only — see
 * the button standard above). Same pending behavior as SubmitButton,
 * always danger-styled, so call sites read as what they are.
 */
export function DangerSubmitButton({
  children,
  pendingLabel = "Working…",
  className = "aa-button",
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  /** Extra disable reason on top of the pending state (e.g. confirmation word not typed yet). */
  disabled?: boolean;
}) {
  return (
    <SubmitButton pendingLabel={pendingLabel} className={className} danger disabled={disabled}>
      {children}
    </SubmitButton>
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

/** Shape of every admin Server Action used with useActionState. */
export type RowAction = (
  prev: AdminActionResult | null,
  formData: FormData,
) => Promise<AdminActionResult>;

/**
 * One small row action (toggle, move, activate) inside a list table.
 * Renders its own form plus the action outcome inline, so a failed
 * action never looks like a successful one. The message stays with
 * the row until the next action on that row replaces it.
 */
export function RowActionForm({
  action,
  fields,
  buttonLabel,
  ariaLabel,
  disabled = false,
  pendingLabel = "Working…",
}: {
  action: RowAction;
  fields: Record<string, string>;
  buttonLabel: string;
  ariaLabel?: string;
  disabled?: boolean;
  pendingLabel?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <>
      <form action={formAction} method="post" style={{ display: "inline" }}>
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <SubmitButton
          pendingLabel={pendingLabel}
          className="aa-row-action"
          disabled={disabled}
          ariaLabel={ariaLabel}
        >
          {buttonLabel}
        </SubmitButton>
      </form>
      <FormMessage state={state} />
    </>
  );
}

/**
 * Destructive action guarded by a confirmation dialog. Renders its own form,
 * so it must not be nested inside another <form>. The outcome is shown
 * inline next to the button once the dialog closes: on failure the row
 * stays and the error is visible; on success the row usually disappears
 * with the refresh, which is itself the confirmation.
 */
export function ConfirmSubmit({
  action,
  fields,
  buttonLabel,
  ariaLabel,
  confirmTitle,
  confirmBody,
  confirmLabel = "Confirm",
  pendingLabel = "Working…",
}: {
  action: RowAction;
  fields: Record<string, string>;
  buttonLabel: string;
  ariaLabel?: string;
  confirmTitle: string;
  confirmBody: string;
  confirmLabel?: string;
  pendingLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const [state, formAction] = useActionState(action, null);
  // Close the dialog once the action reports back, so the inline
  // outcome below the button is visible instead of hidden behind it.
  useEffect(() => {
    if (state !== null) dialog.current?.close();
  }, [state]);
  return (
    <>
      <button
        type="button"
        className="aa-row-action aa-row-action--danger"
        aria-label={ariaLabel}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        {buttonLabel}
      </button>
      <FormMessage state={state} />
      <dialog
        ref={dialog}
        className="aa-dialog"
        onClose={() => setOpen(false)}
        aria-label={confirmTitle}
        aria-describedby={bodyId}
      >
        {open ? (
          <form action={formAction} method="post">
            <h2>{confirmTitle}</h2>
            <p id={bodyId}>{confirmBody}</p>
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
              <DangerSubmitButton pendingLabel={pendingLabel}>
                {confirmLabel}
              </DangerSubmitButton>
            </div>
          </form>
        ) : null}
      </dialog>
    </>
  );
}
