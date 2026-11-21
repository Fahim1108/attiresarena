import Link from "next/link";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  areaRoles,
} from "@/lib/admin/constants";
import {
  buildSteadfastInvoice,
  isSteadfastConfigured,
  readOrderShipment,
  sendOrderToCourier,
  toShipmentSummary,
} from "@/lib/admin/courier";
import { readCustomerOrderHistory } from "@/lib/admin/customers";
import { formatDateTime, formatOrderNumber } from "@/lib/admin/format";
import { readOrderDetail, setPaymentStatus, transitionOrder, verifyPaymentSubmission } from "@/lib/admin/orders";
import { resolveDisplayRecord } from "@/lib/admin/sample-data";
import { SAMPLE_ORDER_DETAIL } from "@/lib/admin/sample-sales";
import { Notice } from "@/components/admin/ui";
import { SampleBadge } from "@/components/admin/SampleBadge";
import { CourierBookingPanel } from "@/components/admin/sales/CourierBookingPanel";
import { CustomerOrderHistoryPanel } from "@/components/admin/sales/CustomerOrderHistoryPanel";
import { OrderInvoice } from "@/components/admin/sales/OrderInvoice";
import { OrderStatusForm } from "@/components/admin/sales/OrderStatusForm";
import { PaymentStatusForm } from "@/components/admin/sales/PaymentStatusForm";
import { PaymentVerificationCard } from "@/components/admin/sales/PaymentVerificationCard";
import { PrintInvoiceButton } from "@/components/admin/sales/PrintInvoiceButton";
import { SalesNav } from "@/components/admin/sales/SalesNav";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";

export const metadata = { title: "Order details" };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Null means unavailable: show a labeled sample record with no working
  // status change. A genuinely missing order still 404s inside the loader.
  const { record, isSample } = resolveDisplayRecord(
    await readOrderDetail(id),
    SAMPLE_ORDER_DETAIL,
  );
  const { order, items, history, payment } = record;
  const orderLabel = formatOrderNumber(order.order_number);
  // Previous orders + courier state are live-only (samples carry no
  // working actions or detail links). Both reads run in parallel; each
  // degrades honestly on its own if unavailable.
  const [historyResult, shipmentResult] = isSample
    ? [null, null]
    : await Promise.all([
        readCustomerOrderHistory(order.phone, {
          excludeOrderId: order.id,
          area: areaRoles("orders"),
        }),
        readOrderShipment(order.id),
      ]);
  const shipment = shipmentResult?.shipment
    ? toShipmentSummary(shipmentResult.shipment)
    : null;
  const shipmentUnavailable = !isSample && shipmentResult === null;
  const courierConfigured = isSteadfastConfigured();

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <div className="aa-no-print space-y-6">
          <PageHeader
            title={`Order ${orderLabel}`}
            description={`Placed ${formatDateTime(order.placed_at)} · ${ORDER_STATUS_LABELS[order.status]}`}
            actions={
              <>
                <Link className="aa-secondary" href="/admin/sales/orders">
                  Back to orders
                </Link>
                <PrintInvoiceButton />
              </>
            }
          >
            <p className="text-[13px] font-medium text-admin-text-secondary">
              Sales · Orders
            </p>
          </PageHeader>
          <SalesNav current="orders" />
          {isSample ? (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-admin-card border border-admin-border border-l-4 border-l-admin-primary bg-admin-soft-bg px-4 py-3 text-sm leading-6 text-admin-text"
              role="status"
            >
              <SampleBadge />
              <span>
                Live order data is unavailable — this order could not be read.
                This sample record is for testing the layout only. Status
                changes are unavailable, and no sample data is saved.
              </span>
            </div>
          ) : null}
        </div>

        {/* Invoice: the only section that prints. */}
        <OrderInvoice
          invoiceNo={buildSteadfastInvoice(order)}
          order={order}
          items={items}
          shipment={shipment}
          isSample={isSample}
        />

        <div className="aa-no-print space-y-6">
          <PaymentVerificationCard
            submission={payment}
            isSample={isSample}
            verifyAction={verifyPaymentSubmission}
          />

          {isSample ? (
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Change status</CardTitle>
              </CardHeader>
              <CardContent>
                <Notice kind="warning">
                  Status changes are unavailable while live order data cannot be
                  loaded. This sample record cannot be changed.
                </Notice>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Change status</CardTitle>
                <CardDescription>Only the next steps allowed by the order workflow are offered.</CardDescription>
              </CardHeader>
              <CardContent>
                <OrderStatusForm
                  orderId={order.id}
                  currentStatus={order.status}
                  expectedUpdatedAt={order.updated_at}
                  action={transitionOrder}
                />
              </CardContent>
            </Card>
          )}

          {isSample ? (
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Payment status</CardTitle>
              </CardHeader>
              <CardContent>
                <Notice kind="warning">
                  Payment changes are unavailable while live order data cannot
                  be loaded. This sample record cannot be changed.
                </Notice>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Payment status</CardTitle>
                <CardDescription>Advance delivery charge is collected before the order is placed. Only the payment moves allowed by the payment workflow are offered.</CardDescription>
              </CardHeader>
              <CardContent>
                <PaymentStatusForm
                  orderId={order.id}
                  currentPaymentStatus={order.payment_status}
                  expectedUpdatedAt={order.updated_at}
                  action={setPaymentStatus}
                />
              </CardContent>
            </Card>
          )}

          {isSample ? (
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Send to courier</CardTitle>
              </CardHeader>
              <CardContent>
                <Notice kind="warning">
                  Courier booking is unavailable while live order data cannot
                  be loaded. This sample record cannot be booked.
                </Notice>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle headingLevel="h2">Send to courier</CardTitle>
                <CardDescription>One tap books a parcel with Steadfast using the details saved on this order.</CardDescription>
              </CardHeader>
              <CardContent>
                <CourierBookingPanel
                  orderId={order.id}
                  orderLabel={orderLabel}
                  orderStatus={order.status}
                  recipientName={order.customer_name}
                  recipientPhone={order.phone}
                  codMinor={order.total_minor}
                  shipment={shipment}
                  shipmentUnavailable={shipmentUnavailable}
                  configured={courierConfigured}
                  action={sendOrderToCourier}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Status history</CardTitle>
              <CardDescription>Recorded in the admin audit log.</CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p>No status changes recorded yet.</p>
              ) : (
                <ul>
                  {history.map((entry) => {
                    if (entry.kind === "payment") {
                      const before =
                        PAYMENT_STATUS_LABELS[entry.before ?? ""] ?? (entry.before ?? "—");
                      const after =
                        PAYMENT_STATUS_LABELS[entry.after ?? ""] ?? (entry.after ?? "—");
                      return (
                        <li key={entry.id}>
                          Payment: {before} → {after} · {formatDateTime(entry.created_at)}
                        </li>
                      );
                    }
                    const before =
                      entry.before && entry.before in ORDER_STATUS_LABELS
                        ? ORDER_STATUS_LABELS[entry.before as keyof typeof ORDER_STATUS_LABELS]
                        : (entry.before ?? "—");
                    const after =
                      entry.after && entry.after in ORDER_STATUS_LABELS
                        ? ORDER_STATUS_LABELS[entry.after as keyof typeof ORDER_STATUS_LABELS]
                        : (entry.after ?? "—");
                    return (
                      <li key={entry.id}>
                        {before} → {after} · {formatDateTime(entry.created_at)}
                      </li>
                    );
                  })}
                </ul>
              )}
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
        </div>
      </div>
    </main>
  );
}
