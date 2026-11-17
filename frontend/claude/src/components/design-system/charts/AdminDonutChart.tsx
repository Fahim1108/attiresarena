"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { chartTotal, hasChartData } from "@/design-system/chart-data";
import { adminTokens } from "@/design-system/tokens";
import { usePrefersReducedMotion } from "@/design-system/use-prefers-reduced-motion";
import { ChartEmpty } from "../ChartCard";
import { ChartTooltip } from "./ChartTooltip";

/**
 * AdminDonutChart — Recharts donut for part-of-whole data (e.g. the
 * colourful order-status split). Client-only: import via LazyDonutChart
 * (./lazy) so Recharts loads on demand.
 *
 * Real data only: an empty or all-zero series renders ChartEmpty.
 * Every segment also appears in the HTML legend with its exact value
 * and share, so the chart is never the only way to read the values.
 * Segment colours come from the token chart palette by position.
 * Animation honours prefers-reduced-motion.
 */

export interface DonutChartDatum {
  label: string;
  value: number;
}

export interface AdminDonutChartProps {
  data: readonly DonutChartDatum[];
  /** Accessible name describing the chart (read by screen readers). */
  ariaLabel: string;
  /** Caller-provided formatting (Intl numbers/currency). */
  formatValue?: (value: number) => string;
  /** Caption under the centre total, e.g. "Orders". */
  totalLabel?: string;
  emptyTitle?: string;
  emptyGuidance?: string;
  height?: number;
  className?: string;
}

const DEFAULT_FORMAT = (value: number): string => String(value);

export function AdminDonutChart({
  data,
  ariaLabel,
  formatValue = DEFAULT_FORMAT,
  totalLabel = "Total",
  emptyTitle = "No data to show.",
  emptyGuidance = "Data appears here once there is something to show for the selected period.",
  height = 260,
  className,
}: AdminDonutChartProps) {
  const reducedMotion = usePrefersReducedMotion();
  const total = chartTotal(data);

  if (!hasChartData(data)) {
    return <ChartEmpty title={emptyTitle} guidance={emptyGuidance} />;
  }

  const palette = adminTokens.chart.palette;
  const segments = data.map((datum, index) => ({
    ...datum,
    color: palette[index % palette.length] ?? adminTokens.colors.primary,
    share: total > 0 ? datum.value / total : 0,
  }));

  return (
    <div className={className}>
      <div className="relative w-full">
        <div role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Tooltip content={<ChartTooltip formatValue={formatValue} />} />
              <Pie
                data={[...segments]}
                dataKey="value"
                nameKey="label"
                innerRadius="62%"
                outerRadius="85%"
                paddingAngle={2}
                cornerRadius={4}
                strokeWidth={0}
                isAnimationActive={!reducedMotion}
              >
                {segments.map((segment) => (
                  <Cell key={segment.label} fill={segment.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
        >
          <p className="admin-ds-numeric text-2xl font-semibold text-admin-text">
            {formatValue(total)}
          </p>
          <p className="text-xs text-admin-text-secondary">{totalLabel}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-2 text-[13px]">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span className="min-w-0 flex-1 text-admin-text [overflow-wrap:anywhere]">
              {segment.label}
            </span>
            <span className="admin-ds-numeric font-medium text-admin-text">
              {formatValue(segment.value)}
            </span>
            <span className="admin-ds-numeric w-12 text-right text-admin-text-secondary">
              {`${Math.round(segment.share * 100)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
