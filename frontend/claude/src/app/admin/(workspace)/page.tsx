import Link from "next/link";
import type { ReactNode } from "react";
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
  hrefWithParams,
} from "@/components/admin/ui";
import { HorizontalBarList } from "@/components/admin/charts/HorizontalBarList";
import {
  CountUpValue,
  type CountUpFormat,
} from "@/components/admin/charts/CountUpValue";
import { PieChart, PIE_PALETTE } from "@/components/admin/charts/PieChart";
import { SeriesChart } from "@/components/admin/charts/SeriesChart";
import { PeriodToggle } from "@/components/admin/PeriodToggle";
import { PageHeader } from "@/components/design-system/PageHeader";
import {
  StatCard,
  type StatCardTrend,
} from "@/components/design-system/StatCard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/design-system/Card";
import { ChartCard } from "@/components/design-system/ChartCard";
import { StatusBadge } from "@/components/design-system/StatusBadge";

/**
 * Dashboard: real queries only, through the staff session client (RLS
 * enforced). Order KPIs, status counts and the revenue chart cover the
 * selected Dhaka-date period and compare it with the same-length previous
 * period; "Total Products" is the all-time count and its comparison covers
 * products created in each period; "Incomplete Orders" is a current total
 * with no comparison. Revenue is the sum of order totals excluding
 * cancelled and returned orders. "Processing" is not a database status and
 * is never shown.
 *
 * Presentation uses the admin design-system components (PageHeader,
 * StatCard, Card, ChartCard, StatusBadge); every metric, link, filter
 * and handler is unchanged. Charts keep the hand-built SeriesChart and
 * PieChart: their legends link to filtered order lists and their data
 * tables stay available, which the Recharts wrappers do not offer.
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

/**
 * KPI value variants: most cards count up to a real number; a card
 * whose section failed to load shows static text (an em dash) instead
 * of animating a zero it does not mean.
 */
type KpiValue =
  | { kind: "count-up"; value: number; format: CountUpFormat }
  | { kind: "text"; text: string };

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
  value: KpiValue;
  delta: number | null;
  deltaCaption: string;
}) {
  // Direction is named in words for screen readers (the trend icon is
  // decorative). The tone stays neutral: a rise is not always good
  // news (e.g. cancelled orders), so colour must not imply it.
  const trend: StatCardTrend | null =
    delta === null || !Number.isFinite(delta)
      ? null
      : {
          direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
          label: `${delta > 0 ? "Increased" : delta < 0 ? "Decreased" : "Unchanged"} ${Math.abs(delta).toFixed(1)}% · ${deltaCaption}`,
        };
  return (
    <Link
      href={href}
      className="aa-ds-plain-link block h-full rounded-admin-card"
    >
      <StatCard
        label={label}
        value={
          value.kind === "count-up" ? (
            <CountUpValue value={value.value} format={value.format} />
          ) : (
            value.text
          )
        }
        icon={<Icon size={18} strokeWidth={1.5} aria-hidden="true" />}
        trend={trend ?? undefined}
        trendTone="neutral"
        description={trend === null ? deltaCaption : undefined}
        className="h-full transition-shadow hover:shadow-admin-lift"
      />
    </Link>
  );
}

/** Visible data summary under a chart: the numbers behind the visual. */
function ChartSummary({
  items,
}: {
  items: { term: string; value: ReactNode }[];
}) {
  return (
    <dl className="flex flex-wrap gap-x-7 gap-y-3">
      {items.map((item) => (
        <div key={item.term} className="min-w-0">
          <dt className="text-xs text-admin-text-secondary">{item.term}</dt>
          <dd className="admin-ds-numeric mt-0.5 font-semibold text-admin-text [overflow-wrap:anywhere]">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Card panel with a title row and an optional action link. */
function DashboardPanel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle headingLevel="h2">{title}</CardTitle>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ViewAllLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-admin-primary transition-colors hover:text-admin-secondary"
    >
      {children} <ArrowUpRight size={15} aria-hidden="true" />
    </Link>
  );
}

function UnavailableDashboard({ message }: { message: string }) {
  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-5">
        <PageHeader title="Dashboard" description="Sales, orders and stock at a glance.">
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Administration
          </p>
        </PageHeader>
        <Notice kind="error">{message}</Notice>
        <p className="aa-muted">
          No data is shown because the store database could not be reached from
          this environment. Nothing here is estimated or filled in.
        </p>
      </div>
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
  // The line chart takes the two series separately; positions stay
  // paired exactly as withComparisonSeries paired them.
  const revenuePoints = revenueSeries.map((bucket) => ({
    label: bucket.label,
    value: bucket.value,
  }));
  const revenueComparePoints = revenueSeries.map((bucket) => ({
    label: bucket.label,
    value: bucket.compareValue,
  }));
  const revenueSummary = summarizeRevenue(data.revenueBuckets);
  // Largest status slice for the summary under the pie; null when the
  // period has no orders at all.
  let topStatus: { status: OrderStatus; count: number } | null = null;
  for (const status of ORDER_STATUSES) {
    const count = data.statusCounts[status];
    if (count > 0 && (!topStatus || count > topStatus.count)) {
      topStatus = { status, count };
    }
  }

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description={`Selected period ${formatDate(range.from)} – ${formatDate(range.to)} · compared with ${formatDate(data.previousRange.from)} – ${formatDate(data.previousRange.to)} (Dhaka).`}
          actions={
            <span className="admin-ds-numeric inline-flex min-h-11 items-center rounded-full border border-admin-border bg-admin-card px-3 text-xs text-admin-text-secondary">
              {formatDate(today)} · Dhaka
            </span>
          }
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Administration
          </p>
        </PageHeader>

        <form
          method="get"
          action="/admin"
          className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <div className="min-w-0">
            <label
              htmlFor="dashboard-from"
              className="mb-1 block text-xs font-medium text-admin-text-secondary"
            >
              From
            </label>
            <input
              id="dashboard-from"
              type="date"
              name="from"
              defaultValue={range.from}
              required
              className="h-11 rounded-admin-control border border-admin-border bg-admin-card px-3 text-sm text-admin-text"
            />
          </div>
          <div className="min-w-0">
            <label
              htmlFor="dashboard-to"
              className="mb-1 block text-xs font-medium text-admin-text-secondary"
            >
              To
            </label>
            <input
              id="dashboard-to"
              type="date"
              name="to"
              defaultValue={range.to}
              required
              className="h-11 rounded-admin-control border border-admin-border bg-admin-card px-3 text-sm text-admin-text"
            />
          </div>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-admin-control bg-admin-primary px-4 text-sm font-medium text-white transition-colors hover:bg-admin-primary/90"
            type="submit"
          >
            Apply
          </button>
          <span
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Preset periods"
          >
            {presets.map((preset) => {
              const active =
                preset.from === range.from && preset.to === range.to;
              return (
                <Link
                  key={preset.label}
                  className={
                    active
                      ? "aa-ds-plain-link inline-flex min-h-11 items-center rounded-full bg-admin-primary px-3.5 text-[13px] font-medium text-white"
                      : "aa-ds-plain-link inline-flex min-h-11 items-center rounded-full border border-admin-border bg-admin-card px-3.5 text-[13px] font-medium text-admin-text transition-colors hover:bg-admin-soft-bg"
                  }
                  href={hrefWithParams("/admin", params, {
                    from: preset.from,
                    to: preset.to,
                  })}
                  aria-current={active ? "true" : undefined}
                >
                  {preset.label}
                </Link>
              );
            })}
          </span>
        </form>

        <div>
          <PeriodToggle
            options={[
              {
                value: "auto",
                label: "Automatic",
                href: hrefWithParams("/admin", params, {
                  granularity: undefined,
                }),
              },
              {
                value: "day",
                label: "Daily",
                href: hrefWithParams("/admin", params, { granularity: "day" }),
              },
              {
                value: "week",
                label: "Weekly",
                href: hrefWithParams("/admin", params, { granularity: "week" }),
              },
              {
                value: "month",
                label: "Monthly",
                href: hrefWithParams("/admin", params, { granularity: "month" }),
              },
            ]}
            activeValue={requested.success ? requested.data : undefined}
            defaultValue="auto"
            ariaLabel="Revenue chart granularity"
          />
        </div>

        {warnings.map((warning) => (
          <Notice key={warning} kind="warning">
            {warning}
          </Notice>
        ))}

        <section aria-label="Totals">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KpiCard
              href="/admin/catalog/products"
              Icon={Boxes}
              label="Total Products"
              value={{ kind: "count-up", value: data.totalProducts, format: "count" }}
              delta={periodDelta(data.productsCreatedCurrent, data.productsCreatedPrevious)}
              deltaCaption="new products vs previous period"
            />
            <KpiCard
              href="/admin/sales/orders"
              Icon={Receipt}
              label="Total Orders"
              value={{ kind: "count-up", value: data.orderCount, format: "count" }}
              delta={periodDelta(data.orderCount, data.orderCountPrevious)}
              deltaCaption="vs previous period"
            />
            <KpiCard
              href="/admin/sales/orders"
              Icon={Banknote}
              label="Total Revenue"
              value={{ kind: "count-up", value: data.revenueMinor, format: "money" }}
              delta={periodDelta(data.revenueMinor, data.revenueMinorPrevious)}
              deltaCaption="vs previous period"
            />
            <KpiCard
              href="/admin/sales/customers"
              Icon={Users}
              label="Total Customers"
              value={{ kind: "count-up", value: data.customerCount, format: "count" }}
              delta={periodDelta(data.customerCount, data.customerCountPrevious)}
              deltaCaption="vs previous period"
            />
          </div>
        </section>

        <section aria-label="Orders by status">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {ORDER_STATUSES.map((status) => (
              <KpiCard
                key={status}
                href={`/admin/sales/orders?status=${status}`}
                Icon={STATUS_ICONS[status]}
                label={ORDER_STATUS_LABELS[status]}
                value={{
                  kind: "count-up",
                  value: data.statusCounts[status],
                  format: "count",
                }}
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
              value={
                failed("Incomplete orders")
                  ? { kind: "text", text: "—" }
                  : { kind: "count-up", value: data.incompleteCount, format: "count" }
              }
              delta={null}
              deltaCaption="current total · abandoned checkouts with items"
            />
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-3">
          <ChartCard
            title="Revenue"
            description={`${GRANULARITY_LABELS[granularity]} totals in the selected period, with the previous period alongside. Revenue is the sum of order totals excluding cancelled and returned orders, including delivery charges.`}
            headingLevel="h2"
            className="xl:col-span-2"
            footer={
              <ChartSummary
                items={[
                  {
                    term: "Revenue in period",
                    value: formatMoney(data.revenueMinor),
                  },
                  {
                    term: "Previous period",
                    value: formatMoney(data.revenueMinorPrevious),
                  },
                  ...(revenueSummary.peak && revenueSummary.totalMinor > 0
                    ? [
                        {
                          term: `Peak ${granularity === "day" ? "day" : granularity === "week" ? "week" : "month"}`,
                          value: `${revenueSummary.peak.label} · ${formatMoney(revenueSummary.peak.revenueMinor)}`,
                        },
                      ]
                    : []),
                  {
                    term: `Average per ${granularity === "day" ? "day" : granularity === "week" ? "week" : "month"}`,
                    value: formatMoney(revenueSummary.averageMinor),
                  },
                ]}
              />
            }
          >
            <SeriesChart
              points={revenuePoints}
              comparePoints={revenueComparePoints}
              formatValue={formatMoneyShort}
              ariaLabel={`Revenue by ${granularity === "day" ? "day" : granularity === "week" ? "week" : "month"}`}
              emptyMessage="No revenue in this period."
              emptyGuidance="Revenue appears here once orders are placed in the selected period."
            />
          </ChartCard>
          <ChartCard
            title="Orders by status"
            description="Click a status to open the matching orders."
            headingLevel="h2"
            footer={
              topStatus ? (
                <ChartSummary
                  items={[
                    {
                      term: "Most orders",
                      value: `${ORDER_STATUS_LABELS[topStatus.status]} · ${formatCount(topStatus.count)} of ${formatCount(data.orderCount)}`,
                    },
                  ]}
                />
              ) : undefined
            }
          >
            <PieChart
              segments={ORDER_STATUSES.map((status, index) => ({
                label: ORDER_STATUS_LABELS[status],
                value: data.statusCounts[status],
                href: `/admin/sales/orders?status=${status}`,
                color: PIE_PALETTE[index % PIE_PALETTE.length],
              }))}
              totalLabel="orders"
              formatValue={formatCount}
              ariaLabel="Orders by status in the selected period"
              emptyMessage="No orders in this period."
              emptyGuidance="Orders placed in the selected period appear here by status."
            />
          </ChartCard>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard
            title="Best-selling products"
            description="By revenue in the selected period, excluding cancelled and returned orders."
            headingLevel="h2"
            actions={
              <ViewAllLink href="/admin/catalog/products">
                View all products
              </ViewAllLink>
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
              <HorizontalBarList
                items={data.bestSellers}
                valueKey="revenueMinor"
                formatUnits={formatCount}
                formatRevenue={formatMoney}
                emptyMessage="No sales in this period."
                emptyGuidance="Best sellers appear here once orders are placed."
              />
            )}
          </ChartCard>
          <ChartCard
            title="Least-selling products"
            description="Fewest units sold in the selected period, among products with at least one sale. Excludes cancelled and returned orders."
            headingLevel="h2"
            actions={
              <ViewAllLink href="/admin/catalog/products">
                View all products
              </ViewAllLink>
            }
          >
            {failed("Best sellers") ? (
              <p className="aa-muted">Least-selling products could not be loaded.</p>
            ) : data.leastSellers.length === 0 ? (
              <EmptyState
                icon={<Package size={24} strokeWidth={1.4} aria-hidden="true" />}
                title="No sales in this period"
                description="Least-selling products appear here once orders are placed."
              />
            ) : (
              <HorizontalBarList
                items={data.leastSellers}
                valueKey="units"
                formatUnits={formatCount}
                formatRevenue={formatMoney}
                emptyMessage="No sales in this period."
                emptyGuidance="Least-selling products appear here once orders are placed."
              />
            )}
          </ChartCard>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <DashboardPanel
            title="Recent orders"
            actions={
              <ViewAllLink href="/admin/sales/orders">View all orders</ViewAllLink>
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
                        <td data-label="Customer">
                          <span className="aa-cell-main">{order.customer_name}</span>
                          <span className="aa-cell-sub">{order.phone}</span>
                        </td>
                        <td data-label="Date">
                          <time dateTime={order.placed_at}>
                            {formatDateTime(order.placed_at)}
                          </time>
                        </td>
                        <td data-label="Amount">{formatMoney(order.total_minor)}</td>
                        <td data-label="Payment">
                          {PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method}
                          <span className="aa-cell-sub">
                            {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
                          </span>
                        </td>
                        <td data-label="Status">
                          {(ORDER_STATUSES as readonly string[]).includes(order.status) ? (
                            <StatusBadge status={order.status as OrderStatus} />
                          ) : (
                            order.status
                          )}
                        </td>
                        <td data-label="Actions" className="aa-cell-actions">
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
          </DashboardPanel>
          <DashboardPanel
            title="Low-stock alerts"
            description="Variants at or below their low-stock threshold, lowest stock first."
            actions={
              <ViewAllLink href="/admin/catalog/inventory">
                View inventory
              </ViewAllLink>
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
                          <Link
                            href={`/admin/catalog/inventory?variant=${row.variantId}`}
                            className="font-medium text-admin-primary"
                          >
                            {row.productName}
                          </Link>
                        </th>
                        <td data-label="Variant">
                          {row.size} · {row.color}
                        </td>
                        <td data-label="Available">{formatCount(row.available)}</td>
                        <td data-label="Threshold">{formatCount(row.lowStockThreshold)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DashboardPanel>
        </div>

        <DashboardPanel
          title="Catalog"
          description="Products, variants, images, and stock are managed in the catalog."
        >
          <p>
            Add products, edit variants, and track stock from the catalog
            pages.
          </p>
          <div className="mt-3 flex justify-end">
            <Link
              className="aa-ds-plain-link inline-flex min-h-11 items-center gap-1.5 rounded-admin-control bg-admin-primary px-4 text-sm font-medium text-white transition-colors hover:bg-admin-primary/90"
              href="/admin/catalog/products"
            >
              Manage products <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </DashboardPanel>

        <Notice kind="info">
          Revenue is the sum of order totals excluding cancelled and returned
          orders, including delivery charges. Payment verification and online
          payment are not connected yet; all orders here are Cash on Delivery.
        </Notice>
      </div>
    </main>
  );
}
