"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { hasChartData } from "@/design-system/chart-data";
import { adminTokens } from "@/design-system/tokens";
import { usePrefersReducedMotion } from "@/design-system/use-prefers-reduced-motion";
import { ChartEmpty } from "../ChartCard";
import { ChartTooltip } from "./ChartTooltip";

/**
 * AdminAreaChart — Recharts area chart for a trend series with an
 * optional previous-period comparison series. Client-only: import via
 * LazyAreaChart (./lazy) so Recharts loads on demand.
 *
 * Real data only: an empty or all-zero series renders ChartEmpty.
 * Numbers are always available as a data table inside <details>, so
 * the chart is never the only way to read the values (mirrors the
 * existing hand-built admin/charts pattern). Animation honours
 * prefers-reduced-motion.
 */

export interface AreaChartDatum {
  label: string;
  value: number;
  /** Previous-equivalent-period value at the same position, when known. */
  compareValue?: number;
}

export interface AdminAreaChartProps {
  data: readonly AreaChartDatum[];
  /** Accessible name describing the chart (read by screen readers). */
  ariaLabel: string;
  /** Caller-provided formatting (Intl numbers/currency). */
  formatValue?: (value: number) => string;
  emptyTitle?: string;
  emptyGuidance?: string;
  height?: number;
  className?: string;
}

const DEFAULT_FORMAT = (value: number): string => String(value);

export function AdminAreaChart({
  data,
  ariaLabel,
  formatValue = DEFAULT_FORMAT,
  emptyTitle = "No data in this period.",
  emptyGuidance = "Data appears here once there is something to show for the selected period.",
  height = 260,
  className,
}: AdminAreaChartProps) {
  const gradientId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const hasComparison = data.some((datum) => datum.compareValue !== undefined);
  const primary = adminTokens.chart.palette[0] ?? adminTokens.colors.primary;

  if (!hasChartData(data)) {
    return <ChartEmpty title={emptyTitle} guidance={emptyGuidance} />;
  }

  return (
    <div className={className}>
      <div role="img" aria-label={ariaLabel} className="w-full">
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={[...data]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={primary} stopOpacity={0.25} />
                <stop offset="100%" stopColor={primary} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke={adminTokens.chart.grid}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: adminTokens.chart.axisText, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: adminTokens.chart.axisText, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatValue}
              width={64}
            />
            <Tooltip
              content={<ChartTooltip formatValue={formatValue} />}
              cursor={{ stroke: adminTokens.chart.grid }}
            />
            {hasComparison ? (
              <Area
                type="monotone"
                dataKey="compareValue"
                name="Previous period"
                stroke={adminTokens.chart.comparison}
                strokeWidth={2}
                strokeDasharray="5 4"
                fill="none"
                isAnimationActive={!reducedMotion}
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="value"
              name="Current period"
              stroke={primary}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              isAnimationActive={!reducedMotion}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[13px] text-admin-text-secondary hover:text-admin-text">
          View data as table
        </summary>
        <table className="mt-2 w-full text-[13px] text-admin-text">
          <thead>
            <tr className="border-b border-admin-border text-left">
              <th scope="col" className="py-1.5 pr-3 font-medium">Period</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">Value</th>
              {hasComparison ? (
                <th scope="col" className="py-1.5 text-right font-medium">Previous period</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {data.map((datum) => (
              <tr key={datum.label} className="border-b border-admin-border last:border-b-0">
                <th scope="row" className="py-1.5 pr-3 font-normal">{datum.label}</th>
                <td className="admin-ds-numeric py-1.5 pr-3 text-right">{formatValue(datum.value)}</td>
                {hasComparison ? (
                  <td className="admin-ds-numeric py-1.5 text-right">
                    {datum.compareValue === undefined ? "—" : formatValue(datum.compareValue)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
