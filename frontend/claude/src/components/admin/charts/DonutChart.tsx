import Link from "next/link";
import { ChartEmptyState } from "./ChartEmptyState";
import styles from "./DonutChart.module.css";

/**
 * Donut chart built with SVG circles. The centre shows the total and
 * the legend next to it lists every segment with its number and
 * share, so the chart is never the only way to read the values.
 * Legend entries link through when `href` is given. Arcs animate in
 * with a short stagger; reduced motion shows them immediately.
 */

export interface DonutSegment {
  label: string;
  value: number;
  href?: string;
  color?: string;
}

/**
 * Colourful status palette, in ORDER_STATUSES order (pending,
 * confirmed, packed, shipped, out-for-delivery, delivered, cancelled,
 * returned). Every tone pairs with a direct-label ink at 4.5:1 or
 * better (see tests/admin-charts-visual.check.ts); the brand maroon
 * (#6B0202) marks Delivered, the outcome the chart leads towards.
 * The pie reuses this palette so a status keeps the same colour
 * wherever it is charted.
 */
export const DONUT_PALETTE = [
  "#C08A2C",
  "#1F7A6D",
  "#7B4B94",
  "#2E7D32",
  "#B04A12",
  "#6B0202",
  "#B42318",
  "#9A9494",
] as const;

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function DonutChart({
  segments,
  centerLabel,
  formatValue = (value) => String(value),
  ariaLabel,
  emptyMessage = "No data in this period.",
  emptyGuidance = "Data appears here once orders are placed in the selected period.",
  className,
}: {
  segments: readonly DonutSegment[];
  centerLabel: string;
  formatValue?: (value: number) => string;
  ariaLabel: string;
  emptyMessage?: string;
  /** Guidance shown under the empty-state title. */
  emptyGuidance?: string;
  /** Extra class on the chart wrapper (e.g. a large dashboard variant). */
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (segments.length === 0 || total <= 0) {
    return (
      <div className={className ? `aa-chart ${className}` : "aa-chart"}>
        <ChartEmptyState title={emptyMessage} guidance={emptyGuidance} />
      </div>
    );
  }
  // Kept as the original pure per-segment prefix sum: with at most 8
  // segments the cost is negligible, and a running-offset mutation
  // inside map() violates the react-hooks/immutability lint rule.
  const arcs = segments.map((segment, index) => {
    const fraction = segment.value / total;
    const length = Math.max(fraction * CIRCUMFERENCE - 1.5, 0);
    const startOffset = segments
      .slice(0, index)
      .reduce((sum, prior) => sum + (prior.value / total) * CIRCUMFERENCE, 0);
    return {
      segment,
      color: segment.color ?? DONUT_PALETTE[index % DONUT_PALETTE.length] ?? "#9A9494",
      dashArray: `${length} ${CIRCUMFERENCE - length}`,
      dashOffset: -startOffset,
    };
  });
  return (
    <div className={className ? `aa-chart ${className}` : "aa-chart"}>
      <div className={styles.chartRow}>
        <svg
          className={styles.donut}
          viewBox="0 0 140 140"
          role="img"
          aria-label={`${ariaLabel}. Total ${formatValue(total)}.`}
        >
          <circle cx="70" cy="70" r={RADIUS} fill="none" stroke="#F1ECEC" strokeWidth="26" />
          {arcs
            .filter((arc) => arc.segment.value > 0)
            .map((arc, index) => (
              // The rotation lives on the <g>: a CSS transform on the
              // circle itself would override the transform attribute
              // and the arcs would start at 3 o'clock, not 12.
              <g key={`${arc.segment.label}-${index}`} transform="rotate(-90 70 70)">
                <circle
                  className={styles.segment}
                  style={{ animationDelay: `${index * 45}ms` }}
                  cx="70"
                  cy="70"
                  r={RADIUS}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth="26"
                  strokeDasharray={arc.dashArray}
                  strokeDashoffset={arc.dashOffset}
                >
                  <title>{`${arc.segment.label}: ${formatValue(arc.segment.value)}`}</title>
                </circle>
              </g>
            ))}
          <text x="70" y="66" textAnchor="middle" fontSize="20" fontWeight="600" fill="#171717">
            {formatValue(total)}
          </text>
          <text x="70" y="84" textAnchor="middle" fontSize="11" fill="#74706C">
            {centerLabel}
          </text>
        </svg>
        <ul className={styles.legend}>
          {segments.map((segment, index) => {
            const color =
              segment.color ?? DONUT_PALETTE[index % DONUT_PALETTE.length] ?? "#9A9494";
            const share = total > 0 ? Math.round((segment.value / total) * 100) : 0;
            const text = (
              <>
                <span className={styles.swatch} style={{ background: color }} aria-hidden="true" />
                <span>
                  {segment.label} · {formatValue(segment.value)} ({share}%)
                </span>
              </>
            );
            return (
              <li key={`${segment.label}-${index}`}>
                {segment.href ? (
                  <Link href={segment.href}>{text}</Link>
                ) : (
                  <span className={styles.legendRow}>{text}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
