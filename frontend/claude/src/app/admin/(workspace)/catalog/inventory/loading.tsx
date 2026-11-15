import { SkeletonRows } from "@/components/admin/ui";

export default function CatalogInventoryLoading() {
  return (
    <main id="main" tabIndex={-1} className="aa-main" aria-busy="true" aria-label="Loading inventory">
      <SkeletonRows rows={6} />
    </main>
  );
}
