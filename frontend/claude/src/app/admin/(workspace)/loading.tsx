import { SkeletonRows } from "@/components/admin/ui";

/**
 * Workspace loading state: shown after the workspace layout resolves the
 * staff session, while a page's own data loads. (The pre-session wait is
 * still covered by src/app/admin/loading.tsx — the layout awaits
 * staffSession() before any of this can stream.) More specific
 * loading.tsx files (catalog products/categories/inventory, sales/*)
 * take precedence for their own segments; this covers everything else,
 * including the dashboard.
 *
 * Skeleton mirrors the workspace content shape — heading, KPI row,
 * panels, table rows — so the swap to real content does not jump.
 * All skeleton blocks are aria-hidden; the main region announces the
 * loading state once.
 */
export default function WorkspaceLoading() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="aa-main"
      aria-busy="true"
      aria-label="Loading administration page"
    >
      <div aria-hidden="true">
        <header className="aa-page-heading">
          <div>
            <div className="aa-skeleton-row" style={{ width: "9rem", height: "1rem" }} />
            <div
              className="aa-skeleton-row"
              style={{ width: "16rem", height: "2rem", marginTop: "0.6rem" }}
            />
          </div>
        </header>
        <div className="aa-kpi-grid">
          <div className="aa-skeleton-row" style={{ height: "6.5rem" }} />
          <div className="aa-skeleton-row" style={{ height: "6.5rem" }} />
          <div className="aa-skeleton-row" style={{ height: "6.5rem" }} />
          <div className="aa-skeleton-row" style={{ height: "6.5rem" }} />
        </div>
        <div className="aa-dashboard-grid">
          <div className="aa-skeleton-row" style={{ height: "15rem" }} />
          <div className="aa-skeleton-row" style={{ height: "15rem" }} />
        </div>
        <SkeletonRows rows={4} />
      </div>
    </main>
  );
}
