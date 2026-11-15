import Link from "next/link";
import { DONUT_PALETTE } from "./DonutChart";
import {
  DONUT_CENTER,
  PIE_DIRECT_LABEL_MIN_SHARE,
  computeDonutSlices,
  pieSliceLabelColor,
} from "./geometry";
import { ChartEmptyState } from "./ChartEmptyState";
import styles from "./PieChart.module.css";

/**
 * Donut chart (ring + centre total) built with SVG annular paths — an
 * explicit variant, not a mode on DonutChart: its slices are paths
 * with direct % labels on the ring, while DonutChart draws stroke
 * arcs. The legend beside it lists every segment with its number and
 * share, so the chart is never the only way to read the values, and
 * legend entries link through when `href` is given. Segments animate
 * in with a short stagger; reduced motion shows them immediately.
 *
 * Eight slices exceed the usual ≤5 guidance for pies; the dashboard
 * needs all eight order statuses, so the legend (with values, shares
 * and links) is the primary reading and the donut is the visual
 * summary. Colours come from the shared colourful status palette in
 * DonutChart, in ORDER_STATUSES order, so a status keeps the same
 * colour wherever it is charted.
 */

export interface PieSegment {
  label: string;
  value: number;
  href?: string;
  color?: string;
}

/**
 * The donut reuses the colourful status palette; the brand maroon
 * (#6B0202) marks Delivered (index 5 in ORDER_STATUSES order).
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
  emptyGuidance = "Data appears here once orders are placed in the selected period.",
  className,
}: {
  segments: readonly PieSegment[];
  /** Noun for the centre total, e.g. "orders". */
  totalLabel: string;
  formatValue?: (value: number) => string;
  ariaLabel: string;
  emptyMessage?: string;
  /** Guidance shown under the empty-state title. */
  emptyGuidance?: string;
  /** Extra class on the chart wrapper. */
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const slices = computeDonutSlices(segments);
  if (segments.length === 0 || total <= 0 || slices.length === 0) {
    return (
      <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
        <ChartEmptyState title={emptyMessage} guidance={emptyGuidance} />
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
          {slices.map((slice, order) => {
            const segment = segments[slice.sourceIndex];
            const color = segment?.color ?? paletteColor(slice.sourceIndex);
            return (
              <path
                key={slice.sourceIndex}
                className={styles.segment}
                style={{ animationDelay: `${order * 45}ms` }}
                d={slice.path}
                fill={color}
                fillRule="evenodd"
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
            .map((slice, order) => {
              const segment = segments[slice.sourceIndex];
              const color = segment?.color ?? paletteColor(slice.sourceIndex);
              return (
                <text
                  key={`label-${slice.sourceIndex}`}
                  className={styles.sliceLabel}
                  style={{ animationDelay: `${order * 45}ms` }}
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
          <text
            x={DONUT_CENTER}
            y={DONUT_CENTER - 4}
            textAnchor="middle"
            fontSize="24"
            fontWeight="700"
            fill="#171717"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatValue(total)}
          </text>
          <text
            x={DONUT_CENTER}
            y={DONUT_CENTER + 14}
            textAnchor="middle"
            fontSize="11"
            fill="#74706C"
          >
            {totalLabel}
          </text>
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
