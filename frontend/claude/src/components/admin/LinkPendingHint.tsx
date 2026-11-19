"use client";

import { useLinkStatus } from "next/link";
import styles from "./LinkPendingHint.module.css";

/**
 * Fixed-size pending dot for admin navigation links. It MUST be
 * rendered inside a next/link <Link>: useLinkStatus reports that
 * link's pending navigation, so the dot appears the instant the link
 * is clicked and clears when the navigation lands — the dead gap on
 * slow admin pages, where a click showed nothing for 2–4 seconds.
 * The dot is always rendered at a fixed size (opacity 0) so it never
 * shifts layout; it fades in after 100ms so fast navigations never
 * flash it (Next's own useLinkStatus guidance). Decorative
 * (aria-hidden); the link text stays the accessible name. When the
 * route was already prefetched the pending state is skipped by the
 * framework and no dot appears — that is the fast path, not a bug.
 */
export function LinkPendingHint({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={`${styles.hint} ${pending ? styles.hintPending : ""}${className ? ` ${className}` : ""}`}
    />
  );
}
