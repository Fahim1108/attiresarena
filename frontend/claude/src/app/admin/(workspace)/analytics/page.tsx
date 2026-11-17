import type { ReactNode } from "react";
import { Banknote, CircleDollarSign, Receipt, TrendingUp } from "lucide-react";
import { Notice, EmptyState, hrefWithParams } from "@/components/admin/ui";
import { CsvDownloadButton } from "@/components/admin/analytics/csv-download";
import { BarChart } from "@/components/admin/charts/BarChart";
import { CountUpValue } from "@/components/admin/charts/CountUpValue";
import { DonutChart, DONUT_PALETTE } from "@/components/admin/charts/DonutChart";
import { SeriesChart } from "@/components/admin/charts/SeriesChart";
import { PeriodToggle } from "@/components/admin/PeriodToggle";
import { PageHeader } from "@/components/design-system/PageHeader";
import { StatCard } from "@/components/design-system/StatCard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/design-system/Card";
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
 * Money values are passed in minor units with formatMoney as the formatter;
 * the donut passes order counts with formatCount.
 *
 * Presentation uses the admin design-system components (PageHeader,
 * StatCard, Card, ChartCard); every figure, control and handler is
 * unchanged. Charts keep the hand-built SeriesChart, DonutChart and
 * BarChart: their legends link to filtered order lists and their data
 * tables stay available, which the Recharts wrappers do not offer.
 * Total Visitors follows the same pattern: SeriesChart fed by the
 * co-located visitors.ts seam, which returns an honest unavailable
 * state until a real visitor source is wired in.
 */

/** Card panel with a title row and an optional description. */
function ReportPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle headingLevel="h2">{title}</CardTitle>
        {description ? (
          <CardDescription>{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Labelled facts (inventory counts, customer trends). */
function FactGrid({
  items,
}: {
  items: { term: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.term} className="min-w-0">
          <dt className="text-xs font-medium text-admin-text-secondary">
            {item.term}
          </dt>
          <dd className="admin-ds-numeric mt-1 text-2xl font-semibold text-admin-text">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

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
  // the report range above untouched. The accessor returns no data
  // until a real visitor source exists; only the period label and
  // the selector's active option change between periods.
  const visitorPeriod = parseVisitorPeriod(params[VISITOR_PERIOD_PARAM]);
  const visitorReport = getVisitorReport(visitorPeriod);
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
          description={`Real order data, ${formatDate(range.from)} to ${formatDate(range.to)}. Gross sales exclude cancelled and returned orders; net revenue is merchandise subtotal minus discounts, excluding delivery charges.`}
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

        <section aria-label="Report totals">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard
              label="Gross sales"
              value={<CountUpValue value={report.grossSalesMinor} format="money" />}
              description="Order totals, excl. cancelled/returned"
              icon={<Banknote size={18} strokeWidth={1.5} aria-hidden="true" />}
            />
            <StatCard
              label="Net revenue"
              value={<CountUpValue value={report.netRevenueMinor} format="money" />}
              description="Subtotal minus discounts, excl. delivery"
              icon={<TrendingUp size={18} strokeWidth={1.5} aria-hidden="true" />}
            />
            <StatCard
              label="Total orders"
              value={<CountUpValue value={report.totalOrders} format="count" />}
              description="Excl. cancelled/returned"
              icon={<Receipt size={18} strokeWidth={1.5} aria-hidden="true" />}
            />
            <StatCard
              label="Average order value"
              value={<CountUpValue value={report.averageOrderMinor} format="money" />}
              description="Gross sales ÷ orders"
              icon={<CircleDollarSign size={18} strokeWidth={1.5} aria-hidden="true" />}
            />
          </div>
        </section>

        <ReportPanel
          title="Profit"
          description="Profit is revenue minus recorded cost prices on delivered orders only. It is never estimated."
        >
          {report.costsHidden ? (
            <p>
              Profit and cost figures are hidden for your role. Cost prices are
              visible only to owners, admins and product managers. The revenue
              figures above are unaffected.
            </p>
          ) : !report.profitAvailable || !report.profit ? (
            <p>Profit is unavailable — no cost prices are recorded.</p>
          ) : (
            <>
              <p>
                Profit: <strong>{formatMoney(report.profit.profitMinor)}</strong>{" "}
                (revenue {formatMoney(report.profit.revenueMinor)} minus cost{" "}
                {formatMoney(report.profit.costMinor)}).
              </p>
              {report.profit.itemsWithCost < report.profit.deliveredItems ? (
                <Notice kind="warning">
                  Partial figure: {report.profit.itemsWithCost} of{" "}
                  {report.profit.deliveredItems} delivered items have cost
                  prices; items without cost prices are excluded.
                </Notice>
              ) : null}
            </>
          )}
        </ReportPanel>

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
            emptyGuidance="Visitor data is not connected yet."
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

        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard title="Best sellers" headingLevel="h2">
            {report.bestSellers.length === 0 ? (
              <EmptyState
                title="No sales in this range"
                description="Best sellers appear once orders with items exist in the selected range."
              />
            ) : (
              <>
                <BarChart
                  bars={report.bestSellers.map((item) => ({
                    label: item.productName,
                    value: item.revenueMinor,
                  }))}
                  formatValue={formatMoney}
                  ariaLabel="Best sellers by revenue"
                  emptyMessage="No sales in this range."
                  emptyGuidance="Best sellers appear once orders with items exist in the selected range."
                />
                <div className="aa-table-scroll">
                  <table className="aa-table">
                    <thead>
                      <tr>
                        <th scope="col">Product</th>
                        <th scope="col">Quantity</th>
                        <th scope="col">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.bestSellers.map((item) => (
                        <tr key={item.productName}>
                          <th scope="row" className="aa-cell-main">{item.productName}</th>
                          <td data-label="Quantity">{formatCount(item.quantity)}</td>
                          <td data-label="Revenue">{formatMoney(item.revenueMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </ChartCard>

          <ReportPanel title="Sales by category">
            {report.salesByCategory.length === 0 ? (
              <EmptyState
                title="No category sales in this range"
                description="Category sales appear once orders with items exist in the selected range."
              />
            ) : (
              <div className="aa-table-scroll">
                <table className="aa-table">
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.salesByCategory.map((row) => (
                      <tr key={row.category}>
                        <th scope="row" className="aa-cell-main">{row.category}</th>
                        <td data-label="Revenue">{formatMoney(row.revenueMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ReportPanel>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <ReportPanel title="Coupon performance">
            {report.couponPerformance === null ? (
              <p>
                Coupon redemption data is unavailable — checkout coupon wiring
                is pending. Redemptions will appear here once coupons are
                redeemed through checkout.
              </p>
            ) : report.couponPerformance.length === 0 ? (
              <EmptyState
                title="No redemptions in this range"
                description="Checkout coupon wiring is pending; no coupon redemptions were recorded in the selected range."
              />
            ) : (
              <div className="aa-table-scroll">
                <table className="aa-table">
                  <thead>
                    <tr>
                      <th scope="col">Coupon</th>
                      <th scope="col">Redemptions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.couponPerformance.map((row) => (
                      <tr key={row.code}>
                        <th scope="row" className="aa-cell-main">{row.code}</th>
                        <td data-label="Redemptions">{formatCount(row.redemptions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="aa-muted">
              Discount amounts are recorded on orders, not per redemption, so
              this report counts redemptions only.
            </p>
          </ReportPanel>

          <ReportPanel title="Inventory report (read-only)">
            {report.inventory === null ? (
              <p>Inventory data is unavailable.</p>
            ) : (
              <FactGrid
                items={[
                  {
                    term: "Variants tracked",
                    value: <CountUpValue value={report.inventory.totalVariants} format="count" />,
                  },
                  {
                    term: "In stock",
                    value: <CountUpValue value={report.inventory.inStock} format="count" />,
                  },
                  {
                    term: "Out of stock",
                    value: <CountUpValue value={report.inventory.outOfStock} format="count" />,
                  },
                  {
                    term: "Low stock",
                    value: <CountUpValue value={report.inventory.lowStock} format="count" />,
                  },
                ]}
              />
            )}
          </ReportPanel>
        </div>

        <ReportPanel title="Customer trends">
          {report.customerTrends === null ? (
            <p>Customer trend data is unavailable.</p>
          ) : (
            <FactGrid
              items={[
                {
                  term: "New customers (phone first seen in range)",
                  value: <CountUpValue value={report.customerTrends.newCustomers} format="count" />,
                },
                {
                  term: "Returning customers (phone ordered before)",
                  value: <CountUpValue value={report.customerTrends.returningCustomers} format="count" />,
                },
              ]}
            />
          )}
        </ReportPanel>
      </div>
    </main>
  );
}
