import Link from "next/link";

/**
 * Donut chart built with SVG circles. The legend next to it lists every
 * segment with its number and share, so the chart is never the only way to
 * read the values. Legend entries link through when `href` is given.
 */

export interface DonutSegment {
  label: string;
  value: number;
  href?: string;
  color?: string;
}

/** Eight distinguishable tones; the first is the brand maroon (#6B0202). */
export const DONUT_PALETTE = [
  "#6B0202",
  "#C08A2C",
  "#2E7D32",
  "#1F7A6D",
  "#5B6B7A",
  "#7B4B94",
  "#C2571B",
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
}: {
  segments: readonly DonutSegment[];
  centerLabel: string;
  formatValue?: (value: number) => string;
  ariaLabel: string;
  emptyMessage?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (segments.length === 0 || total <= 0) {
    return (
      <div className="aa-chart">
        <p className="aa-muted">{emptyMessage}</p>
      </div>
    );
  }
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
    <div className="aa-chart">
      <div className="aa-donut-wrap">
        <svg
          className="aa-donut"
          viewBox="0 0 140 140"
          role="img"
          aria-label={`${ariaLabel}. Total ${formatValue(total)}.`}
        >
          <circle cx="70" cy="70" r={RADIUS} fill="none" stroke="#F1ECEC" strokeWidth="26" />
          {arcs
            .filter((arc) => arc.segment.value > 0)
            .map((arc, index) => (
              <circle
                key={`${arc.segment.label}-${index}`}
                cx="70"
                cy="70"
                r={RADIUS}
                fill="none"
                stroke={arc.color}
                strokeWidth="26"
                strokeDasharray={arc.dashArray}
                strokeDashoffset={arc.dashOffset}
                transform="rotate(-90 70 70)"
              >
                <title>{`${arc.segment.label}: ${formatValue(arc.segment.value)}`}</title>
              </circle>
            ))}
          <text x="70" y="66" textAnchor="middle" fontSize="20" fontWeight="600" fill="#171717">
            {formatValue(total)}
          </text>
          <text x="70" y="84" textAnchor="middle" fontSize="11" fill="#74706C">
            {centerLabel}
          </text>
        </svg>
        <ul className="aa-legend" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {segments.map((segment, index) => {
            const color =
              segment.color ?? DONUT_PALETTE[index % DONUT_PALETTE.length] ?? "#9A9494";
            const share = total > 0 ? Math.round((segment.value / total) * 100) : 0;
            const text = (
              <>
                <span className="aa-swatch" style={{ background: color }} aria-hidden="true" />
                {segment.label} · {formatValue(segment.value)} ({share}%)
              </>
            );
            return (
              <li key={`${segment.label}-${index}`}>
                {segment.href ? <Link href={segment.href}>{text}</Link> : text}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
