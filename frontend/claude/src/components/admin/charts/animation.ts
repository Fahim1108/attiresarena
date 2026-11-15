/**
 * Pure count-up animation math for KPI numbers (no React imports, so
 * the easing and frame values are unit-tested directly). The component
 * in CountUpValue.tsx owns the requestAnimationFrame loop and the
 * prefers-reduced-motion check; this module only answers "what value
 * is shown at this elapsed time", which keeps the animation honest:
 * it always ends exactly on the real value, never overshoots, and
 * renders the final value immediately when motion is reduced.
 */

/** One count-up run: short enough to feel instant, long enough to read. */
export const COUNT_UP_DURATION_MS = 700;

/** Deceleration easing: fast start, gentle landing on the final value. */
export function easeOutCubic(progress: number): number {
  const clamped = Math.min(Math.max(progress, 0), 1);
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Displayed value `elapsedMs` into a count-up towards `target`.
 * Reduced motion, a non-positive duration, or an elapsed time past the
 * end all show the final value. Non-positive targets are shown as-is
 * (there is nothing to count up to). Intermediate values are whole
 * numbers in the caller's units (counts, or minor currency units).
 */
export function countUpValueAt(
  elapsedMs: number,
  durationMs: number,
  target: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || durationMs <= 0 || elapsedMs >= durationMs) {
    return target;
  }
  if (target <= 0 || elapsedMs <= 0) return target <= 0 ? target : 0;
  return Math.round(target * easeOutCubic(elapsedMs / durationMs));
}
