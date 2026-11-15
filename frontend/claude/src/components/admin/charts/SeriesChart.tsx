/**
 * Simple SVG line/area chart for a trend series with an optional
 * previous-period comparison series. Numbers are always available as a data
 * table inside the <details> element, so the chart is never the only way to
 * read the values.
 */

export interface SeriesPoint {
  label: string;
  value: number;
}

const WIDTH = 600;
const HEIGHT = 220;
const PAD_X = 8;
const PAD_TOP = 14;
const PAD_BOTTOM = 28;

function pointsToPath(
  points: readonly SeriesPoint[],
  max: number,
): { line: string; area: string; dots: { x: number; y: number }[] } {
  const innerWidth = WIDTH - PAD_X * 2;
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  const dots = points.map((point, index) => ({
    x: points.length > 1 ? PAD_X + index * step : WIDTH / 2,
    y: PAD_TOP + (1 - (max > 0 ? point.value / max : 0)) * innerHeight,
  }));
  const line = dots
    .map((dot, index) => `${index === 0 ? "M" : "L"}${dot.x.toFixed(1)},${dot.y.toFixed(1)}`)
    .join(" ");
  const first = dots[0];
  const last = dots[dots.length - 1];
  const base = PAD_TOP + innerHeight;
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
}: {
  points: readonly SeriesPoint[];
  comparePoints?: readonly SeriesPoint[];
  formatValue?: (value: number) => string;
  ariaLabel: string;
  emptyMessage?: string;
}) {
  const max = Math.max(
    0,
    ...points.map((point) => point.value),
    ...(comparePoints ?? []).map((point) => point.value),
  );
  if (points.length === 0 || max <= 0) {
    return (
      <div className="aa-chart">
        <p className="aa-muted">{emptyMessage}</p>
      </div>
    );
  }
  const current = pointsToPath(points, max);
  const compare = comparePoints ? pointsToPath(comparePoints, max) : null;
  const first = points[0];
  const middle = points[Math.floor(points.length / 2)];
  const last = points[points.length - 1];
  const showDots = points.length <= 62;
  return (
    <div className="aa-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        style={{ height: "auto", display: "block" }}
        role="img"
        aria-label={`${ariaLabel}. Highest value ${formatValue(max)}.`}
      >
        <path d={current.area} fill="rgb(107 2 2 / 0.12)" />
        {compare ? (
          <path
            d={compare.line}
            fill="none"
            stroke="#9A9494"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
        ) : null}
        <path d={current.line} fill="none" stroke="#6B0202" strokeWidth="2" />
        {showDots
          ? current.dots.map((dot, index) => (
              <circle key={index} cx={dot.x} cy={dot.y} r="3" fill="#6B0202">
                <title>{`${points[index]?.label ?? ""}: ${formatValue(points[index]?.value ?? 0)}`}</title>
              </circle>
            ))
          : null}
        <text x={PAD_X} y={PAD_TOP - 2} fontSize="11" fill="#74706C">
          {formatValue(max)}
        </text>
        <text x={PAD_X} y={HEIGHT - 14} fontSize="11" fill="#74706C">
          {first?.label ?? ""}
        </text>
        {middle && points.length > 2 ? (
          <text x={WIDTH / 2} y={HEIGHT - 14} fontSize="11" fill="#74706C" textAnchor="middle">
            {middle.label}
          </text>
        ) : null}
        <text x={WIDTH - PAD_X} y={HEIGHT - 14} fontSize="11" fill="#74706C" textAnchor="end">
          {last?.label ?? ""}
        </text>
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
                  <td>{formatValue(point.value)}</td>
                  {compare ? (
                    <td>
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
