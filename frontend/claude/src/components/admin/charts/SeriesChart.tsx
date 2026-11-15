import { useId } from "react";
import {
  areaPathFromLine,
  seriesGridTicks,
  seriesLabelIndexes,
  smoothLinePath,
  type SeriesDot,
} from "./geometry";
import { ChartEmptyState } from "./ChartEmptyState";
import styles from "./SeriesChart.module.css";

/**
 * SVG wave/area chart for a trend series with an optional
 * previous-period comparison series. The line is a smoothed spline
 * through the real plotted points (the values are unchanged, only the
 * joins are rounded) over a maroon gradient fill. Horizontal
 * gridlines carry value labels on the left axis and the x-axis labels
 * up to six evenly spaced buckets, so the shape can be read without
 * opening the data table. Each plotted point shows its exact value
 * on hover or keyboard focus, and numbers are always available as a
 * data table inside the <details> element, so the chart is never the
 * only way to read the values.
 */

export interface SeriesPoint {
  label: string;
  value: number;
}

const WIDTH = 640;
const HEIGHT = 280;
// Left room for value labels: "৳1,234,567" at 12px needs ~68px.
const PAD_LEFT = 76;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 30;
/** Per-point keyboard stops only for short series; longer series keep
 * the data table as the keyboard path instead of dozens of tab stops. */
const FOCUSABLE_DOTS_MAX = 31;

function xFor(index: number, count: number): number {
  const innerWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  if (count <= 1) return PAD_LEFT + innerWidth / 2;
  return PAD_LEFT + (index * innerWidth) / (count - 1);
}

function yFor(value: number, max: number): number {
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  return PAD_TOP + (1 - (max > 0 ? value / max : 0)) * innerHeight;
}

function pointsToPath(
  points: readonly SeriesPoint[],
  max: number,
): { line: string; area: string; dots: SeriesDot[] } {
  const dots = points.map((point, index) => ({
    x: xFor(index, points.length),
    y: yFor(point.value, max),
  }));
  const line = smoothLinePath(dots);
  const first = dots[0];
  const last = dots[dots.length - 1];
  const base = PAD_TOP + (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const area =
    first && last ? areaPathFromLine(line, first.x, last.x, base) : "";
  return { line, area, dots };
}

export function SeriesChart({
  points,
  comparePoints,
  formatValue = (value) => String(value),
  ariaLabel,
  emptyMessage = "No data in this period.",
  emptyGuidance = "Data appears here once orders are placed in the selected period.",
  className,
}: {
  points: readonly SeriesPoint[];
  comparePoints?: readonly SeriesPoint[];
  formatValue?: (value: number) => string;
  ariaLabel: string;
  emptyMessage?: string;
  /** Guidance shown under the empty-state title. */
  emptyGuidance?: string;
  /** Extra class on the chart wrapper (e.g. a large dashboard variant). */
  className?: string;
}) {
  // Strip every non-identifier character: useId() output contains
  // colons, which must not appear in an SVG url(#…) reference.
  const gradientId = `aa-series-area-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const max = Math.max(
    0,
    ...points.map((point) => point.value),
    ...(comparePoints ?? []).map((point) => point.value),
  );
  if (points.length === 0 || max <= 0) {
    return (
      <div className={className ? `aa-chart ${className}` : "aa-chart"}>
        <ChartEmptyState title={emptyMessage} guidance={emptyGuidance} />
      </div>
    );
  }
  const current = pointsToPath(points, max);
  const compare = comparePoints ? pointsToPath(comparePoints, max) : null;
  const ticks = seriesGridTicks(max);
  const labelIndexes = seriesLabelIndexes(
    points.length,
    points.length > FOCUSABLE_DOTS_MAX ? 5 : 6,
  );
  const showDots = points.length <= 62;
  const focusableDots = points.length <= FOCUSABLE_DOTS_MAX;
  const numericText = { fontVariantNumeric: "tabular-nums" } as const;
  return (
    <div
      className={
        className ? `aa-chart ${styles.enter} ${className}` : `aa-chart ${styles.enter}`
      }
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        style={{ height: "auto", display: "block" }}
        role="img"
        aria-label={`${ariaLabel}. Highest value ${formatValue(max)}.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6B0202" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#6B0202" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yFor(tick, max)}
              y2={yFor(tick, max)}
              stroke={tick === 0 ? "#D8D2D2" : "#EAEAEA"}
              strokeWidth="1"
            />
            <text
              className={styles.axis}
              x={PAD_LEFT - 8}
              y={yFor(tick, max)}
              fontSize="12"
              fill="#74706C"
              textAnchor="end"
              dominantBaseline="middle"
              style={numericText}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}
        <path d={current.area} fill={`url(#${gradientId})`} />
        {compare ? (
          <path
            d={compare.line}
            fill="none"
            stroke="#9A9494"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        <path
          d={current.line}
          fill="none"
          stroke="#6B0202"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {showDots
          ? current.dots.map((dot, index) => {
              const point = points[index];
              const readout = `${point?.label ?? ""}: ${formatValue(point?.value ?? 0)}`;
              const anchor =
                index === 0
                  ? "start"
                  : index === points.length - 1
                    ? "end"
                    : "middle";
              const readoutY = dot.y - 14 < 12 ? dot.y + 22 : dot.y - 14;
              const circle = (
                <circle
                  className={styles.dot}
                  cx={dot.x}
                  cy={dot.y}
                  r="3.5"
                  fill="#6B0202"
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                >
                  <title>{readout}</title>
                </circle>
              );
              if (!focusableDots) {
                return <g key={index}>{circle}</g>;
              }
              return (
                <g key={index} className={styles.point} tabIndex={0}>
                  {circle}
                  <text
                    className={styles.readout}
                    x={dot.x}
                    y={readoutY}
                    fontSize="12"
                    fontWeight="600"
                    fill="#171717"
                    textAnchor={anchor}
                    aria-hidden="true"
                    style={numericText}
                  >
                    {readout}
                  </text>
                </g>
              );
            })
          : null}
        {labelIndexes.map((index) => {
          const point = points[index];
          if (!point) return null;
          const anchor =
            index === 0
              ? "start"
              : index === points.length - 1
                ? "end"
                : "middle";
          return (
            <text
              key={index}
              className={styles.axis}
              x={xFor(index, points.length)}
              y={HEIGHT - 10}
              fontSize="12"
              fill="#74706C"
              textAnchor={anchor}
              style={numericText}
            >
              {point.label}
            </text>
          );
        })}
      </svg>
      {compare ? (
        <p className="aa-legend" aria-hidden="true">
          <span>
            <span className="aa-swatch" style={{ background: "#6B0202" }} />
            Current period
          </span>
          <span>
            <span className="aa-swatch" style={{ background: "#9A9494" }} />
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
                {compare ? <th scope="col">Previous</th> : null}
              </tr>
            </thead>
            <tbody>
              {points.map((point, index) => (
                <tr key={`${point.label}-${index}`}>
                  <th scope="row">{point.label}</th>
                  <td data-label="Current">{formatValue(point.value)}</td>
                  {compare ? (
                    <td data-label="Previous">
                      {comparePoints?.[index] !== undefined
                        ? formatValue(comparePoints[index]?.value ?? 0)
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
