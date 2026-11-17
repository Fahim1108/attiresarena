import { adminTokens } from "@/design-system/tokens";

/**
 * Shared Recharts tooltip. Colours come from adminTokens (SVG/tooltip
 * chrome cannot resolve CSS var() reliably, so token hex is used here —
 * never hex written in a component). Values are formatted by the
 * caller-provided formatter; nothing is invented.
 */

interface TooltipEntry {
  name?: string;
  value?: number | string | readonly number[];
  color?: string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
  formatValue: (value: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-admin-control border px-3 py-2 text-[13px] shadow-admin-lift"
      style={{
        backgroundColor: adminTokens.chart.tooltipBg,
        borderColor: adminTokens.chart.tooltipBorder,
        color: adminTokens.chart.tooltipText,
      }}
    >
      {label !== undefined ? (
        <p className="mb-1 font-medium">{String(label)}</p>
      ) : null}
      <ul className="space-y-0.5">
        {payload.map((entry, index) => (
          <li key={`${entry.name ?? "value"}-${index}`} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  entry.color ?? adminTokens.chart.palette[0] ?? adminTokens.colors.primary,
              }}
            />
            <span className="min-w-0">{entry.name}</span>
            <span className="admin-ds-numeric ml-auto font-medium">
              {typeof entry.value === "number"
                ? formatValue(entry.value)
                : String(entry.value ?? "")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
