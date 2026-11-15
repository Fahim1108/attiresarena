import Link from "next/link";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  PAYMENT_STATUS_LABELS,
} from "@/lib/admin/constants";
import { formatDateTime, formatMoney } from "@/lib/admin/format";
import {
  bulkTransitionOrders,
  exportOrdersCsv,
  orderFilters,
  readOrders,
  transitionOrder,
} from "@/lib/admin/orders";
import { resolveDisplayData } from "@/lib/admin/sample-data";
import { SAMPLE_ORDERS } from "@/lib/admin/sample-sales";
import { PageHeading, Pagination, hrefWithParams, Notice, StatusBadge } from "@/components/admin/ui";
import { SampleBadge } from "@/components/admin/SampleBadge";
import { OrdersTable } from "@/components/admin/sales/OrdersTable";
import { SalesNav } from "@/components/admin/sales/SalesNav";
import styles from "@/components/admin/sales/sales-refresh.module.css";

export const metadata = { title: "Orders" };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const result = await readOrders(params);
  const filters = result?.filters ?? orderFilters(params);
  // Null means unavailable: show labeled sample rows with no actions.
  // A live empty list stays an honest empty state inside OrdersTable.
  const { items: orders, isSample } = resolveDisplayData(
    result?.orders ?? null,
    SAMPLE_ORDERS,
  );
  const count = result?.count ?? orders.length;
  const narrowed = result?.narrowed ?? false;
  const totalPages = Math.max(1, Math.ceil(count / filters.pageSize));

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Sales"
        title="Orders"
        description="Cash-on-delivery orders placed through checkout. Status changes follow the fixed order workflow and update stock where the rules require it."
      />
      <SalesNav current="orders" />

      {isSample ? (
        <div className={styles.sampleBanner} role="status">
          <SampleBadge />
          <span>
            Live order data is unavailable — the orders data could not be read.
            These sample rows are for testing the layout only. No changes can
            be made, and no sample data is saved.
          </span>
        </div>
      ) : null}

      {!isSample ? (
        <form className="aa-toolbar" action="/admin/sales/orders" method="get">
          <div className="aa-field aa-field--grow">
            <label htmlFor="orders-q">Search order number, name or phone</label>
            <input id="orders-q" name="q" type="search" maxLength={120} defaultValue={filters.q} />
          </div>
          <div className="aa-field">
            <label htmlFor="orders-status">Status</label>
            <select id="orders-status" name="status" defaultValue={filters.status}>
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ORDER_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="aa-field">
            <label htmlFor="orders-payment">Payment status</label>
            <select id="orders-payment" name="payment" defaultValue={filters.payment}>
              <option value="">All payment statuses</option>
              <option value="unpaid">Unpaid</option>
              <option value="paid">Paid</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>
          <div className="aa-field">
            <label htmlFor="orders-from">Placed from</label>
            <input id="orders-from" name="from" type="date" defaultValue={filters.from} />
          </div>
          <div className="aa-field">
            <label htmlFor="orders-to">Placed to</label>
            <input id="orders-to" name="to" type="date" defaultValue={filters.to} />
          </div>
          <div className="aa-field">
            <label htmlFor="orders-sort">Sort</label>
            <select id="orders-sort" name="sort" defaultValue={filters.sort}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="total-desc">Total: high to low</option>
              <option value="total-asc">Total: low to high</option>
            </select>
          </div>
          <div className="aa-field">
            <label htmlFor="orders-size">Per page</label>
            <select id="orders-size" name="pageSize" defaultValue={String(filters.pageSize)}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
          <button type="submit" className="aa-button">
            Apply filters
          </button>
          <Link className="aa-secondary" href="/admin/sales/orders">
            Clear
          </Link>
        </form>
      ) : null}

      {narrowed ? (
        <Notice kind="warning">
          Search matched more than 150 orders. Only the first 150 are shown — narrow the search
          to see the rest.
        </Notice>
      ) : null}
      <p role="status">
        {isSample ? (
          <>
            {orders.length} sample order{orders.length === 1 ? "" : "s"} shown
          </>
        ) : (
          <>
            {count} order{count === 1 ? "" : "s"} · Page {filters.page} of {totalPages}
          </>
        )}
      </p>

      {isSample ? (
        <div className="aa-table-scroll">
          <table className="aa-table">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Status</th>
                <th scope="col">Payment</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <span className="aa-cell-main">
                      {order.order_number ? `#${order.order_number}` : "Order"}
                    </span>
                    <span className="aa-cell-sub">{formatDateTime(order.placed_at)}</span>
                  </td>
                  <td>
                    <span className="aa-cell-main">{order.customer_name}</span>
                    <span className="aa-cell-sub">{order.phone}</span>
                  </td>
                  <td>
                    <StatusBadge tone={ORDER_STATUS_TONES[order.status]}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </StatusBadge>
                  </td>
                  <td>{PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}</td>
                  <td className={styles.money}>{formatMoney(order.total_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <OrdersTable
          rows={orders.map((order) => ({
            id: order.id,
            order_number: order.order_number,
            customer_name: order.customer_name,
            phone: order.phone,
            status: order.status,
            payment_status: order.payment_status,
            total_minor: order.total_minor,
            placed_at: order.placed_at,
            updated_at: order.updated_at,
          }))}
          exportFilters={{
            q: filters.q,
            status: filters.status,
            payment: filters.payment,
            from: filters.from,
            to: filters.to,
            sort: filters.sort,
          }}
          bulkAction={bulkTransitionOrders}
          exportAction={exportOrdersCsv}
          statusAction={transitionOrder}
        />
      )}

      {!isSample ? (
        <Pagination
          page={filters.page}
          totalPages={totalPages}
          hrefFor={(page) => hrefWithParams("/admin/sales/orders", params, { page: String(page) })}
        />
      ) : null}
    </main>
  );
}
