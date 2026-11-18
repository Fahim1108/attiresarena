/**
 * Total Visitors data seam for the Analytics page.
 *
 * Source: Google Analytics (Fahim's decision, 2026-11-17), read back
 * through the GA Data API by src/lib/admin/ga-visitors.ts — a
 * service-account read, strictly env-gated and server-only. Whether
 * a GA4 property or measurement ID is live is UNVERIFIED (the owner
 * confirms it in his browser); until the env config exists, and on
 * any API failure, getVisitorReport() returns the honest unavailable
 * state below and the graph shows its empty state. Never seed,
 * estimate, smooth, or demo visitor numbers here.
 */

import { readGaDailyVisitors } from "@/lib/admin/ga-visitors";

/** Visitor periods, in the order Fahim listed them. */
export const VISITOR_PERIODS = [
  "today",
  "7-days",
  "15-days",
  "1-month",
] as const;

export type VisitorPeriod = (typeof VISITOR_PERIODS)[number];

export const VISITOR_PERIOD_LABELS: Record<VisitorPeriod, string> = {
  today: "Today",
  "7-days": "7 days",
  "15-days": "15 days",
  "1-month": "1 month",
};

/** Period used when the query param is absent or unknown. */
export const DEFAULT_VISITOR_PERIOD: VisitorPeriod = "7-days";

/** Query-param name carrying the selected visitor period. */
export const VISITOR_PERIOD_PARAM = "visitorsPeriod";

/** Normalise the raw `visitorsPeriod` query value to a valid period. */
export function parseVisitorPeriod(
  value: string | string[] | undefined,
): VisitorPeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  if (
    raw !== undefined &&
    (VISITOR_PERIODS as readonly string[]).includes(raw)
  ) {
    return raw as VisitorPeriod;
  }
  return DEFAULT_VISITOR_PERIOD;
}

/** One plotted visitor total. Mirrors SeriesPoint (label + value). */
export type VisitorPoint = {
  label: string;
  value: number;
};

/**
 * Visitor report for one period. `status` is `"unavailable"` (with
 * empty `points`) whenever the GA env config is absent or the read
 * fails, so the graph renders its empty state and no visitor number
 * is shown. `"available"` means the API answered; `points` may still
 * be empty when no visitors were recorded in the period.
 */
export type VisitorReport = {
  status: "available" | "unavailable";
  period: VisitorPeriod;
  points: readonly VisitorPoint[];
};

/**
 * Test-only overrides (env/fetch injection, courier.ts pattern).
 * Production callers pass none: config comes from process.env and
 * the read uses the global fetch.
 */
export type VisitorReportOverrides = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

export async function getVisitorReport(
  period: VisitorPeriod,
  overrides?: VisitorReportOverrides,
): Promise<VisitorReport> {
  const points = await readGaDailyVisitors(period, overrides);
  if (points === null) {
    return { status: "unavailable", period, points: [] };
  }
  return { status: "available", period, points };
}
