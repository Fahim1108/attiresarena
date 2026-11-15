import Link from "next/link";
import { RECOVERY_STATUSES, RECOVERY_STATUS_LABELS } from "@/lib/admin/constants";
import { formatDateTime, formatMoney } from "@/lib/admin/format";
import { readIncompleteSessions } from "@/lib/admin/incomplete";
import { PageHeading, Pagination, Notice, StatusBadge, hrefWithParams, type BadgeTone } from "@/components/admin/ui";
import { SalesNav } from "@/components/admin/sales/SalesNav";

export const metadata = { title: "Incomplete orders" };

const RECOVERY_TONES: Record<string, BadgeTone> = {
  pending: "warning",
  contacted: "info",
  lost: "neutral",
  recovered: "success",
};

export default async function IncompletePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { sessions, count, filters, narrowed } = await readIncompleteSessions(params);
  const totalPages = Math.max(1, Math.ceil(count / filters.pageSize));

  return (
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Sales"
        title="Incomplete orders"
        description="Checkouts that were abandoned with items in the basket and no order placed. Active checkouts, completed orders and browsing-only sessions never appear here."
      />
      <SalesNav current="incomplete" />

      <Notice kind="info">
        No messages are sent from this panel. Use the contact details shown to follow up.
      </Notice>
      <Notice kind="info">
        Abandonment marking runs at SQL level (no scheduler endpoint), so recently inactive
        checkouts appear here only after the marking function runs.
      </Notice>

      <form className="aa-toolbar" action="/admin/sales/incomplete" method="get">
        <div className="aa-field aa-field--grow">
          <label htmlFor="incomplete-q">Search name, phone or email</label>
          <input id="incomplete-q" name="q" type="search" maxLength={120} defaultValue={filters.q} />
        </div>
        <div className="aa-field">
          <label htmlFor="incomplete-recovery">Recovery status</label>
          <select id="incomplete-recovery" name="recovery" defaultValue={filters.recovery}>
            <option value="">All recovery statuses</option>
            {RECOVERY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {RECOVERY_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <div className="aa-field">
          <label htmlFor="incomplete-sort">Sort</label>
          <select id="incomplete-sort" name="sort" defaultValue={filters.sort}>
            <option value="recent">Most recent activity</option>
            <option value="oldest">Longest abandoned</option>
          </select>
        </div>
        <div className="aa-field">
          <label htmlFor="incomplete-size">Per page</label>
          <select id="incomplete-size" name="pageSize" defaultValue={String(filters.pageSize)}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        <button type="submit" className="aa-button">
          Apply filters
        </button>
        <Link className="aa-secondary" href="/admin/sales/incomplete">
          Clear
        </Link>
      </form>

      {narrowed ? (
        <Notice kind="warning">
          Search matched more than 150 checkouts. Only the first 150 are shown — narrow the
          search to see the rest.
        </Notice>
      ) : null}
      <p role="status">
        {count} incomplete checkout{count === 1 ? "" : "s"} · Page {filters.page} of {totalPages}
      </p>

      {sessions.length === 0 ? (
        <p className="aa-panel">No incomplete checkouts match these filters.</p>
      ) : (
        <div className="aa-table-scroll">
          <table className="aa-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Items</th>
                <th scope="col">Value</th>
                <th scope="col">Progress</th>
                <th scope="col">Last activity</th>
                <th scope="col">Abandoned</th>
                <th scope="col">Recovery</th>
                <th scope="col">
                  <span>Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(({ session, items, valueMinor, itemCount, progressLabel }) => {
                const names = items
                  .map((item) => item.products?.name ?? "Product")
                  .slice(0, 2);
                return (
                  <tr key={session.id}>
                    <td>
                      <span className="aa-cell-main">{session.customer_name}</span>
                      <span className="aa-cell-sub">{session.phone}</span>
                      {session.email ? (
                        <span className="aa-cell-sub">{session.email}</span>
                      ) : null}
                    </td>
                    <td>
                      {names.join(", ")}
                      {items.length > 2 ? ` +${items.length - 2} more` : ""}
                      <span className="aa-cell-sub">
                        {itemCount} item{itemCount === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td>{formatMoney(valueMinor)}</td>
                    <td>{progressLabel}</td>
                    <td>{formatDateTime(session.last_activity_at)}</td>
                    <td>{formatDateTime(session.abandoned_at)}</td>
                    <td>
                      <StatusBadge tone={RECOVERY_TONES[session.recovery_status] ?? "neutral"}>
                        {RECOVERY_STATUS_LABELS[session.recovery_status]}
                      </StatusBadge>
                    </td>
                    <td className="aa-cell-actions">
                      <Link className="aa-row-action" href={`/admin/sales/incomplete/${session.id}`}>
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={filters.page}
        totalPages={totalPages}
        hrefFor={(page) => hrefWithParams("/admin/sales/incomplete", params, { page: String(page) })}
      />
    </main>
  );
}
