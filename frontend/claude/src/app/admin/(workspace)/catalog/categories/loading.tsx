import { SkeletonRows } from "@/components/admin/ui";

export default function CatalogCategoriesLoading() {
  return (
    <main id="main" className="aa-main" aria-label="Loading categories">
      <SkeletonRows rows={6} />
    </main>
  );
}
