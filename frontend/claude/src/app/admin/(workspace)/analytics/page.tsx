import { Banknote, CircleDollarSign, Receipt, TrendingUp } from "lucide-react";
import { PageHeading, Panel, Notice, EmptyState } from "@/components/admin/ui";
import { CsvDownloadButton } from "@/components/admin/analytics/csv-download";
import { BarChart } from "@/components/admin/charts/BarChart";
import { CountUpValue } from "@/components/admin/charts/CountUpValue";
import { DonutChart, DONUT_PALETTE } from "@/components/admin/charts/DonutChart";
import { SeriesChart } from "@/components/admin/charts/SeriesChart";
import { PeriodToggle } from "@/components/admin/PeriodToggle";
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

/**
 * Money values are passed in minor units with formatMoney as the formatter;
 * the donut passes order counts with formatCount.
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
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Analytics"
        title="Reports"
        description={`Real order data, ${formatDate(range.from)} to ${formatDate(range.to)}. Gross sales exclude cancelled and returned orders; net revenue is merchandise subtotal minus discounts, excluding delivery charges.`}
        actions={
          <CsvDownloadButton action={exportDailySalesCsv} from={range.from} to={range.to} />
        }
      />
      <div className="aa-toolbar">
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
      <form method="get" action="/admin/analytics" className="aa-toolbar">
        <div className="aa-field">
          <label htmlFor="analytics-from">From</label>
          <input id="analytics-from" type="date" name="from" defaultValue={range.from} />
        </div>
        <div className="aa-field">
          <label htmlFor="analytics-to">To</label>
          <input id="analytics-to" type="date" name="to" defaultValue={range.to} />
        </div>
        <button type="submit" className="aa-button">
          Apply range
        </button>
      </form>

      {!report.ordersAvailable ? (
        <Notice kind="warning">
          Order data is unavailable. Reports will appear once order records
          and the analytics permission are in place.
        </Notice>
      ) : null}

      <div className="aa-kpi-grid">
        <article className="aa-panel aa-kpi">
          <div className="aa-section-heading">
            <span>Gross sales</span>
            <span className="aa-kpi-icon">
              <Banknote size={18} strokeWidth={1.5} aria-hidden="true" />
            </span>
          </div>
          <strong>
            <CountUpValue value={report.grossSalesMinor} format="money" />
          </strong>
          <span className="aa-kpi-delta">Order totals, excl. cancelled/returned</span>
        </article>
        <article className="aa-panel aa-kpi">
          <div className="aa-section-heading">
            <span>Net revenue</span>
            <span className="aa-kpi-icon">
              <TrendingUp size={18} strokeWidth={1.5} aria-hidden="true" />
            </span>
          </div>
          <strong>
            <CountUpValue value={report.netRevenueMinor} format="money" />
          </strong>
          <span className="aa-kpi-delta">Subtotal minus discounts, excl. delivery</span>
        </article>
        <article className="aa-panel aa-kpi">
          <div className="aa-section-heading">
            <span>Total orders</span>
            <span className="aa-kpi-icon">
              <Receipt size={18} strokeWidth={1.5} aria-hidden="true" />
            </span>
          </div>
          <strong>
            <CountUpValue value={report.totalOrders} format="count" />
          </strong>
          <span className="aa-kpi-delta">Excl. cancelled/returned</span>
        </article>
        <article className="aa-panel aa-kpi">
          <div className="aa-section-heading">
            <span>Average order value</span>
            <span className="aa-kpi-icon">
              <CircleDollarSign size={18} strokeWidth={1.5} aria-hidden="true" />
            </span>
          </div>
          <strong>
            <CountUpValue value={report.averageOrderMinor} format="money" />
          </strong>
          <span className="aa-kpi-delta">Gross sales ÷ orders</span>
        </article>
      </div>

      <Panel
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
      </Panel>

      <Panel title="Daily gross sales (BDT)">
        <SeriesChart
          points={report.dailySeries}
          formatValue={formatMoney}
          ariaLabel="Daily gross sales"
          emptyMessage="No gross sales in this range."
          emptyGuidance="Daily sales appear here once orders are placed in the selected range."
        />
      </Panel>

      <Panel title="Orders by status">
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
      </Panel>

      <Panel title="Best sellers">
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
      </Panel>

      <Panel title="Sales by category">
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
      </Panel>

      <Panel title="Coupon performance">
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
      </Panel>

      <Panel title="Inventory report (read-only)">
        {report.inventory === null ? (
          <p>Inventory data is unavailable.</p>
        ) : (
          <dl className="aa-fact-grid">
            <div>
              <dt>Variants tracked</dt>
              <dd>
                <CountUpValue value={report.inventory.totalVariants} format="count" />
              </dd>
            </div>
            <div>
              <dt>In stock</dt>
              <dd>
                <CountUpValue value={report.inventory.inStock} format="count" />
              </dd>
            </div>
            <div>
              <dt>Out of stock</dt>
              <dd>
                <CountUpValue value={report.inventory.outOfStock} format="count" />
              </dd>
            </div>
            <div>
              <dt>Low stock</dt>
              <dd>
                <CountUpValue value={report.inventory.lowStock} format="count" />
              </dd>
            </div>
          </dl>
        )}
      </Panel>

      <Panel title="Customer trends">
        {report.customerTrends === null ? (
          <p>Customer trend data is unavailable.</p>
        ) : (
          <dl className="aa-fact-grid">
            <div>
              <dt>New customers (phone first seen in range)</dt>
              <dd>
                <CountUpValue value={report.customerTrends.newCustomers} format="count" />
              </dd>
            </div>
            <div>
              <dt>Returning customers (phone ordered before)</dt>
              <dd>
                <CountUpValue value={report.customerTrends.returningCustomers} format="count" />
              </dd>
            </div>
          </dl>
        )}
      </Panel>
    </main>
  );
}
