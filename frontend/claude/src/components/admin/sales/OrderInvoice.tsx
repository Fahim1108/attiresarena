import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/admin/constants";
import { formatDate, formatMoney } from "@/lib/admin/format";
import type { OrderItemView, OrderRow } from "@/lib/admin/orders";
import { InvoiceQrCode } from "./InvoiceQrCode";
import { TrackingBarcode } from "./TrackingBarcode";
import {
  INVOICE_WEBSITE_HOST,
  INVOICE_WEBSITE_URL,
  buildInvoiceQrPayload,
  invoiceItemRows,
  invoiceTotalRows,
  normalizeTrackingCode,
} from "./invoice-helpers";

/**
 * Printable invoice sheet: the only section of the order detail page that
 * prints (everything else carries aa-no-print). Presentational only — the
 * page owns data loading; every value here comes from the stored order,
 * its items, or the recorded shipment. No SKUs, no invented rows: the
 * barcode and courier rows appear only when a booking exists, the
 * discount row only when the order has one, and advance-payment rows
 * never appear because orders do not record them.
 */
export function OrderInvoice({
  invoiceNo,
  order,
  items,
  shipment,
  isSample,
}: {
  invoiceNo: string;
  order: OrderRow;
  items: readonly OrderItemView[];
  shipment: { tracking_code: string } | null;
  isSample: boolean;
}) {
  const trackingCode = normalizeTrackingCode(shipment?.tracking_code ?? null);
  const rows = invoiceItemRows(items);
  const totals = invoiceTotalRows(order);
  const paymentMethod = PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method;
  const paymentStatus = PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status;
  const address = [order.address_line, order.area, order.district, order.division]
    .filter(Boolean)
    .join(", ");

  return (
    <section className="aa-invoice" aria-label={`Invoice ${invoiceNo}`}>
      {isSample ? (
        <p className="aa-invoice-sample" role="status">
          Sample record — layout testing only. Not a real order.
        </p>
      ) : null}

      <div className="aa-invoice-head">
        <div className="aa-invoice-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- print sheet: plain img keeps the logo in the printed output without optimizer URL params */}
          <img
            src="/brand/logo-maroon.png"
            alt="Attires Arena"
            width={72}
            height={69}
            className="aa-invoice-logo"
          />
          <div>
            <p className="aa-invoice-brand-name">ATTIRES ARENA</p>
            <p className="aa-invoice-brand-sub">Style Elevated</p>
          </div>
        </div>
        <div className="aa-invoice-title-block">
          <h2 className="aa-invoice-title">INVOICE</h2>
          <dl className="aa-invoice-meta">
            <div>
              <dt>Invoice No</dt>
              <dd>{invoiceNo}</dd>
            </div>
            <div>
              <dt>Invoice Date</dt>
              <dd>
                <time dateTime={order.placed_at}>{formatDate(order.placed_at)}</time>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="aa-invoice-parties">
        <div className="aa-invoice-party">
          <h3 className="aa-invoice-party-title">Bill To</h3>
          <p className="aa-invoice-customer">{order.customer_name}</p>
          <p>Phone: {order.phone}</p>
          {order.email ? <p>Email: {order.email}</p> : null}
          <p>Address: {address}</p>
          {order.note ? (
            <p className="aa-invoice-note">
              <strong>Note:</strong> {order.note}
            </p>
          ) : null}
        </div>
        <div className="aa-invoice-party aa-invoice-party--details">
          <h3 className="aa-invoice-party-title">Order Details</h3>
          <dl className="aa-invoice-details">
            <div>
              <dt>Order No</dt>
              <dd>{order.order_number ? `#${order.order_number}` : "—"}</dd>
            </div>
            <div>
              <dt>Order Date</dt>
              <dd>
                <time dateTime={order.placed_at}>{formatDate(order.placed_at)}</time>
              </dd>
            </div>
            {trackingCode ? (
              <>
                <div>
                  <dt>Courier</dt>
                  <dd>Steadfast</dd>
                </div>
                <div>
                  <dt>Tracking ID</dt>
                  <dd>{trackingCode}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </div>
      </div>

      <div className="aa-invoice-table-wrap">
        <table className="aa-invoice-table">
          <caption className="sr-only">Ordered items</caption>
          <thead>
            <tr>
              <th scope="col">SL</th>
              <th scope="col">Item Description</th>
              <th scope="col">Size</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit Price</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6}>No items recorded.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.sl}>
                  <td>{row.sl}</td>
                  <th scope="row">{row.description}</th>
                  <td data-label="Size">
                    {row.size}
                    {row.color.trim() ? (
                      <span className="aa-invoice-color">{row.color}</span>
                    ) : null}
                  </td>
                  <td data-label="Qty">{row.quantity}</td>
                  <td data-label="Unit Price">{formatMoney(row.unitPriceMinor)}</td>
                  <td data-label="Total">{formatMoney(row.lineTotalMinor)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="aa-invoice-bottom">
        <div className="aa-invoice-codes">
          <figure className="aa-invoice-code">
            <InvoiceQrCode
              payload={buildInvoiceQrPayload({
                invoiceNo,
                trackingCode,
                totalMinor: order.total_minor,
              })}
              label={`Order details QR code for invoice ${invoiceNo}`}
            />
            <figcaption>Order Details QR</figcaption>
          </figure>
          {trackingCode ? (
            <div className="aa-invoice-code">
              <p className="aa-invoice-code-label">Courier Tracking Barcode</p>
              <TrackingBarcode trackingCode={trackingCode} />
              <p className="aa-invoice-tracking-number">{trackingCode}</p>
            </div>
          ) : null}
        </div>
        <dl className="aa-invoice-totals">
          {totals.map((row) => (
            <div key={row.label} className={`aa-invoice-total-row aa-invoice-total-row--${row.kind}`}>
              <dt>{row.label}</dt>
              <dd>
                {row.kind === "discount" ? `−${formatMoney(row.minor)}` : formatMoney(row.minor)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="aa-invoice-payment">
        <strong>Payment Method:</strong> {paymentMethod} · {paymentStatus}
      </p>

      <footer className="aa-invoice-foot">
        <a href={INVOICE_WEBSITE_URL}>{INVOICE_WEBSITE_HOST}</a>
      </footer>
    </section>
  );
}
