import Link from "next/link";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/admin/constants";
import { bulkTransitionOrders, exportOrdersCsv, readOrders } from "@/lib/admin/orders";
import { PageHeading, Pagination, hrefWithParams, Notice } from "@/components/admin/ui";
import { OrdersTable } from "@/components/admin/sales/OrdersTable";
import { SalesNav } from "@/components/admin/sales/SalesNav";

export const metadata = { title: "Orders" };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { orders, count, filters, narrowed } = await readOrders(params);
  const totalPages = Math.max(1, Math.ceil(count / filters.pageSize));

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Sales"
        title="Orders"
        description="Cash-on-delivery orders placed through checkout. Status changes follow the fixed order workflow and update stock where the rules require it."
      />
      <SalesNav current="orders" />

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

      {narrowed ? (
        <Notice kind="warning">
          Search matched more than 150 orders. Only the first 150 are shown — narrow the search
          to see the rest.
        </Notice>
      ) : null}
      <p role="status">
        {count} order{count === 1 ? "" : "s"} · Page {filters.page} of {totalPages}
      </p>

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
      />

      <Pagination
        page={filters.page}
        totalPages={totalPages}
        hrefFor={(page) => hrefWithParams("/admin/sales/orders", params, { page: String(page) })}
      />
    </main>
  );
}
