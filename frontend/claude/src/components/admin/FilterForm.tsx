"use client";

import type { ReactNode } from "react";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LinkPendingHint } from "./LinkPendingHint";

/**
 * Shared filter/search form for admin list pages (orders, products,
 * inventory, customers, incomplete orders, catalogue search). It
 * replaces the native GET forms those pages used, which reloaded the
 * whole page with zero feedback on submit — the same dead click as
 * the dashboard presets. Submit navigates with router.push inside a
 * transition, so the button shows its pending label and disables the
 * instant it is clicked; the Clear link carries the pending dot.
 *
 * The navigation itself mirrors a native GET submit exactly: every
 * successful control is sent (empty values included), and the page
 * param is dropped because no page field exists in the form — so
 * applying filters still resets to page 1, as before. method/action
 * are kept so a no-JS submit still works as a plain GET.
 */
export function FilterForm({
  action,
  submitLabel,
  pendingLabel = "Applying…",
  clearHref,
  formClassName = "aa-toolbar",
  submitClassName = "aa-button",
  children,
}: {
  /** Page path the filter navigates to. */
  action: string;
  submitLabel: string;
  pendingLabel?: string;
  /** When set, a Clear link back to this path is rendered. */
  clearHref?: string;
  formClassName?: string;
  submitClassName?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget).entries()) {
      if (typeof value === "string") params.append(key, value);
    }
    const query = params.toString();
    const href = query ? `${action}?${query}` : action;
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <form
      method="get"
      action={action}
      onSubmit={onSubmit}
      className={formClassName}
    >
      {children}
      <button
        type="submit"
        className={submitClassName}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? pendingLabel : submitLabel}
      </button>
      {clearHref ? (
        <Link className="aa-secondary" href={clearHref}>
          Clear
          <LinkPendingHint />
        </Link>
      ) : null}
    </form>
  );
}
