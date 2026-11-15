import Link from "next/link";
import {
  Boxes,
  Receipt,
  Banknote,
  Users,
  Hourglass,
  ClipboardCheck,
  Package,
  Truck,
  PackageCheck,
  CheckCircle2,
  XCircle,
  Undo2,
  FolderClock,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import { requireStaff } from "@/lib/admin/authorization";
import { adminConfiguration } from "@/lib/admin/supabase";
import {
  loadDashboard,
  periodDelta,
  resolveGranularity,
  revenueGranularitySchema,
  summarizeRevenue,
  withComparisonSeries,
  addDaysToKey,
  type RevenueGranularity,
} from "@/lib/admin/dashboard";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type OrderStatus,
} from "@/lib/admin/constants";
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyShort,
  parseDateRange,
  toDhakaDateKey,
} from "@/lib/admin/format";
import {
  EmptyState,
  Notice,
  PageHeading,
  Panel,
  StatusBadge,
  hrefWithParams,
} from "@/components/admin/ui";
import { BarChart } from "@/components/admin/charts/BarChart";
import { DonutChart, DONUT_PALETTE } from "@/components/admin/charts/DonutChart";
import { ProductThumbnail } from "@/components/admin/access/ProductThumbnail";
import styles from "./dashboard.module.css";

/**
 * Dashboard: real queries only, through the staff session client (RLS
 * enforced). Order KPIs, status counts and the revenue chart cover the
 * selected Dhaka-date period and compare it with the same-length previous
 * period; "Total Products" is the all-time count and its comparison covers
 * products created in each period; "Incomplete Orders" is a current total
 * with no comparison. Revenue is the sum of order totals excluding
 * cancelled and returned orders. "Processing" is not a database status and
 * is never shown.
 */

const STATUS_ICONS: Record<OrderStatus, typeof Hourglass> = {
  pending: Hourglass,
  confirmed: ClipboardCheck,
  packed: Package,
  shipped: Truck,
  "out-for-delivery": PackageCheck,
  delivered: CheckCircle2,
  cancelled: XCircle,
  returned: Undo2,
};

const GRANULARITY_LABELS: Record<RevenueGranularity, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

function DeltaLine({
  delta,
  caption,
}: {
  delta: number | null;
  caption: string;
}) {
  if (delta === null || !Number.isFinite(delta)) {
    return <span className="aa-kpi-delta">— {caption}</span>;
  }
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "•";
  // The arrow glyph alone does not announce direction; name it for
  // screen readers. No up/down colour is applied: a rise is not always
  // good news (e.g. cancelled orders), so colour must not imply it.
  const direction =
    delta > 0 ? "Increased " : delta < 0 ? "Decreased " : "Unchanged ";
  return (
    <span className="aa-kpi-delta">
      <span className="aa-sr-only">{direction}</span>
      <span aria-hidden="true">{arrow} </span>
      {Math.abs(delta).toFixed(1)}% {caption}
    </span>
  );
}

function KpiCard({
  href,
  Icon,
  label,
  value,
  delta,
  deltaCaption,
}: {
  href: string;
  Icon: typeof Hourglass;
  label: string;
  value: string;
  delta: number | null;
  deltaCaption: string;
}) {
  return (
    <Link className="aa-panel aa-kpi" href={href}>
      <div className="aa-section-heading">
        <span>{label}</span>
        <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <strong>{value}</strong>
      <DeltaLine delta={delta} caption={deltaCaption} />
    </Link>
  );
}

function UnavailableDashboard({ message }: { message: string }) {
  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Administration"
        title="Dashboard"
        description="Sales, orders and stock at a glance."
      />
      <Notice kind="error">{message}</Notice>
      <p className="aa-muted">
        No data is shown because the store database could not be reached from
        this environment. Nothing here is estimated or filled in.
      </p>
    </main>
  );
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const range = parseDateRange(params, 30);
  const rawGranularity = params.granularity;
  const requested = revenueGranularitySchema.safeParse(
    typeof rawGranularity === "string" ? rawGranularity : undefined,
  );
  const granularity = resolveGranularity(
    range,
    requested.success ? requested.data : undefined,
  );

  if (!adminConfiguration()) {
    return (
      <UnavailableDashboard message="Data unavailable — Supabase is not configured in this environment." />
    );
  }
  const session = await requireStaff();
  const loaded = await loadDashboard(session.client, range, granularity);
  if (!loaded.ok) {
    return <UnavailableDashboard message={loaded.message} />;
  }
  const data = loaded.data;
  const failed = (label: string) => data.failedSections.includes(label);

  const today = toDhakaDateKey(new Date());
  const presets = [
    { label: "Today", from: today, to: today },
    { label: "Last 7 days", from: addDaysToKey(today, -6), to: today },
    { label: "Last 30 days", from: addDaysToKey(today, -29), to: today },
    { label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
  ];

  const warnings: string[] = [];
  if (data.failedSections.length > 0) {
    warnings.push(
      `Some dashboard sections could not be loaded: ${data.failedSections.join(", ")}. The affected numbers are shown as zero until the data is reachable.`,
    );
  }
  if (data.ordersTruncated) {
    warnings.push(
      "Order totals cover the most recent 5,000 orders in each period.",
    );
  }
  if (data.incompleteTruncated) {
    warnings.push("The incomplete-orders total covers the first 500 abandoned checkouts.");
  }

  const revenueSeries = withComparisonSeries(
    data.revenueBuckets,
    data.revenueBucketsPrevious,
  );
  const revenueSummary = summarizeRevenue(data.revenueBuckets);
  // Largest status slice for the summary under the donut; null when the
  // period has no orders at all.
  let topStatus: { status: OrderStatus; count: number } | null = null;
  for (const status of ORDER_STATUSES) {
    const count = data.statusCounts[status];
    if (count > 0 && (!topStatus || count > topStatus.count)) {
      topStatus = { status, count };
    }
  }

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Administration"
        title="Dashboard"
        description={`Selected period ${formatDate(range.from)} – ${formatDate(range.to)} · compared with ${formatDate(data.previousRange.from)} – ${formatDate(data.previousRange.to)} (Dhaka).`}
        actions={
          <span className="aa-date-label">
            {formatDate(today)} · Dhaka
          </span>
        }
      />

      <form method="get" action="/admin" className="aa-toolbar">
        <div className="aa-field">
          <label htmlFor="dashboard-from">From</label>
          <input id="dashboard-from" type="date" name="from" defaultValue={range.from} required />
        </div>
        <div className="aa-field">
          <label htmlFor="dashboard-to">To</label>
          <input id="dashboard-to" type="date" name="to" defaultValue={range.to} required />
        </div>
        <div className="aa-field">
          <label htmlFor="dashboard-granularity">Revenue chart</label>
          <select
            id="dashboard-granularity"
            name="granularity"
            defaultValue={requested.success ? requested.data : ""}
          >
            <option value="">Automatic</option>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
        <button className="aa-button" type="submit">
          Apply
        </button>
        <span className="aa-check-row" role="group" aria-label="Preset periods">
          {presets.map((preset) => (
            <Link
              key={preset.label}
              className="aa-row-action"
              href={hrefWithParams("/admin", params, {
                from: preset.from,
                to: preset.to,
              })}
              aria-current={
                preset.from === range.from && preset.to === range.to
                  ? "true"
                  : undefined
              }
            >
              {preset.label}
            </Link>
          ))}
        </span>
      </form>

      {warnings.map((warning) => (
        <Notice key={warning} kind="warning">
          {warning}
        </Notice>
      ))}

      <div className="aa-kpi-grid">
        <KpiCard
          href="/admin/catalog/products"
          Icon={Boxes}
          label="Total Products"
          value={formatCount(data.totalProducts)}
          delta={periodDelta(data.productsCreatedCurrent, data.productsCreatedPrevious)}
          deltaCaption="new products vs previous period"
        />
        <KpiCard
          href="/admin/sales/orders"
          Icon={Receipt}
          label="Total Orders"
          value={formatCount(data.orderCount)}
          delta={periodDelta(data.orderCount, data.orderCountPrevious)}
          deltaCaption="vs previous period"
        />
        <KpiCard
          href="/admin/sales/orders"
          Icon={Banknote}
          label="Total Revenue"
          value={formatMoney(data.revenueMinor)}
          delta={periodDelta(data.revenueMinor, data.revenueMinorPrevious)}
          deltaCaption="vs previous period"
        />
        <KpiCard
          href="/admin/sales/customers"
          Icon={Users}
          label="Total Customers"
          value={formatCount(data.customerCount)}
          delta={periodDelta(data.customerCount, data.customerCountPrevious)}
          deltaCaption="vs previous period"
        />
      </div>

      <div className="aa-kpi-grid" aria-label="Orders by status">
        {ORDER_STATUSES.map((status) => (
          <KpiCard
            key={status}
            href={`/admin/sales/orders?status=${status}`}
            Icon={STATUS_ICONS[status]}
            label={ORDER_STATUS_LABELS[status]}
            value={formatCount(data.statusCounts[status])}
            delta={periodDelta(
              data.statusCounts[status],
              data.statusCountsPrevious[status],
            )}
            deltaCaption="vs previous period"
          />
        ))}
        <KpiCard
          href="/admin/sales/incomplete"
          Icon={FolderClock}
          label="Incomplete Orders"
          value={failed("Incomplete orders") ? "—" : formatCount(data.incompleteCount)}
          delta={null}
          deltaCaption="current total · abandoned checkouts with items"
        />
      </div>

      <div className="aa-dashboard-grid">
        <Panel
          title="Revenue"
          description={`${GRANULARITY_LABELS[granularity]} totals in the selected period, with the previous period alongside. Revenue is the sum of order totals excluding cancelled and returned orders, including delivery charges.`}
        >
          <BarChart
            bars={revenueSeries}
            formatValue={formatMoneyShort}
            ariaLabel={`Revenue by ${granularity === "day" ? "day" : granularity === "week" ? "week" : "month"}`}
            emptyMessage="No revenue in this period."
            className={styles.chartLarge}
          />
          <dl className={styles.summary}>
            <div>
              <dt>Revenue in period</dt>
              <dd>{formatMoney(data.revenueMinor)}</dd>
            </div>
            <div>
              <dt>Previous period</dt>
              <dd>{formatMoney(data.revenueMinorPrevious)}</dd>
            </div>
            {revenueSummary.peak && revenueSummary.totalMinor > 0 ? (
              <div>
                <dt>Peak {granularity === "day" ? "day" : granularity === "week" ? "week" : "month"}</dt>
                <dd>
                  {revenueSummary.peak.label} ·{" "}
                  {formatMoney(revenueSummary.peak.revenueMinor)}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>
                Average per{" "}
                {granularity === "day" ? "day" : granularity === "week" ? "week" : "month"}
              </dt>
              <dd>{formatMoney(revenueSummary.averageMinor)}</dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Orders by status" description="Click a status to open the matching orders.">
          <DonutChart
            segments={ORDER_STATUSES.map((status, index) => ({
              label: ORDER_STATUS_LABELS[status],
              value: data.statusCounts[status],
              href: `/admin/sales/orders?status=${status}`,
              color: DONUT_PALETTE[index % DONUT_PALETTE.length],
            }))}
            centerLabel="orders"
            formatValue={formatCount}
            ariaLabel="Orders by status in the selected period"
            emptyMessage="No orders in this period."
            className={styles.donutLarge}
          />
          {topStatus ? (
            <dl className={styles.summary}>
              <div>
                <dt>Most orders</dt>
                <dd>
                  {ORDER_STATUS_LABELS[topStatus.status]} ·{" "}
                  {formatCount(topStatus.count)} of {formatCount(data.orderCount)}
                </dd>
              </div>
            </dl>
          ) : null}
        </Panel>
      </div>

      <div className="aa-dashboard-grid aa-dashboard-grid--equal">
        <Panel
          title="Best-selling products"
          description="By revenue in the selected period, excluding cancelled and returned orders."
          actions={
            <Link className="aa-row-action" href="/admin/catalog/products">
              View all products <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          }
        >
          {failed("Best sellers") ? (
            <p className="aa-muted">Best sellers could not be loaded.</p>
          ) : data.bestSellers.length === 0 ? (
            <EmptyState
              icon={<Package size={24} strokeWidth={1.4} aria-hidden="true" />}
              title="No sales in this period"
              description="Best sellers appear here once orders are placed."
            />
          ) : (
            <div className="aa-table-scroll">
              <table className="aa-table">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Units sold</th>
                    <th scope="col">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bestSellers.map((item) => (
                    <tr key={item.productId}>
                      <th scope="row">
                        <span className={styles.productCell}>
                          <ProductThumbnail url={item.imageUrl} alt={item.imageAlt} />
                          <Link href={`/admin/catalog/products/${item.productId}`}>
                            {item.productName}
                          </Link>
                        </span>
                      </th>
                      <td>{formatCount(item.units)}</td>
                      <td>{formatMoney(item.revenueMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel
          title="Recent orders"
          actions={
            <Link className="aa-row-action" href="/admin/sales/orders">
              View all orders <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          }
        >
          {failed("Recent orders") ? (
            <p className="aa-muted">Recent orders could not be loaded.</p>
          ) : data.recentOrders.length === 0 ? (
            <EmptyState
              icon={<Receipt size={24} strokeWidth={1.4} aria-hidden="true" />}
              title="No orders yet"
              description="Orders appear here as soon as customers place them."
            />
          ) : (
            <div className="aa-table-scroll">
              <table className="aa-table">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Date</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Payment</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="aa-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentOrders.map((order) => (
                    <tr key={order.id}>
                      <th scope="row">
                        {order.order_number !== null
                          ? `#${order.order_number}`
                          : `Order ${order.id.slice(0, 8)}`}
                      </th>
                      <td>
                        <span className="aa-cell-main">{order.customer_name}</span>
                        <span className="aa-cell-sub">{order.phone}</span>
                      </td>
                      <td>
                        <time dateTime={order.placed_at}>
                          {formatDateTime(order.placed_at)}
                        </time>
                      </td>
                      <td>{formatMoney(order.total_minor)}</td>
                      <td>
                        {PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method}
                        <span className="aa-cell-sub">
                          {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
                        </span>
                      </td>
                      <td>
                        {(ORDER_STATUSES as readonly string[]).includes(order.status) ? (
                          <StatusBadge tone={ORDER_STATUS_TONES[order.status as OrderStatus]}>
                            {ORDER_STATUS_LABELS[order.status as OrderStatus]}
                          </StatusBadge>
                        ) : (
                          order.status
                        )}
                      </td>
                      <td className="aa-cell-actions">
                        <Link className="aa-row-action" href={`/admin/sales/orders/${order.id}`} aria-label={`View order ${order.order_number !== null ? `#${order.order_number}` : order.id.slice(0, 8)}`}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="aa-dashboard-grid aa-dashboard-grid--equal">
        <Panel
          title="Low-stock alerts"
          description="Variants at or below their low-stock threshold, lowest stock first."
          actions={
            <Link className="aa-row-action" href="/admin/catalog/inventory">
              View inventory <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          }
        >
          {failed("Low stock") ? (
            <p className="aa-muted">Low-stock alerts could not be loaded.</p>
          ) : data.lowStock.length === 0 ? (
            <EmptyState
              icon={<AlertTriangle size={24} strokeWidth={1.4} aria-hidden="true" />}
              title="No low-stock items"
              description="Every variant is above its low-stock threshold."
            />
          ) : (
            <div className="aa-table-scroll">
              <table className="aa-table">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Variant</th>
                    <th scope="col">Available</th>
                    <th scope="col">Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lowStock.map((row) => (
                    <tr key={row.variantId}>
                      <th scope="row">
                        <Link href={`/admin/catalog/inventory?variant=${row.variantId}`}>
                          {row.productName}
                        </Link>
                      </th>
                      <td>
                        {row.size} · {row.color}
                      </td>
                      <td>{formatCount(row.available)}</td>
                      <td>{formatCount(row.lowStockThreshold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Catalog" description="Products, variants, images, and stock are managed in the catalog.">
          <p>
            Add products, edit variants, and track stock from the catalog
            pages.
          </p>
          <div className="aa-editor-actions">
            <Link className="aa-button" href="/admin/catalog/products">
              Manage products <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </Panel>
      </div>

      <Notice kind="info">
        Revenue is the sum of order totals excluding cancelled and returned
        orders, including delivery charges. Payment verification and online
        payment are not connected yet; all orders here are Cash on Delivery.
      </Notice>
    </main>
  );
}
