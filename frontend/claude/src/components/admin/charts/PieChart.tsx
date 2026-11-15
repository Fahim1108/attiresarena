import Link from "next/link";
import { DONUT_PALETTE } from "./DonutChart";
import {
  PIE_CENTER,
  PIE_DIRECT_LABEL_MIN_SHARE,
  PIE_RADIUS,
  computePieSlices,
  pieSliceLabelColor,
} from "./geometry";
import styles from "./PieChart.module.css";

/**
 * Full pie chart (no hole) built with SVG paths — an explicit variant,
 * not a mode on DonutChart. The legend beside it lists every segment
 * with its number and share, so the chart is never the only way to read
 * the values, and direct % labels appear on slices large enough to hold
 * them. Legend entries link through when `href` is given.
 *
 * Eight slices exceed the usual ≤5 guidance for pies; the dashboard
 * needs all eight order statuses, so the legend (with values, shares
 * and links) is the primary reading and the pie is the visual summary.
 */

export interface PieSegment {
  label: string;
  value: number;
  href?: string;
  color?: string;
}

/**
 * The pie reuses the donut palette so a status keeps the same colour
 * wherever it is charted; the first tone is the brand maroon (#6B0202).
 */
export const PIE_PALETTE = DONUT_PALETTE;

function paletteColor(index: number): string {
  return PIE_PALETTE[index % PIE_PALETTE.length] ?? "#9A9494";
}

export function PieChart({
  segments,
  totalLabel,
  formatValue = (value) => String(value),
  ariaLabel,
  emptyMessage = "No data in this period.",
  className,
}: {
  segments: readonly PieSegment[];
  /** Noun for the total line, e.g. "orders". */
  totalLabel: string;
  formatValue?: (value: number) => string;
  ariaLabel: string;
  emptyMessage?: string;
  /** Extra class on the chart wrapper. */
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const slices = computePieSlices(segments);
  if (segments.length === 0 || total <= 0 || slices.length === 0) {
    return (
      <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
        <p className="aa-muted">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <div className={styles.chartRow}>
        <svg
          className={styles.pie}
          viewBox="0 0 200 200"
          role="img"
          aria-label={`${ariaLabel}. Total ${formatValue(total)} ${totalLabel}.`}
        >
          {slices.map((slice) => {
            const segment = segments[slice.sourceIndex];
            const color = segment?.color ?? paletteColor(slice.sourceIndex);
            if (slice.isFullCircle) {
              return (
                <circle
                  key={slice.sourceIndex}
                  cx={PIE_CENTER}
                  cy={PIE_CENTER}
                  r={PIE_RADIUS}
                  fill={color}
                >
                  <title>{`${slice.label}: ${formatValue(slice.value)}`}</title>
                </circle>
              );
            }
            return (
              <path
                key={slice.sourceIndex}
                d={slice.path}
                fill={color}
                stroke="#FFFFFF"
                strokeWidth="1.5"
                strokeLinejoin="round"
              >
                <title>{`${slice.label}: ${formatValue(slice.value)}`}</title>
              </path>
            );
          })}
          {slices
            .filter((slice) => slice.share >= PIE_DIRECT_LABEL_MIN_SHARE)
            .map((slice) => {
              const segment = segments[slice.sourceIndex];
              const color = segment?.color ?? paletteColor(slice.sourceIndex);
              return (
                <text
                  key={`label-${slice.sourceIndex}`}
                  x={slice.labelX}
                  y={slice.labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="12"
                  fontWeight="600"
                  fill={pieSliceLabelColor(color)}
                  aria-hidden="true"
                >
                  {`${Math.round(slice.share * 100)}%`}
                </text>
              );
            })}
        </svg>
        <ul className={styles.legend}>
          {segments.map((segment, index) => {
            const color = segment.color ?? paletteColor(index);
            const share =
              total > 0 ? Math.round((segment.value / total) * 100) : 0;
            const text = (
              <>
                <span
                  className={styles.swatch}
                  style={{ background: color }}
                  aria-hidden="true"
                />
                {segment.label} · {formatValue(segment.value)} ({share}%)
              </>
            );
            return (
              <li key={`${segment.label}-${index}`}>
                {segment.href ? (
                  <Link href={segment.href}>{text}</Link>
                ) : (
                  text
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <p className={styles.total}>
        Total {formatValue(total)} {totalLabel}
      </p>
    </div>
  );
}
