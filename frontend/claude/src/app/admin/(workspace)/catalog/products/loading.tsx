import { SkeletonRows } from "@/components/admin/ui";

export default function CatalogProductsLoading() {
  return (
    <main id="main" className="aa-main" aria-label="Loading products">
      <SkeletonRows rows={6} />
    </main>
  );
}
