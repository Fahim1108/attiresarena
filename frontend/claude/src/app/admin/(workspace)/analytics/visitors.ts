/**
 * Total Visitors data seam for the Analytics page.
 *
 * There is currently NO visitor/pageview data source in the app: no
 * visitor table, no stored counts, and no read-back API. The only
 * related code sends data out (the Meta Pixel PageView event and the
 * Google Analytics gtag snippet), and getAnalyticsReport() covers
 * orders/sales/inventory/customers only.
 *
 * getVisitorReport() is therefore the single seam a future build
 * replaces: Fahim decided (2026-11-17) that Google Analytics will be
 * the source, as a separate follow-up build after this redesign,
 * reading back through the GA Data API once a GA4 property and
 * API/service-account access exist (whether either is live is
 * unverified). That build replaces this accessor's body with the
 * real read-back and fills `points`; until then this accessor
 * returns the honest unavailable state below and the graph shows an
 * empty state. Never seed, estimate, smooth, or demo visitor
 * numbers here.
 */

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
 * Visitor report for one period. `status` is always `"unavailable"`
 * until a real source is wired in, and `points` is always empty, so
 * the graph renders its empty state and no visitor number is shown.
 */
export type VisitorReport = {
  status: "unavailable";
  period: VisitorPeriod;
  points: readonly VisitorPoint[];
};

export function getVisitorReport(period: VisitorPeriod): VisitorReport {
  return { status: "unavailable", period, points: [] };
}
