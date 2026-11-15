import { SkeletonRows } from "@/components/admin/ui";

export default function CatalogCategoriesLoading() {
  return (
    <main id="main" tabIndex={-1} className="aa-main" aria-busy="true" aria-label="Loading categories">
      <SkeletonRows rows={6} />
    </main>
  );
}
