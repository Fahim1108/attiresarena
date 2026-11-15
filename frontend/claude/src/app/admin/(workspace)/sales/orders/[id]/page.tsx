import Link from "next/link";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/admin/constants";
import { formatDateTime, formatMoney } from "@/lib/admin/format";
import { readOrderDetail, transitionOrder } from "@/lib/admin/orders";
import { PageHeading, Panel, StatusBadge } from "@/components/admin/ui";
import { ProductThumbnail } from "@/components/admin/access/ProductThumbnail";
import { OrderStatusForm } from "@/components/admin/sales/OrderStatusForm";
import { PrintInvoiceButton } from "@/components/admin/sales/PrintInvoiceButton";
import { SalesNav } from "@/components/admin/sales/SalesNav";

export const metadata = { title: "Order details" };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { order, items, history } = await readOrderDetail(id);
  const orderLabel = order.order_number ? `#${order.order_number}` : "Order";

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <div className="aa-no-print">
        <PageHeading
          eyebrow="Sales · Orders"
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
        />
        <SalesNav current="orders" />
      </div>

      {/* Invoice: the only section that prints. */}
      <Panel title="Attires Arena — Invoice">
        <dl className="aa-fact-grid">
          <div>
            <dt>Order</dt>
            <dd>
              {orderLabel}{" "}
              <StatusBadge tone={ORDER_STATUS_TONES[order.status]}>
                {ORDER_STATUS_LABELS[order.status]}
              </StatusBadge>
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
                  <td>
                    {item.size} · {item.color}
                  </td>
                  <td>{item.quantity}</td>
                  <td>{formatMoney(item.unit_price_minor)}</td>
                  <td>{formatMoney(item.line_total_minor)}</td>
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
      </Panel>

      <div className="aa-no-print">
        <Panel title="Change status" description="Only the next steps allowed by the order workflow are offered.">
          <OrderStatusForm
            orderId={order.id}
            currentStatus={order.status}
            expectedUpdatedAt={order.updated_at}
            action={transitionOrder}
          />
        </Panel>

        <Panel title="Status history" description="Recorded in the admin audit log.">
          {history.length === 0 ? (
            <p>No status changes recorded yet.</p>
          ) : (
            <ul>
              {history.map((entry) => {
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
        </Panel>
      </div>
    </main>
  );
}
