"use client";

import { useEffect, useState } from "react";
import { COUNT_UP_DURATION_MS, countUpValueAt } from "./animation";

/**
 * Count-up KPI number. The server render (and screen readers) always
 * see the final real value; only the visible text animates, from zero
 * up to that value, in a single short run. Reduced motion shows the
 * final value with no animation. Props are serializable only (a
 * number plus a format key) so server pages can pass real KPI values
 * across the RSC boundary — no formatter functions cross it.
 *
 * Formatting mirrors src/lib/admin/format.ts exactly (same locale,
 * same fraction digits), so the animated text and the server text
 * can never disagree about a value.
 */

export type CountUpFormat = "count" | "money" | "money-short";

export function formatCountUpValue(
  value: number,
  format: CountUpFormat,
): string {
  if (format === "count") return value.toLocaleString("en-US");
  const major = value / 100;
  if (format === "money-short") {
    return `৳${major.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return `৳${major.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function CountUpValue({
  value,
  format,
}: {
  value: number;
  format: CountUpFormat;
}) {
  // Start on the final value so the first client render matches the
  // server HTML. When the value prop changes, reset during render
  // (the documented adjust-state-on-prop-change pattern) so the
  // effect below only ever subscribes to animation frames and never
  // sets state synchronously in its body.
  const [displayed, setDisplayed] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setDisplayed(value);
  }

  useEffect(() => {
    if (value <= 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    let frame = 0;
    let cancelled = false;
    const start = performance.now();
    const tick = (now: number) => {
      if (cancelled) return;
      const next = countUpValueAt(
        now - start,
        COUNT_UP_DURATION_MS,
        value,
        false,
      );
      setDisplayed(next);
      if (next < value) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [value]);

  const finalText = formatCountUpValue(value, format);
  return (
    <span>
      <span className="aa-sr-only">{finalText}</span>
      <span aria-hidden="true">
        {formatCountUpValue(displayed, format)}
      </span>
    </span>
  );
}
