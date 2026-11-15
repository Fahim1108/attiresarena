import { seriesGridTicks, seriesLabelIndexes } from "./geometry";

/**
 * SVG line/area chart for a trend series with an optional
 * previous-period comparison series. Horizontal gridlines carry value
 * labels on the left axis and the x-axis labels up to six evenly spaced
 * buckets, so the shape can be read without opening the data table.
 * Numbers are always available as a data table inside the <details>
 * element, so the chart is never the only way to read the values.
 */

export interface SeriesPoint {
  label: string;
  value: number;
}

const WIDTH = 640;
const HEIGHT = 280;
// Left room for value labels: "৳1,234,567" at 11px needs ~62px.
const PAD_LEFT = 76;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 30;

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
): { line: string; area: string; dots: { x: number; y: number }[] } {
  const dots = points.map((point, index) => ({
    x: xFor(index, points.length),
    y: yFor(point.value, max),
  }));
  const line = dots
    .map((dot, index) => `${index === 0 ? "M" : "L"}${dot.x.toFixed(1)},${dot.y.toFixed(1)}`)
    .join(" ");
  const first = dots[0];
  const last = dots[dots.length - 1];
  const base = PAD_TOP + (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const area =
    first && last
      ? `${line} L${last.x.toFixed(1)},${base} L${first.x.toFixed(1)},${base} Z`
      : "";
  return { line, area, dots };
}

export function SeriesChart({
  points,
  comparePoints,
  formatValue = (value) => String(value),
  ariaLabel,
  emptyMessage = "No data in this period.",
  className,
}: {
  points: readonly SeriesPoint[];
  comparePoints?: readonly SeriesPoint[];
  formatValue?: (value: number) => string;
  ariaLabel: string;
  emptyMessage?: string;
  /** Extra class on the chart wrapper (e.g. a large dashboard variant). */
  className?: string;
}) {
  const max = Math.max(
    0,
    ...points.map((point) => point.value),
    ...(comparePoints ?? []).map((point) => point.value),
  );
  if (points.length === 0 || max <= 0) {
    return (
      <div className={className ? `aa-chart ${className}` : "aa-chart"}>
        <p className="aa-muted">{emptyMessage}</p>
      </div>
    );
  }
  const current = pointsToPath(points, max);
  const compare = comparePoints ? pointsToPath(comparePoints, max) : null;
  const ticks = seriesGridTicks(max);
  const labelIndexes = seriesLabelIndexes(points.length);
  const showDots = points.length <= 62;
  const numericText = { fontVariantNumeric: "tabular-nums" } as const;
  return (
    <div className={className ? `aa-chart ${className}` : "aa-chart"}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        style={{ height: "auto", display: "block" }}
        role="img"
        aria-label={`${ariaLabel}. Highest value ${formatValue(max)}.`}
      >
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
              x={PAD_LEFT - 8}
              y={yFor(tick, max)}
              fontSize="11"
              fill="#74706C"
              textAnchor="end"
              dominantBaseline="middle"
              style={numericText}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}
        <path d={current.area} fill="rgb(107 2 2 / 0.15)" />
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
          ? current.dots.map((dot, index) => (
              <circle
                key={index}
                cx={dot.x}
                cy={dot.y}
                r="3.5"
                fill="#6B0202"
                stroke="#FFFFFF"
                strokeWidth="1.5"
              >
                <title>{`${points[index]?.label ?? ""}: ${formatValue(points[index]?.value ?? 0)}`}</title>
              </circle>
            ))
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
              x={xFor(index, points.length)}
              y={HEIGHT - 10}
              fontSize="11"
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
