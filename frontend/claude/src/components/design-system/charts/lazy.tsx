"use client";

import dynamic from "next/dynamic";
import type { AdminAreaChartProps } from "./AdminAreaChart";
import type { AdminDonutChartProps } from "./AdminDonutChart";

/**
 * Lazy Recharts wrappers. Recharts is heavy; these dynamic imports keep
 * it out of every bundle except pages that render a chart
 * (react_best_practices bundle-dynamic-imports). Always import the
 * Lazy* wrappers from pages — never import AdminAreaChart /
 * AdminDonutChart directly from a page.
 */

function ChartLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex min-h-[260px] items-center justify-center rounded-admin-card border border-admin-border bg-admin-card"
    >
      <p className="animate-pulse text-sm text-admin-text-secondary">Loading…</p>
    </div>
  );
}

const AdminAreaChartInner = dynamic(
  () => import("./AdminAreaChart").then((mod) => mod.AdminAreaChart),
  {
    ssr: false,
    loading: () => <ChartLoading label="Loading chart" />,
  },
);

const AdminDonutChartInner = dynamic(
  () => import("./AdminDonutChart").then((mod) => mod.AdminDonutChart),
  {
    ssr: false,
    loading: () => <ChartLoading label="Loading chart" />,
  },
);

export function LazyAreaChart(props: AdminAreaChartProps) {
  return <AdminAreaChartInner {...props} />;
}

export function LazyDonutChart(props: AdminDonutChartProps) {
  return <AdminDonutChartInner {...props} />;
}
