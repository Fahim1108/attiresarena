import Link from "next/link";
import { RECOVERY_STATUSES, RECOVERY_STATUS_LABELS } from "@/lib/admin/constants";
import { formatCount, formatDateTime, formatMoney } from "@/lib/admin/format";
import { incompleteFilters, incompleteStats, readIncompleteSessions } from "@/lib/admin/incomplete";
import { resolveDisplayData } from "@/lib/admin/sample-data";
import { SAMPLE_INCOMPLETE_SESSIONS } from "@/lib/admin/sample-sales";
import { PageHeading, Pagination, Notice, StatusBadge, hrefWithParams, type BadgeTone } from "@/components/admin/ui";
import { SampleBadge } from "@/components/admin/SampleBadge";
import { SalesNav } from "@/components/admin/sales/SalesNav";
import styles from "@/components/admin/sales/sales-refresh.module.css";

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
  const result = await readIncompleteSessions(params);
  const filters = result?.filters ?? incompleteFilters(params);
  // Null means unavailable: show labeled sample rows with no detail links.
  // A live empty list stays an honest empty state.
  const { items: sessions, isSample } = resolveDisplayData(
    result?.sessions ?? null,
    SAMPLE_INCOMPLETE_SESSIONS,
  );
  const count = result?.count ?? sessions.length;
  const narrowed = result?.narrowed ?? false;
  const totalPages = Math.max(1, Math.ceil(count / filters.pageSize));
  // 4-stat header from the existing loader data only (loaded page + exact
  // matching count). In sample mode the counts describe the sample rows
  // and are labelled as such; potential revenue is never shown from
  // sample data — revenue is real data only.
  const stats = incompleteStats(sessions, count);

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Sales"
        title="Incomplete orders"
        description="Checkouts that were abandoned with items in the basket and no order placed. Active checkouts, completed orders and browsing-only sessions never appear here."
      />
      <SalesNav current="incomplete" />

      {isSample ? (
        <div className={styles.sampleBanner} role="status">
          <SampleBadge />
          <span>
            Live incomplete-checkout data is unavailable — the checkout data
            could not be read. These sample rows are for testing the layout
            only. No changes can be made, and no sample data is saved.
          </span>
        </div>
      ) : null}

      <Notice kind="info">
        No messages are sent from this panel. Use the contact details shown to follow up.
      </Notice>
      <Notice kind="info">
        Abandonment marking runs at SQL level (no scheduler endpoint), so recently inactive
        checkouts appear here only after the marking function runs.
      </Notice>

      {!isSample ? (
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
      ) : null}

      {narrowed ? (
        <Notice kind="warning">
          Search matched more than 150 checkouts. Only the first 150 are shown — narrow the
          search to see the rest.
        </Notice>
      ) : null}
      <p role="status">
        {isSample ? (
          <>
            {sessions.length} sample incomplete checkout{sessions.length === 1 ? "" : "s"} shown
          </>
        ) : (
          <>
            {count} incomplete checkout{count === 1 ? "" : "s"} · Page {filters.page} of {totalPages}
          </>
        )}
      </p>

      <div className="aa-kpi-grid" aria-label="Incomplete checkout summary">
        <article className="aa-panel aa-kpi">
          <span>Total abandoned</span>
          <strong>{formatCount(stats.totalAbandoned)}</strong>
          <span className="aa-kpi-delta">
            {isSample ? "Sample checkouts shown" : "All matching checkouts"}
          </span>
        </article>
        <article className="aa-panel aa-kpi">
          <span>Pending recovery</span>
          <strong>{formatCount(stats.pendingRecovery)}</strong>
          <span className="aa-kpi-delta">
            {isSample ? "Sample rows on this page" : "Pending or contacted, on this page"}
          </span>
        </article>
        <article className="aa-panel aa-kpi">
          <span>Recovered</span>
          <strong>{formatCount(stats.recovered)}</strong>
          <span className="aa-kpi-delta">
            {isSample ? "Sample rows on this page" : "Recovered, on this page"}
          </span>
        </article>
        <article className="aa-panel aa-kpi">
          <span>Potential revenue</span>
          <strong>
            {isSample ? "Unavailable" : formatMoney(stats.potentialRevenueMinor)}
          </strong>
          <span className="aa-kpi-delta">
            {isSample
              ? "Revenue is never shown from sample data"
              : "Pending + contacted basket value, on this page"}
          </span>
        </article>
      </div>
      {isSample ? null : (
        <p className="aa-hint">
          Pending, recovered and revenue figures cover the checkouts listed on
          this page; the total reflects all matching checkouts. Recovered and
          lost baskets do not count as potential revenue.
        </p>
      )}

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
                    <th scope="row">
                      <span className="aa-cell-main">{session.customer_name}</span>
                      <span className="aa-cell-sub">{session.phone}</span>
                      {session.email ? (
                        <span className="aa-cell-sub">{session.email}</span>
                      ) : null}
                    </th>
                    <td data-label="Items">
                      {names.join(", ")}
                      {items.length > 2 ? ` +${items.length - 2} more` : ""}
                      <span className="aa-cell-sub">
                        {itemCount} item{itemCount === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td data-label="Value">{formatMoney(valueMinor)}</td>
                    <td data-label="Progress">{progressLabel}</td>
                    <td data-label="Last activity">{formatDateTime(session.last_activity_at)}</td>
                    <td data-label="Abandoned">{formatDateTime(session.abandoned_at)}</td>
                    <td data-label="Recovery">
                      <StatusBadge tone={RECOVERY_TONES[session.recovery_status] ?? "neutral"}>
                        {RECOVERY_STATUS_LABELS[session.recovery_status]}
                      </StatusBadge>
                    </td>
                    <td data-label="Details" className="aa-cell-actions">
                      {isSample ? (
                        "—"
                      ) : (
                        <Link className="aa-row-action" href={`/admin/sales/incomplete/${session.id}`} aria-label={`View incomplete checkout for ${session.customer_name}`}>
                          View
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isSample ? (
        <Pagination
          page={filters.page}
          totalPages={totalPages}
          hrefFor={(page) => hrefWithParams("/admin/sales/incomplete", params, { page: String(page) })}
        />
      ) : null}
    </main>
  );
}
