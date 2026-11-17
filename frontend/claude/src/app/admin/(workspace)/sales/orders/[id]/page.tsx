import Link from "next/link";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  areaRoles,
} from "@/lib/admin/constants";
import {
  isSteadfastConfigured,
  readOrderShipment,
  sendOrderToCourier,
  toShipmentSummary,
} from "@/lib/admin/courier";
import { readCustomerOrderHistory } from "@/lib/admin/customers";
import { formatDateTime, formatMoney } from "@/lib/admin/format";
import { readOrderDetail, setPaymentStatus, transitionOrder } from "@/lib/admin/orders";
import { resolveDisplayRecord } from "@/lib/admin/sample-data";
import { SAMPLE_ORDER_DETAIL } from "@/lib/admin/sample-sales";
import { Notice } from "@/components/admin/ui";
import { SampleBadge } from "@/components/admin/SampleBadge";
import { ProductThumbnail } from "@/components/admin/access/ProductThumbnail";
import { CourierBookingPanel } from "@/components/admin/sales/CourierBookingPanel";
import { CustomerOrderHistoryPanel } from "@/components/admin/sales/CustomerOrderHistoryPanel";
import { OrderStatusForm } from "@/components/admin/sales/OrderStatusForm";
import { PaymentStatusForm } from "@/components/admin/sales/PaymentStatusForm";
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
import { StatusBadge } from "@/components/design-system/StatusBadge";

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
  const { order, items, history } = record;
  const orderLabel = order.order_number ? `#${order.order_number}` : "Order";
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
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Attires Arena — Invoice</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="aa-fact-grid">
              <div>
                <dt>Order</dt>
                <dd>
                  {orderLabel}{" "}
                  <StatusBadge status={order.status} />
                </dd>
              </div>
              <div>
                <dt>Placed</dt>
                <dd>
                  <time dateTime={order.placed_at}>{formatDateTime(order.placed_at)}</time>
                </dd>
              </div>
              <div>
                <dt>Customer</dt>
                <dd>{order.customer_name}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{order.phone}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{order.email ?? "—"}</dd>
              </div>
              <div>
                <dt>Delivery address</dt>
                <dd>
                  {order.address_line}, {order.area}, {order.district}, {order.division}
                </dd>
              </div>
              <div>
                <dt>Payment method</dt>
                <dd>{PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method}</dd>
              </div>
              <div>
                <dt>Payment status</dt>
                <dd>{PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}</dd>
              </div>
            </dl>
            {order.note ? (
              <p>
                <strong>Customer note:</strong> {order.note}
              </p>
            ) : null}

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
                          <ProductThumbnail url={item.imageUrl} alt={item.imageAlt} />
                          <span className="aa-cell-main">{item.product_name}</span>
                        </span>
                      </th>
                      <td data-label="Variant">
                        {item.size} · {item.color}
                      </td>
                      <td data-label="Qty">{item.quantity}</td>
                      <td data-label="Unit price">{formatMoney(item.unit_price_minor)}</td>
                      <td data-label="Line total">{formatMoney(item.line_total_minor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="aa-fact-grid">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatMoney(order.subtotal_minor)}</dd>
              </div>
              <div>
                <dt>Delivery charge</dt>
                <dd>{formatMoney(order.delivery_charge_minor)}</dd>
              </div>
              <div>
                <dt>Discount</dt>
                <dd>{formatMoney(order.discount_minor)}</dd>
              </div>
              <div>
                <dt>Coupon</dt>
                <dd>Not recorded</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>
                  <strong>{formatMoney(order.total_minor)}</strong>
                </dd>
              </div>
            </dl>
            <p className="aa-hint">
              Orders do not record which coupon, if any, was used, so no coupon name is shown.
            </p>
          </CardContent>
        </Card>

        <div className="aa-no-print space-y-6">
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
                <CardDescription>Cash on delivery only. Only the payment moves allowed by the payment workflow are offered.</CardDescription>
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
