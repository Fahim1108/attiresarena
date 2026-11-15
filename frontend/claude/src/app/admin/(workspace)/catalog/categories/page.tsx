import { listCategories } from "@/lib/admin/catalog-categories";
import { buildCategoryTree } from "@/lib/admin/catalog-variants";
import { Notice, PageHeading, Panel } from "@/components/admin/ui";
import { CategoryForm } from "@/components/admin/catalog/category-form";
import {
  CategoryList,
  flattenCategoryOptions,
} from "@/components/admin/catalog/category-list";

export const metadata = { title: "Categories" };

export default async function CatalogCategoriesPage() {
  const { categories, canManage } = await listCategories();
  const tree = buildCategoryTree(categories);

  return (
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Catalog"
        title="Categories"
        description="Organise products into categories and subcategories, up to 3 levels deep. Reorder siblings with the up/down buttons."
      />
      <Notice kind="info">
        Storefront category display follows existing publication behaviour;
        saving a category here does not change the public storefront feed.
      </Notice>
      {!canManage ? (
        <Notice kind="warning">
          Your role can view categories but cannot change them.
        </Notice>
      ) : null}

      {canManage ? (
        <Panel title="Create category">
          <CategoryForm
            category={null}
            parentOptions={flattenCategoryOptions(tree, new Set())}
          />
        </Panel>
      ) : null}

      <CategoryList tree={tree} flat={categories} canManage={canManage} />
    </main>
  );
}
