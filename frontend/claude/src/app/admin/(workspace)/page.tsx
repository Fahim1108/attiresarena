import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";
import {
  Boxes,
  Receipt,
  Banknote,
  Users,
  Package,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { requireStaff } from "@/lib/admin/authorization";
import { adminConfiguration } from "@/lib/admin/supabase";
import {
  bucketRevenue,
  countByStatus,
  countDistinctPhones,
  dashboardLoadWarnings,
  periodDelta,
  previousPeriodRange,
  resolveGranularity,
  revenueGranularitySchema,
  startDashboardLoad,
  sumRevenue,
  summarizeRevenue,
  withComparisonSeries,
  addDaysToKey,
  type DashboardLoad,
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
  type DateRange,
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
import { LinkPendingHint } from "@/components/admin/LinkPendingHint";
import { DateRangeForm } from "@/components/admin/DateRangeForm";
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
 * Streaming: the page starts every query at once (startDashboardLoad)
 * and renders the shell — header, date controls, presets, granularity —
 * immediately; each section streams in behind its own Suspense boundary
 * as its data arrives, so a slow section (best sellers, with its cover
 * images) never blocks a fast one (recent orders). No section re-fetches:
 * all sections share the one set of promises. Skeletons mirror the
 * section shapes (same aa-skeleton-row shimmer as the workspace loading
 * state) so the swap does not jump.
 *
 * Presentation uses the admin design-system components (PageHeader,
 * StatCard, Card, ChartCard, StatusBadge); every metric, link, filter
 * and handler is unchanged. Charts keep the hand-built SeriesChart and
 * PieChart: their legends link to filtered order lists and their data
 * tables stay available, which the Recharts wrappers do not offer.
 * Layout follows the owner's reference structure (business KPIs,
 * operational-overview status grid, chart + donut, best/least
 * sellers). Statuses are exactly the DB's fixed 8 — 'Processing'
 * never appears.
 */

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
  Icon: LucideIcon;
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
      className="aa-ds-plain-link relative block h-full rounded-admin-card"
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
        className="aa-kpi h-full transition-shadow hover:shadow-admin-lift"
      />
      {/* Pending dot (bottom-right, clear of the icon tile): appears
          the instant this card's navigation is pending. */}
      <span className="pointer-events-none absolute bottom-3 right-3 text-admin-primary">
        <LinkPendingHint />
      </span>
    </Link>
  );
}

/** Compact status cell (reference: operational-overview grid): a
 * coloured dot matching the donut slice, the status label, and the
 * real count. The whole cell links to the filtered orders list. The
 * dot is decorative; the link name carries label + count. No delta
 * is shown here (the reference cells carry none); deltas stay on the
 * four business KPI cards above. */
function StatusCell({
  href,
  dotColor,
  label,
  countText,
}: {
  href: string;
  dotColor: string;
  label: string;
  countText: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label}: ${countText}`}
      className="aa-ds-plain-link relative block h-full rounded-admin-card border border-admin-border bg-admin-card p-4 transition-shadow hover:border-admin-primary/40 hover:shadow-admin-lift"
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
        <span className="min-w-0 break-words text-[13px] font-medium leading-5 text-admin-text-secondary">
          {label}
        </span>
      </span>
      <span className="admin-ds-numeric mt-2 block min-w-0 text-[28px] font-semibold leading-8 text-admin-text [overflow-wrap:anywhere]">
        {countText}
      </span>
      {/* Pending dot (bottom-right): appears the instant this cell's
          navigation is pending. */}
      <span className="pointer-events-none absolute bottom-3 right-3 text-admin-primary">
        <LinkPendingHint />
      </span>
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
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds aa-dashboard-v2">
      <div className="space-y-5">
        <PageHeader title="Dashboard" description="Sales, orders and stock at a glance." />
        <Notice kind="error">{message}</Notice>
        <p className="aa-muted">
          No data is shown because the store database could not be reached from
          this environment. Nothing here is estimated or filled in.
        </p>
      </div>
    </main>
  );
}

// --- Section skeletons -------------------------------------------------
//
// Same aa-skeleton-row shimmer as the workspace loading state, sized to
// the section they stand in for. All aria-hidden: the section headings
// above them are static and already announced.

function KpiSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="aa-skeleton-row" style={{ height: "6.5rem" }} />
      ))}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-hidden="true" className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index} className="aa-skeleton-row" style={{ height: "5.5rem" }} />
      ))}
    </div>
  );
}

function RevenueSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-6 xl:grid-cols-3">
      <div className="aa-skeleton-row xl:col-span-2" style={{ height: "19rem" }} />
      <div className="aa-skeleton-row" style={{ height: "19rem" }} />
    </div>
  );
}

function SellersSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-6 xl:grid-cols-2">
      <div className="aa-skeleton-row" style={{ height: "14rem" }} />
      <div className="aa-skeleton-row" style={{ height: "14rem" }} />
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="aa-skeleton-row" style={{ height: "14rem" }} />
    </div>
  );
}

// --- Streamed sections -------------------------------------------------
//
// Each awaits only the promises it renders. A failed section degrades
// exactly as before (its numbers show zero, its panel shows the
// could-not-be-loaded copy); the warnings banner below lists the
// failed sections once every section has resolved.

async function DashboardWarnings({ load }: { load: DashboardLoad }) {
  const warnings = await dashboardLoadWarnings(load);
  const messages: string[] = [];
  if (warnings.failedSections.length > 0) {
    messages.push(
      `Some dashboard sections could not be loaded: ${warnings.failedSections.join(", ")}. The affected numbers are shown as zero until the data is reachable.`,
    );
  }
  if (warnings.ordersTruncated) {
    messages.push(
      "Order totals cover the most recent 5,000 orders in each period.",
    );
  }
  if (warnings.incompleteTruncated) {
    messages.push("The incomplete-orders total covers the first 500 abandoned checkouts.");
  }
  if (messages.length === 0) return null;
  return (
    <>
      {messages.map((message) => (
        <Notice key={message} kind="warning">
          {message}
        </Notice>
      ))}
    </>
  );
}

async function KpiSection({ load }: { load: DashboardLoad }) {
  const [ordersWindow, productCounts] = await Promise.all([
    load.ordersWindow,
    load.productCounts,
  ]);
  const revenueMinor = sumRevenue(ordersWindow.current);
  const revenueMinorPrevious = sumRevenue(ordersWindow.previous);
  const customerCount = countDistinctPhones(ordersWindow.current);
  const customerCountPrevious = countDistinctPhones(ordersWindow.previous);
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard
        href="/admin/sales/orders"
        Icon={Banknote}
        label="Total Revenue"
        value={{ kind: "count-up", value: revenueMinor, format: "money" }}
        delta={periodDelta(revenueMinor, revenueMinorPrevious)}
        deltaCaption="vs previous period"
      />
      <KpiCard
        href="/admin/sales/orders"
        Icon={Receipt}
        label="Total Orders"
        value={{ kind: "count-up", value: ordersWindow.current.length, format: "count" }}
        delta={periodDelta(ordersWindow.current.length, ordersWindow.previous.length)}
        deltaCaption="vs previous period"
      />
      <KpiCard
        href="/admin/sales/customers"
        Icon={Users}
        label="Total Customers"
        value={{ kind: "count-up", value: customerCount, format: "count" }}
        delta={periodDelta(customerCount, customerCountPrevious)}
        deltaCaption="vs previous period"
      />
      <KpiCard
        href="/admin/catalog/products"
        Icon={Boxes}
        label="Total Products"
        value={{ kind: "count-up", value: productCounts.total, format: "count" }}
        delta={periodDelta(productCounts.createdCurrent, productCounts.createdPrevious)}
        deltaCaption="new products vs previous period"
      />
    </div>
  );
}

async function OverviewSection({ load }: { load: DashboardLoad }) {
  const [ordersWindow, incomplete] = await Promise.all([
    load.ordersWindow,
    load.incomplete,
  ]);
  const statusCounts = countByStatus(ordersWindow.current);
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
      {ORDER_STATUSES.map((status, index) => (
        <StatusCell
          key={status}
          href={`/admin/sales/orders?status=${status}`}
          dotColor={PIE_PALETTE[index % PIE_PALETTE.length] ?? "#9A9494"}
          label={ORDER_STATUS_LABELS[status]}
          countText={formatCount(statusCounts[status])}
        />
      ))}
      <StatusCell
        href="/admin/sales/incomplete"
        dotColor="rgb(var(--admin-text-secondary))"
        label="Incomplete Orders"
        countText={
          incomplete.failed ? "—" : formatCount(incomplete.count)
        }
      />
    </div>
  );
}

async function RevenueSection({
  load,
  range,
  previousRange,
  granularity,
}: {
  load: DashboardLoad;
  range: DateRange;
  previousRange: DateRange;
  granularity: RevenueGranularity;
}) {
  const ordersWindow = await load.ordersWindow;
  const revenueBuckets = bucketRevenue(ordersWindow.current, granularity, range);
  const revenueBucketsPrevious = bucketRevenue(
    ordersWindow.previous,
    granularity,
    previousRange,
  );
  const revenueSeries = withComparisonSeries(
    revenueBuckets,
    revenueBucketsPrevious,
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
  const revenueSummary = summarizeRevenue(revenueBuckets);
  const revenueMinor = sumRevenue(ordersWindow.current);
  const revenueMinorPrevious = sumRevenue(ordersWindow.previous);
  // Largest status slice for the summary under the pie; null when the
  // period has no orders at all.
  const statusCounts = countByStatus(ordersWindow.current);
  let topStatus: { status: OrderStatus; count: number } | null = null;
  for (const status of ORDER_STATUSES) {
    const count = statusCounts[status];
    if (count > 0 && (!topStatus || count > topStatus.count)) {
      topStatus = { status, count };
    }
  }

  return (
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
                value: formatMoney(revenueMinor),
              },
              {
                term: "Previous period",
                value: formatMoney(revenueMinorPrevious),
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
                  value: `${ORDER_STATUS_LABELS[topStatus.status]} · ${formatCount(topStatus.count)} of ${formatCount(ordersWindow.current.length)}`,
                },
              ]}
            />
          ) : undefined
        }
      >
        <PieChart
          segments={ORDER_STATUSES.map((status, index) => ({
            label: ORDER_STATUS_LABELS[status],
            value: statusCounts[status],
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
  );
}

async function SellersSection({ load }: { load: DashboardLoad }) {
  const sellers = await load.sellers;
  return (
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
        {sellers.failed ? (
          <p className="aa-muted">Best sellers could not be loaded.</p>
        ) : sellers.best.length === 0 ? (
          <EmptyState
            icon={<Package size={24} strokeWidth={1.4} aria-hidden="true" />}
            title="No sales in this period"
            description="Best sellers appear here once orders are placed."
          />
        ) : (
          <HorizontalBarList
            items={sellers.best}
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
        {sellers.failed ? (
          <p className="aa-muted">Least-selling products could not be loaded.</p>
        ) : sellers.least.length === 0 ? (
          <EmptyState
            icon={<Package size={24} strokeWidth={1.4} aria-hidden="true" />}
            title="No sales in this period"
            description="Least-selling products appear here once orders are placed."
          />
        ) : (
          <HorizontalBarList
            items={sellers.least}
            valueKey="units"
            formatUnits={formatCount}
            formatRevenue={formatMoney}
            emptyMessage="No sales in this period."
            emptyGuidance="Least-selling products appear here once orders are placed."
          />
        )}
      </ChartCard>
    </div>
  );
}

async function RecentOrdersSection({ load }: { load: DashboardLoad }) {
  const recent = await load.recentOrders;
  return (
    <DashboardPanel
      title="Recent orders"
      actions={
        <ViewAllLink href="/admin/sales/orders">View all orders</ViewAllLink>
      }
    >
      {recent.failed ? (
        <p className="aa-muted">Recent orders could not be loaded.</p>
      ) : recent.orders.length === 0 ? (
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
              {recent.orders.map((order) => (
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
  );
}

async function LowStockSection({ load }: { load: DashboardLoad }) {
  const lowStock = await load.lowStock;
  return (
    <DashboardPanel
      title="Low-stock alerts"
      description="Variants at or below their low-stock threshold, lowest stock first."
      actions={
        <ViewAllLink href="/admin/catalog/inventory">
          View inventory
        </ViewAllLink>
      }
    >
      {lowStock.failed ? (
        <p className="aa-muted">Low-stock alerts could not be loaded.</p>
      ) : lowStock.rows.length === 0 ? (
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
              {lowStock.rows.map((row) => (
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
  // Start every query now; the shell below renders without waiting,
  // and each section awaits only its own promises.
  const load = startDashboardLoad(session.client, range);
  const previousRange = previousPeriodRange(range);

  const today = toDhakaDateKey(new Date());
  const presets = [
    { label: "Today", from: today, to: today },
    { label: "Last 7 days", from: addDaysToKey(today, -6), to: today },
    { label: "Last 30 days", from: addDaysToKey(today, -29), to: today },
    { label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
  ];

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds aa-dashboard-v2">
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description={`Selected period ${formatDate(range.from)} – ${formatDate(range.to)} · compared with ${formatDate(previousRange.from)} – ${formatDate(previousRange.to)} (Dhaka).`}
          actions={
            <span className="admin-ds-numeric inline-flex min-h-11 items-center rounded-full border border-admin-border bg-admin-card px-3 text-xs text-admin-text-secondary">
              {formatDate(today)} · Dhaka
            </span>
          }
        />

        <DateRangeForm
          action="/admin"
          from={range.from}
          to={range.to}
          fromId="dashboard-from"
          toId="dashboard-to"
          submitLabel="Apply"
          required
        />
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
                    ? "aa-ds-plain-link inline-flex min-h-11 items-center gap-1.5 rounded-full bg-admin-primary px-3.5 text-[13px] font-medium text-white"
                    : "aa-ds-plain-link inline-flex min-h-11 items-center gap-1.5 rounded-full border border-admin-border bg-admin-card px-3.5 text-[13px] font-medium text-admin-text transition-colors hover:bg-admin-soft-bg"
                }
                href={hrefWithParams("/admin", params, {
                  from: preset.from,
                  to: preset.to,
                })}
                aria-current={active ? "true" : undefined}
              >
                {preset.label}
                <LinkPendingHint />
              </Link>
            );
          })}
        </span>

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

        <Suspense fallback={null}>
          <DashboardWarnings load={load} />
        </Suspense>

        <section aria-label="Totals">
          <Suspense fallback={<KpiSkeleton />}>
            <KpiSection load={load} />
          </Suspense>
        </section>

        <section aria-label="Operational overview">
          <h2 className="aa-dashboard-section-title">Operational overview</h2>
          <Suspense fallback={<OverviewSkeleton />}>
            <OverviewSection load={load} />
          </Suspense>
        </section>

        <Suspense fallback={<RevenueSkeleton />}>
          <RevenueSection
            load={load}
            range={range}
            previousRange={previousRange}
            granularity={granularity}
          />
        </Suspense>

        <Suspense fallback={<SellersSkeleton />}>
          <SellersSection load={load} />
        </Suspense>

        <div className="grid gap-6 xl:grid-cols-2">
          <Suspense fallback={<PanelSkeleton />}>
            <RecentOrdersSection load={load} />
          </Suspense>
          <Suspense fallback={<PanelSkeleton />}>
            <LowStockSection load={load} />
          </Suspense>
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
