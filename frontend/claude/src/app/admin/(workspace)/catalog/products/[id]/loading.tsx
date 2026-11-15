import { SkeletonRows } from "@/components/admin/ui";

export default function EditCatalogProductLoading() {
  return (
    <main id="main" tabIndex={-1} className="aa-main" aria-busy="true" aria-label="Loading product">
      <SkeletonRows rows={6} />
    </main>
  );
}
