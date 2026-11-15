import { SkeletonRows } from "@/components/admin/ui";

export default function CatalogProductsLoading() {
  return (
    <main id="main" tabIndex={-1} className="aa-main" aria-busy="true" aria-label="Loading products">
      <SkeletonRows rows={6} />
    </main>
  );
}
