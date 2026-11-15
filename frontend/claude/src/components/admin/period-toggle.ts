/**
 * Pure state helper for the link-based segmented controls
 * (PeriodToggle): which option is active, given the current query
 * value. No React imports, so the fallback behaviour is unit-tested
 * directly. An unknown or missing value falls back to the caller's
 * default option (the "Automatic" behaviour for chart granularity);
 * an empty option list has no active option.
 */
export function segmentedActiveIndex(
  values: readonly string[],
  active: string | undefined,
  defaultIndex = 0,
): number {
  if (values.length === 0) return -1;
  if (active !== undefined) {
    const found = values.indexOf(active);
    if (found >= 0) return found;
  }
  return Math.min(Math.max(defaultIndex, 0), values.length - 1);
}
