import Link from "next/link";
import { formatDateTime, formatMoney, formatOrderNumber } from "@/lib/admin/format";
import type { OrderRow } from "@/lib/admin/orders";
import { Notice } from "@/components/admin/ui";
import { StatusBadge } from "@/components/design-system/StatusBadge";

/**
 * Previous-order history panel shared by the order detail page and the
 * incomplete-order detail page. Mirrors the customer profile's Order
 * history table: order number + date + status + total + a link to each
 * order detail page. Server-rendered (no client JavaScript).
 */
export function CustomerOrderHistoryPanel({
  orders,
  phone,
  truncated,
  unavailable,
}: {
  orders: readonly OrderRow[];
  phone: string | null;
  truncated: boolean;
  unavailable: boolean;
}) {
  if (unavailable) {
    return (
      <Notice kind="warning">
        Previous orders for this customer could not be loaded. Try again
        later.
      </Notice>
    );
  }
  if (orders.length === 0) {
    return <p>No previous orders for this phone number.</p>;
  }
  return (
    <div>
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
                  <Link href={`/admin/sales/orders/${order.id}`} className="aa-cell-main">
                    {formatOrderNumber(order.order_number)}
                  </Link>
                </th>
                <td data-label="Placed">{formatDateTime(order.placed_at)}</td>
                <td data-label="Status">
                  <StatusBadge status={order.status} />
                </td>
                <td data-label="Total">{formatMoney(order.total_minor)}</td>
                <td data-label="Details" className="aa-cell-actions">
                  <Link
                    className="aa-row-action"
                    href={`/admin/sales/orders/${order.id}`}
                    aria-label={`View order ${order.order_number ? formatOrderNumber(order.order_number) : order.id}`}
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && phone ? (
        <p className="aa-hint">
          Showing the {orders.length} most recent previous orders.{" "}
          <Link href={`/admin/sales/customers/${encodeURIComponent(phone)}`}>
            View the full order history
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
