import { Notice, EmptyState, hrefWithParams } from "@/components/admin/ui";
import { CsvDownloadButton } from "@/components/admin/analytics/csv-download";
import { DonutChart, DONUT_PALETTE } from "@/components/admin/charts/DonutChart";
import { SeriesChart } from "@/components/admin/charts/SeriesChart";
import { PeriodToggle } from "@/components/admin/PeriodToggle";
import { PageHeader } from "@/components/design-system/PageHeader";
import { ChartCard } from "@/components/design-system/ChartCard";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  isOrderStatus,
} from "@/lib/admin/constants";
import {
  exportDailySalesCsv,
  getAnalyticsReport,
} from "@/lib/admin/analytics";
import { formatCount, formatDate, formatMoney, toDhakaDateKey } from "@/lib/admin/format";
import {
  VISITOR_PERIODS,
  VISITOR_PERIOD_LABELS,
  VISITOR_PERIOD_PARAM,
  getVisitorReport,
  parseVisitorPeriod,
} from "./visitors";

/**
 * Analytics shows exactly three things, each distinct from the
 * Dashboard: the daily gross-sales (revenue) graph, the orders-by-
 * status donut (the delivery-status pie chart), and total visitors.
 * The totals cards, profit panel, best sellers, sales by category,
 * coupon performance, inventory report and customer trends were
 * removed — they duplicated the Dashboard (revenue, orders,
 * customers, best sellers, stock) or were not one of the three.
 * Every figure here still comes from the same real-data loaders;
 * nothing is estimated or filled in. Total Visitors follows the
 * same pattern as before: SeriesChart fed by the co-located
 * visitors.ts seam, which reads the GA Data API when configured
 * and returns an honest unavailable state otherwise.
 */

function shiftDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function presets(): { label: string; from: string; to: string }[] {
  const today = toDhakaDateKey(new Date());
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const prevMonth = new Date(Date.UTC(year, month - 2, 1));
  const prevKey = prevMonth.toISOString().slice(0, 10);
  const prevFirst = `${prevKey.slice(0, 7)}-01`;
  const prevLast = shiftDays(firstOfMonth, -1);
  return [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: shiftDays(today, -1), to: shiftDays(today, -1) },
    { label: "Last 7 days", from: shiftDays(today, -6), to: today },
    { label: "Last 30 days", from: shiftDays(today, -29), to: today },
    { label: "This month", from: firstOfMonth, to: today },
    { label: "Previous month", from: prevFirst, to: prevLast },
  ];
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const report = await getAnalyticsReport(params);
  const { range } = report;

  // Total Visitors period: URL state only (visitorsPeriod param), so
  // the selector is a set of deep links and switching periods keeps
  // the report range above untouched. The accessor reads the GA Data
  // API when configured and returns the honest unavailable state
  // otherwise; only the period label, the selector's active option,
  // and the empty-state guidance change between periods.
  const visitorPeriod = parseVisitorPeriod(params[VISITOR_PERIOD_PARAM]);
  const visitorReport = await getVisitorReport(visitorPeriod);
  const visitorPeriodLabel = VISITOR_PERIOD_LABELS[visitorPeriod];
  const visitorPeriodPhrase =
    visitorPeriod === "today" ? "today" : visitorPeriodLabel;

  // Presentation shaping only (the loader is untouched): order the
  // status distribution by the fixed ORDER_STATUSES order, label it
  // with the shared labels, colour it from the shared palette, and
  // link each known status to its filtered order list. Unknown
  // statuses (none are expected) keep their raw label and a neutral
  // grey, so no data is ever dropped or renamed.
  const statusOrder = new Map<string, number>(
    ORDER_STATUSES.map((status, index) => [status, index]),
  );
  const donutSegments = [...report.statusDistribution]
    .sort(
      (a, b) =>
        (statusOrder.get(a.label) ?? ORDER_STATUSES.length) -
        (statusOrder.get(b.label) ?? ORDER_STATUSES.length),
    )
    .map((row) => {
      const status = isOrderStatus(row.label) ? row.label : null;
      const index = status === null ? -1 : (statusOrder.get(status) ?? -1);
      return {
        label: status === null ? row.label : ORDER_STATUS_LABELS[status],
        value: row.value,
        href:
          status === null
            ? undefined
            : `/admin/sales/orders?status=${status}`,
        color: index >= 0 ? (DONUT_PALETTE[index] ?? "#9A9494") : "#9A9494",
      };
    });

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description={`Daily gross sales, orders by status and total visitors, ${formatDate(range.from)} to ${formatDate(range.to)}. Gross sales exclude cancelled and returned orders.`}
          actions={
            <CsvDownloadButton action={exportDailySalesCsv} from={range.from} to={range.to} />
          }
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Analytics
          </p>
        </PageHeader>

        <div>
          <PeriodToggle
            options={presets().map((preset) => ({
              value: `${preset.from}|${preset.to}`,
              label: preset.label,
              href: `/admin/analytics?from=${preset.from}&to=${preset.to}`,
            }))}
            activeValue={`${range.from}|${range.to}`}
            ariaLabel="Date presets"
          />
        </div>

        <form
          method="get"
          action="/admin/analytics"
          className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <div className="min-w-0">
            <label
              htmlFor="analytics-from"
              className="mb-1 block text-xs font-medium text-admin-text-secondary"
            >
              From
            </label>
            <input
              id="analytics-from"
              type="date"
              name="from"
              defaultValue={range.from}
              className="h-11 rounded-admin-control border border-admin-border bg-admin-card px-3 text-sm text-admin-text"
            />
          </div>
          <div className="min-w-0">
            <label
              htmlFor="analytics-to"
              className="mb-1 block text-xs font-medium text-admin-text-secondary"
            >
              To
            </label>
            <input
              id="analytics-to"
              type="date"
              name="to"
              defaultValue={range.to}
              className="h-11 rounded-admin-control border border-admin-border bg-admin-card px-3 text-sm text-admin-text"
            />
          </div>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-admin-control bg-admin-primary px-4 text-sm font-medium text-white transition-colors hover:bg-admin-primary/90"
          >
            Apply range
          </button>
        </form>

        {!report.ordersAvailable ? (
          <Notice kind="warning">
            Order data is unavailable. Reports will appear once order records
            and the analytics permission are in place.
          </Notice>
        ) : null}

        <ChartCard title="Daily gross sales (BDT)" headingLevel="h2">
          <SeriesChart
            points={report.dailySeries}
            formatValue={formatMoney}
            ariaLabel="Daily gross sales"
            emptyMessage="No gross sales in this range."
            emptyGuidance="Daily sales appear here once orders are placed in the selected range."
          />
        </ChartCard>

        <ChartCard
          title="Total Visitors"
          description={`Daily visitor totals for ${visitorPeriodPhrase}.`}
          headingLevel="h2"
        >
          <div className="mb-4">
            <PeriodToggle
              options={VISITOR_PERIODS.map((period) => ({
                value: period,
                label: VISITOR_PERIOD_LABELS[period],
                href: hrefWithParams("/admin/analytics", params, {
                  [VISITOR_PERIOD_PARAM]: period,
                }),
              }))}
              activeValue={visitorPeriod}
              ariaLabel="Visitor period"
            />
          </div>
          <SeriesChart
            points={visitorReport.points}
            formatValue={formatCount}
            ariaLabel="Total visitors"
            emptyMessage={`No visitor data for ${visitorPeriodPhrase}.`}
            emptyGuidance={
              visitorReport.status === "available"
                ? "No visitors were recorded in this period."
                : "Visitor data is not connected yet."
            }
          />
        </ChartCard>

        <ChartCard title="Orders by status" headingLevel="h2">
          {report.statusDistribution.length === 0 ? (
            <EmptyState
              title="No orders in this range"
              description="Orders placed in the selected range will appear here."
            />
          ) : (
            <DonutChart
              segments={donutSegments}
              centerLabel="Orders"
              formatValue={formatCount}
              ariaLabel="Orders by status"
              emptyMessage="No orders in this range."
              emptyGuidance="Orders placed in the selected range will appear here."
            />
          )}
        </ChartCard>
      </div>
    </main>
  );
}
