import Link from "next/link";
import { formatDateTime, formatMoney, formatOrderNumber } from "@/lib/admin/format";
import { blockCustomer, readCustomerProfile, unblockCustomer } from "@/lib/admin/customers";
import { resolveDisplayRecord } from "@/lib/admin/sample-data";
import { SAMPLE_CUSTOMER_PROFILE } from "@/lib/admin/sample-sales";
import { Notice, StatusBadge } from "@/components/admin/ui";
import { SampleBadge } from "@/components/admin/SampleBadge";
import { CustomerBlockForms } from "@/components/admin/sales/CustomerBlockForms";
import { SalesNav } from "@/components/admin/sales/SalesNav";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import { StatusBadge as OrderStatusBadge } from "@/components/design-system/StatusBadge";

export const metadata = { title: "Customer profile" };

export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ phone: string }>;
}) {
  const { phone } = await params;
  // Null means unavailable: show a labeled sample profile with no working
  // block actions. An invalid phone or a phone with no orders still 404s.
  const { record, isSample } = resolveDisplayRecord(
    await readCustomerProfile(phone),
    SAMPLE_CUSTOMER_PROFILE,
  );
  const { summary, orders, ordersTruncated, blockedRow, blocked, canManageBlock } = record;

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title={summary.name}
          description={`${summary.phone}${summary.email ? ` · ${summary.email}` : ""}`}
          actions={
            <Link className="aa-secondary" href="/admin/sales/customers">
              Back to customers
            </Link>
          }
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Sales · Customers
          </p>
        </PageHeader>
        <SalesNav current="customers" />

        {isSample ? (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-admin-card border border-admin-border border-l-4 border-l-admin-primary bg-admin-soft-bg px-4 py-3 text-sm leading-6 text-admin-text"
            role="status"
          >
            <SampleBadge />
            <span>
              Live customer data is unavailable — this profile could not be
              read. This sample profile is for testing the layout only. Block
              actions are unavailable, and no sample data is saved.
            </span>
          </div>
        ) : null}

        <Notice kind="info">
          This profile is derived from order records. There is no separate customer registry.
        </Notice>

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Contact & account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="aa-fact-grid">
              <div>
                <dt>Name</dt>
                <dd>{summary.name}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{summary.phone}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{summary.email ?? "—"}</dd>
              </div>
              <div>
                <dt>Account status</dt>
                <dd>{summary.hasAccount ? "Account (at least one signed-in order)" : "Guest"}</dd>
              </div>
              <div>
                <dt>Orders</dt>
                <dd>{summary.orderCount}</dd>
              </div>
              <div>
                <dt>Total spent</dt>
                <dd>
                  <strong>{formatMoney(summary.totalSpentMinor)}</strong>
                </dd>
              </div>
              <div>
                <dt>First order</dt>
                <dd>{formatDateTime(summary.firstOrderAt)}</dd>
              </div>
              <div>
                <dt>Last order</dt>
                <dd>{formatDateTime(summary.lastOrderAt)}</dd>
              </div>
              <div>
                <dt>Blocked</dt>
                <dd>
                  {blocked ? (
                    <StatusBadge tone="danger">Blocked</StatusBadge>
                  ) : (
                    "Not blocked"
                  )}
                </dd>
              </div>
            </dl>
            {ordersTruncated ? (
              <p className="aa-hint">
                Totals and history below cover the 200 most recent orders for this phone.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Block / unblock</CardTitle>
          </CardHeader>
          <CardContent>
            {isSample ? (
              <Notice kind="warning">
                Block actions are unavailable while live customer data cannot be
                loaded. This sample profile cannot be changed.
              </Notice>
            ) : (
              <CustomerBlockForms
                phone={summary.phone}
                blocked={blocked}
                blockedReason={blockedRow?.reason ?? null}
                blockedAt={blockedRow?.blocked_at ?? null}
                blockAction={blockCustomer}
                unblockAction={unblockCustomer}
                canManage={canManageBlock}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Order history</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="aa-table-scroll">
              <table className="aa-table">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Placed</th>
                    <th scope="col">Status</th>
                    <th scope="col">Total</th>
                    <th scope="col">
                      <span>Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <th scope="row">
                        {isSample ? (
                          <span className="aa-cell-main">
                            {formatOrderNumber(order.order_number)}
                          </span>
                        ) : (
                          <Link href={`/admin/sales/orders/${order.id}`} className="aa-cell-main">
                            {formatOrderNumber(order.order_number)}
                          </Link>
                        )}
                      </th>
                      <td data-label="Placed">{formatDateTime(order.placed_at)}</td>
                      <td data-label="Status">
                        <OrderStatusBadge status={order.status} />
                      </td>
                      <td data-label="Total">{formatMoney(order.total_minor)}</td>
                      <td data-label="Details" className="aa-cell-actions">
                        {isSample ? (
                          "—"
                        ) : (
                          <Link className="aa-row-action" href={`/admin/sales/orders/${order.id}`} aria-label={`View order ${order.order_number ? formatOrderNumber(order.order_number) : order.id}`}>
                            View
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
