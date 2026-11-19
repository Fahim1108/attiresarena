"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Date-range form for the admin Dashboard and Analytics pages
 * (shared: the two forms differed only in action, labels and the
 * required flag). Two fixes over the native GET form it replaces:
 *
 * 1. Immediate feedback — submit navigates with router.push inside
 *    a transition, so the button shows "Applying…" and disables
 *    the instant it is clicked instead of the old dead full-page
 *    reload. The navigation itself is the same search-param change
 *    the preset pills already make (from/to only; other params are
 *    dropped exactly as the native form dropped them).
 * 2. From/To follow the presets — the inputs are keyed by their
 *    current value, so when a preset navigation re-renders the page
 *    with a new range the inputs remount with the new dates instead
 *    of keeping the stale DOM value an uncontrolled input holds
 *    across a soft navigation (the 10/21/2026 bug).
 *
 * method/action are kept so a no-JS submit still works as a plain
 * GET; the submit handler only intercepts when JS runs (and native
 * `required` validation still runs first, since the submit event
 * fires only after it passes).
 */
export function DateRangeForm({
  action,
  from,
  to,
  fromId,
  toId,
  submitLabel,
  required = false,
}: {
  /** Page path the range navigates to ("/admin" or "/admin/analytics"). */
  action: string;
  from: string;
  to: string;
  fromId: string;
  toId: string;
  submitLabel: string;
  required?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextFrom = String(data.get("from") ?? from);
    const nextTo = String(data.get("to") ?? to);
    const href = `${action}?from=${encodeURIComponent(nextFrom)}&to=${encodeURIComponent(nextTo)}`;
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <form
      method="get"
      action={action}
      onSubmit={onSubmit}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="min-w-0">
        <label
          htmlFor={fromId}
          className="mb-1 block text-xs font-medium text-admin-text-secondary"
        >
          From
        </label>
        <input
          key={`from-${from}`}
          id={fromId}
          type="date"
          name="from"
          defaultValue={from}
          required={required}
          className="h-11 rounded-admin-control border border-admin-border bg-admin-card px-3 text-sm text-admin-text"
        />
      </div>
      <div className="min-w-0">
        <label
          htmlFor={toId}
          className="mb-1 block text-xs font-medium text-admin-text-secondary"
        >
          To
        </label>
        <input
          key={`to-${to}`}
          id={toId}
          type="date"
          name="to"
          defaultValue={to}
          required={required}
          className="h-11 rounded-admin-control border border-admin-border bg-admin-card px-3 text-sm text-admin-text"
        />
      </div>
      <button
        className="inline-flex min-h-11 items-center justify-center rounded-admin-control bg-admin-primary px-4 text-sm font-medium text-white transition-colors hover:bg-admin-primary/90 disabled:opacity-60"
        type="submit"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Applying…" : submitLabel}
      </button>
    </form>
  );
}
