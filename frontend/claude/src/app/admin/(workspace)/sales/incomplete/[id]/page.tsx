import Link from "next/link";
import { RECOVERY_STATUS_LABELS, areaRoles } from "@/lib/admin/constants";
import { readCustomerOrderHistory } from "@/lib/admin/customers";
import { formatDateTime, formatMoney } from "@/lib/admin/format";
import { readIncompleteDetail, setRecoveryStatus } from "@/lib/admin/incomplete";
import { resolveDisplayRecord } from "@/lib/admin/sample-data";
import { SAMPLE_INCOMPLETE_DETAIL } from "@/lib/admin/sample-sales";
import { Notice, StatusBadge, type BadgeTone } from "@/components/admin/ui";
import { SampleBadge } from "@/components/admin/SampleBadge";
import { ProductThumbnail } from "@/components/admin/access/ProductThumbnail";
import { CustomerOrderHistoryPanel } from "@/components/admin/sales/CustomerOrderHistoryPanel";
import { RecoveryActions } from "@/components/admin/sales/RecoveryActions";
import { SalesNav } from "@/components/admin/sales/SalesNav";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";

export const metadata = { title: "Incomplete checkout" };

const RECOVERY_TONES: Record<string, BadgeTone> = {
  pending: "warning",
  contacted: "info",
  lost: "neutral",
  recovered: "success",
};

export default async function IncompleteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Null means unavailable: show a labeled sample record with no working
  // recovery actions. A genuinely missing checkout still 404s.
  const { record, isSample } = resolveDisplayRecord(
    await readIncompleteDetail(id),
    SAMPLE_INCOMPLETE_DETAIL,
  );
  const { session, items, valueMinor, log, progressLabel, recoveryEditable } = record;
  // Previous orders are live-only (samples carry no detail links). The
  // read runs under this page's own recovery area; no order is excluded,
  // so a linked placed order shows here too.
  const historyResult = isSample
    ? null
    : await readCustomerOrderHistory(session.phone, { area: areaRoles("recovery") });

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title={session.customer_name}
          description={`${progressLabel} · Last activity ${formatDateTime(session.last_activity_at)}`}
          actions={
            <Link className="aa-secondary" href="/admin/sales/incomplete">
              Back to incomplete orders
            </Link>
          }
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Sales · Incomplete orders
          </p>
        </PageHeader>
        <SalesNav current="incomplete" />

        {isSample ? (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-admin-card border border-admin-border border-l-4 border-l-admin-primary bg-admin-soft-bg px-4 py-3 text-sm leading-6 text-admin-text"
            role="status"
          >
            <SampleBadge />
            <span>
              Live checkout data is unavailable — this checkout could not be
              read. This sample record is for testing the layout only. Recovery
              actions are unavailable, and no sample data is saved.
            </span>
          </div>
        ) : null}

        <Notice kind="info">
          No messages are sent from this panel. Use the contact details shown to follow up.
        </Notice>
        {!recoveryEditable && session.order_id ? (
          <Notice kind="success">
            This checkout became an order.{" "}
            <Link href={`/admin/sales/orders/${session.order_id}`}>View the order</Link>.
          </Notice>
        ) : null}
        {!recoveryEditable && !session.order_id ? (
          <Notice kind="info">
            This checkout is {session.lifecycle_status}, so recovery actions are not available.
          </Notice>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="aa-fact-grid">
              <div>
                <dt>Name</dt>
                <dd>{session.customer_name}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{session.phone}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{session.email ?? "—"}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{session.user_id ? "Signed-in customer" : "Guest"}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatDateTime(session.started_at)}</dd>
              </div>
              <div>
                <dt>Abandoned</dt>
                <dd>{formatDateTime(session.abandoned_at)}</dd>
              </div>
              <div>
                <dt>Recovery status</dt>
                <dd>
                  <StatusBadge tone={RECOVERY_TONES[session.recovery_status] ?? "neutral"}>
                    {RECOVERY_STATUS_LABELS[session.recovery_status]}
                  </StatusBadge>
                </dd>
              </div>
              <div>
                <dt>Basket value</dt>
                <dd>
                  <strong>{formatMoney(valueMinor)}</strong>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {!isSample && historyResult ? (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Previous orders</CardTitle>
              <CardDescription>Other orders placed with this phone number, newest first.</CardDescription>
            </CardHeader>
            <CardContent>
              <CustomerOrderHistoryPanel
                orders={historyResult.orders}
                phone={historyResult.phone}
                truncated={historyResult.truncated}
                unavailable={historyResult.unavailable}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Items</CardTitle>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p>No items were saved in this checkout.</p>
            ) : (
              <div className="aa-table-scroll">
                <table className="aa-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Variant</th>
                      <th scope="col">Qty</th>
                      <th scope="col">Unit price</th>
                      <th scope="col">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <th scope="row">
                          <span style={{ display: "inline-flex", gap: "0.6rem", alignItems: "center" }}>
                            <ProductThumbnail
                              url={item.imageUrl}
                              alt={item.imageAlt}
                            />
                            <span className="aa-cell-main">{item.products?.name ?? "Product"}</span>
                          </span>
                        </th>
                        <td data-label="Variant">
                          {item.product_variants
                            ? `${item.product_variants.size} · ${item.product_variants.color}`
                            : "—"}
                        </td>
                        <td data-label="Qty">{item.quantity}</td>
                        <td data-label="Unit price">{formatMoney(item.unit_price_minor)}</td>
                        <td data-label="Line total">{formatMoney(item.unit_price_minor * item.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {isSample ? (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Follow up</CardTitle>
            </CardHeader>
            <CardContent>
              <Notice kind="warning">
                Recovery actions are unavailable while live checkout data cannot
                be loaded. This sample record cannot be changed.
              </Notice>
            </CardContent>
          </Card>
        ) : recoveryEditable ? (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Follow up</CardTitle>
              <CardDescription>Recovered is display-only: it is recorded automatically when a linked purchase is placed, and cannot be set by hand.</CardDescription>
            </CardHeader>
            <CardContent>
              <RecoveryActions
                sessionId={session.id}
                expectedUpdatedAt={session.updated_at}
                currentRecovery={session.recovery_status}
                action={setRecoveryStatus}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Recovery history</CardTitle>
            <CardDescription>Follow-up notes and automatic recovery events, newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {log.length === 0 ? (
              <p>No recovery activity recorded yet.</p>
            ) : (
              <ul>
                {log.map((entry) => (
                  <li key={entry.id}>
                    {RECOVERY_STATUS_LABELS[entry.previous_recovery_status]} →{" "}
                    {RECOVERY_STATUS_LABELS[entry.new_recovery_status]} ·{" "}
                    {entry.change_source === "manual" ? "Staff" : "Automatic"} ·{" "}
                    {formatDateTime(entry.created_at)}
                    {entry.note ? (
                      <>
                        <br />
                        {entry.note}
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
