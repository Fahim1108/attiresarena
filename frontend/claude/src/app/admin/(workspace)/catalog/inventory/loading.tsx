import { SkeletonRows } from "@/components/admin/ui";

export default function CatalogInventoryLoading() {
  return (
    <main id="main" className="aa-main" aria-label="Loading inventory">
      <SkeletonRows rows={6} />
    </main>
  );
}
