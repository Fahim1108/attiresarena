/**
 * Pure helpers for chart data. Shared by the Recharts chart components so
 * empty-state decisions are tested without rendering, and so no chart ever
 * invents data: a series with no positive finite value is empty, full stop.
 */

export interface ChartDatum {
  label: string;
  value: number;
}

/** True only when at least one datum has a positive, finite value. */
export function hasChartData(
  data: readonly { value: number }[] | undefined | null,
): boolean {
  if (!data || data.length === 0) return false;
  return data.some(
    (datum) => Number.isFinite(datum.value) && datum.value > 0,
  );
}

/** Sum of the finite values (non-finite values count as 0). */
export function chartTotal(data: readonly { value: number }[]): number {
  return data.reduce(
    (sum, datum) => sum + (Number.isFinite(datum.value) ? datum.value : 0),
    0,
  );
}

/** Largest finite value, or 0 when there is none. */
export function chartMax(data: readonly { value: number }[]): number {
  let max = 0;
  for (const datum of data) {
    if (Number.isFinite(datum.value) && datum.value > max) max = datum.value;
  }
  return max;
}
