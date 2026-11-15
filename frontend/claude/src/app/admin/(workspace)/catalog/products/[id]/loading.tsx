import { SkeletonRows } from "@/components/admin/ui";

export default function EditCatalogProductLoading() {
  return (
    <main id="main" className="aa-main" aria-label="Loading product">
      <SkeletonRows rows={6} />
    </main>
  );
}
