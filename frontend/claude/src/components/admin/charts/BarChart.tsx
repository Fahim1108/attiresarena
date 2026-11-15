/**
 * Grouped bar chart (current period vs previous period), built with plain
 * divs and the existing aa-* chart classes. No chart dependency exists in
 * this repo and none is added. Bars grow from the baseline with a short
 * stagger; reduced motion shows them at full height immediately.
 * Numbers are always available as a data table inside the <details>
 * element, so the chart is never the only way to read the values.
 */

import { ChartEmptyState } from "./ChartEmptyState";
import styles from "./BarChart.module.css";

export interface BarChartBar {
  label: string;
  value: number;
  /** Previous-equivalent-period value at the same position, when known. */
  compareValue?: number;
}

export function BarChart({
  bars,
  formatValue = (value) => String(value),
  ariaLabel,
  emptyMessage = "No data in this period.",
  emptyGuidance = "Data appears here once orders are placed in the selected period.",
  className,
}: {
  bars: readonly BarChartBar[];
  formatValue?: (value: number) => string;
  ariaLabel: string;
  emptyMessage?: string;
  /** Guidance shown under the empty-state title. */
  emptyGuidance?: string;
  /** Extra class on the chart wrapper (e.g. a large dashboard variant). */
  className?: string;
}) {
  const max = Math.max(
    0,
    ...bars.map((bar) => Math.max(bar.value, bar.compareValue ?? 0)),
  );
  const hasComparison = bars.some((bar) => bar.compareValue !== undefined);
  if (bars.length === 0 || max <= 0) {
    return (
      <div className={className ? `aa-chart ${className}` : "aa-chart"}>
        <ChartEmptyState title={emptyMessage} guidance={emptyGuidance} />
      </div>
    );
  }
  const first = bars[0];
  const last = bars[bars.length - 1];
  return (
    <div className={className ? `aa-chart ${className}` : "aa-chart"}>
      <div
        className="aa-bars"
        role="img"
        aria-label={`${ariaLabel}. Highest value ${formatValue(max)}.`}
      >
        {bars.map((bar, index) => (
          <div
            key={`${bar.label}-${index}`}
            style={{
              flex: "1 1 0",
              minWidth: 0,
              height: "100%",
              display: "flex",
              alignItems: "flex-end",
              gap: 2,
            }}
            title={`${bar.label}: ${formatValue(bar.value)}${bar.compareValue !== undefined ? ` (previous: ${formatValue(bar.compareValue)})` : ""}`}
          >
            <div
              className={`aa-bar ${styles.grow}`}
              style={{
                height: `${Math.max((bar.value / max) * 100, bar.value > 0 ? 2 : 0)}%`,
                animationDelay: `${index * 40}ms`,
              }}
            />
            {bar.compareValue !== undefined ? (
              <div
                className={`aa-bar aa-bar--compare ${styles.grow}`}
                style={{
                  height: `${Math.max((bar.compareValue / max) * 100, bar.compareValue > 0 ? 2 : 0)}%`,
                  animationDelay: `${index * 40}ms`,
                }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="aa-chart-axis" aria-hidden="true">
        <span>{first?.label ?? ""}</span>
        <span>{last?.label ?? ""}</span>
      </div>
      {hasComparison ? (
        <p className="aa-legend" aria-hidden="true">
          <span>
            <span
              className="aa-swatch"
              style={{ background: "#6B0202" }}
            />
            Current period
          </span>
          <span>
            <span
              className="aa-swatch"
              style={{ background: "rgb(107 2 2 / 0.25)" }}
            />
            Previous period
          </span>
        </p>
      ) : null}
      <details>
        <summary>View chart data as a table</summary>
        <div className="aa-table-scroll">
          <table className="aa-table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Current</th>
                {hasComparison ? <th scope="col">Previous</th> : null}
              </tr>
            </thead>
            <tbody>
              {bars.map((bar, index) => (
                <tr key={`${bar.label}-${index}`}>
                  <th scope="row">{bar.label}</th>
                  <td data-label="Current">{formatValue(bar.value)}</td>
                  {hasComparison ? (
                    <td data-label="Previous">
                      {bar.compareValue !== undefined
                        ? formatValue(bar.compareValue)
                        : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
