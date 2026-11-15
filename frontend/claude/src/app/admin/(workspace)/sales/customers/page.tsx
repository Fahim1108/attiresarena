import Link from "next/link";
import { formatDateTime, formatMoney } from "@/lib/admin/format";
import { exportCustomersCsv, readCustomers } from "@/lib/admin/customers";
import { PageHeading, Pagination, Notice, StatusBadge, hrefWithParams } from "@/components/admin/ui";
import { CustomersExportButton } from "@/components/admin/sales/CustomersExportButton";
import { SalesNav } from "@/components/admin/sales/SalesNav";

export const metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { customers, totalCustomers, filters, truncated, narrowed } = await readCustomers(params);
  const totalPages = Math.max(1, Math.ceil(totalCustomers / filters.pageSize));

  return (
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Sales"
        title="Customers"
        description="Customers are derived from order records grouped by phone. There is no separate customer registry."
        actions={
          <CustomersExportButton
            exportFilters={{ q: filters.q, sort: filters.sort }}
            exportAction={exportCustomersCsv}
          />
        }
      />
      <SalesNav current="customers" />

      <form className="aa-toolbar" action="/admin/sales/customers" method="get">
        <div className="aa-field aa-field--grow">
          <label htmlFor="customers-q">Search name, phone or email</label>
          <input id="customers-q" name="q" type="search" maxLength={120} defaultValue={filters.q} />
        </div>
        <div className="aa-field">
          <label htmlFor="customers-sort">Sort</label>
          <select id="customers-sort" name="sort" defaultValue={filters.sort}>
            <option value="spent">Most spent</option>
            <option value="orders">Most orders</option>
            <option value="recent">Most recent order</option>
          </select>
        </div>
        <div className="aa-field">
          <label htmlFor="customers-size">Per page</label>
          <select id="customers-size" name="pageSize" defaultValue={String(filters.pageSize)}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        <button type="submit" className="aa-button">
          Apply filters
        </button>
        <Link className="aa-secondary" href="/admin/sales/customers">
          Clear
        </Link>
      </form>

      {truncated ? (
        <Notice kind="warning">
          Totals cover the 5,000 most recent orders. Narrow the search for complete totals.
        </Notice>
      ) : null}
      {narrowed ? (
        <Notice kind="warning">
          Search matched more than 150 orders. Only the first 150 were used — narrow the search
          to see the rest.
        </Notice>
      ) : null}
      <p role="status">
        {totalCustomers} customer{totalCustomers === 1 ? "" : "s"} · Page {filters.page} of{" "}
        {totalPages}
      </p>

      {customers.length === 0 ? (
        <p className="aa-panel">No customers match these filters.</p>
      ) : (
        <div className="aa-table-scroll">
          <table className="aa-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Email</th>
                <th scope="col">Orders</th>
                <th scope="col">Total spent</th>
                <th scope="col">Last order</th>
                <th scope="col">Account</th>
                <th scope="col">Blocked</th>
                <th scope="col">
                  <span>Profile</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.phone}>
                  <td>
                    <Link
                      href={`/admin/sales/customers/${encodeURIComponent(customer.phone)}`}
                      className="aa-cell-main"
                    >
                      {customer.name}
                    </Link>
                    <span className="aa-cell-sub">{customer.phone}</span>
                  </td>
                  <td>{customer.email ?? "—"}</td>
                  <td>{customer.orderCount}</td>
                  <td>{formatMoney(customer.totalSpentMinor)}</td>
                  <td>{formatDateTime(customer.lastOrderAt)}</td>
                  <td>{customer.hasAccount ? "Account" : "Guest"}</td>
                  <td>
                    {customer.blocked ? (
                      <StatusBadge tone="danger">Blocked</StatusBadge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="aa-cell-actions">
                    <Link
                      className="aa-row-action"
                      href={`/admin/sales/customers/${encodeURIComponent(customer.phone)}`}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={filters.page}
        totalPages={totalPages}
        hrefFor={(page) => hrefWithParams("/admin/sales/customers", params, { page: String(page) })}
      />
    </main>
  );
}
