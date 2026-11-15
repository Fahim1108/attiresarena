import { SkeletonRows } from "@/components/admin/ui";

export default function SalesLoading() {
  return (
    <main id="main" className="aa-main">
      <header className="aa-page-heading">
        <div>
          <p className="aa-eyebrow">Sales</p>
          <h1>Loading…</h1>
        </div>
      </header>
      <SkeletonRows rows={6} />
    </main>
  );
}
