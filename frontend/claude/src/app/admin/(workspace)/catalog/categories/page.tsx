import { listCategories } from "@/lib/admin/catalog-categories";
import {
  buildCategoryTree,
  flattenCategoryOptions,
} from "@/lib/admin/catalog-variants";
import { hasAnyRole } from "@/lib/admin/authorization";
import { staffSession } from "@/lib/admin/access";
import { areaRoles } from "@/lib/admin/constants";
import {
  getLayoutSettings,
  saveFeaturedCategoriesCount,
} from "@/lib/admin/layout-settings";
import { FEATURED_CATEGORIES_COUNT_SCHEMA } from "@/lib/admin/reference-adapt";
import { resolveDisplayData } from "@/lib/admin/sample-data";
import { sampleCatalogCategories } from "@/lib/admin/sample-catalogue";
import { Notice } from "@/components/admin/ui";
import { SampleBadge } from "@/components/admin/SampleBadge";
import { CategoryForm } from "@/components/admin/catalog/category-form";
import { FeaturedCountForm } from "@/components/admin/catalog/featured-count-form";
import { CategoryList } from "@/components/admin/catalog/category-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";

export const metadata = { title: "Categories" };

export default async function CatalogCategoriesPage() {
  const live = await listCategories();
  const [session, layoutSettings] = await Promise.all([
    staffSession(),
    getLayoutSettings(),
  ]);
  // The count is a settings-area value (owner-only). Catalogue staff
  // without the settings area never see the card.
  const canManageSettings = hasAnyRole(session, areaRoles("settings"));
  const parsedCount = FEATURED_CATEGORIES_COUNT_SCHEMA.safeParse(
    layoutSettings?.featured_categories_count,
  );
  const featuredCount = parsedCount.success ? parsedCount.data : null;
  // Null means UNAVAILABLE (not empty): labelled sample rows with no
  // working mutations, instead of the error boundary. A live empty
  // list stays an honest empty state.
  const display = resolveDisplayData(
    live?.categories ?? null,
    sampleCatalogCategories,
  );
  const isSample = display.isSample;
  const canManage = live?.canManage ?? false;
  const malformedRows = live?.malformedRows ?? 0;
  const tree = buildCategoryTree(display.items);

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Categories"
          description="Organise products into primary and secondary categories, up to 3 levels deep. A secondary category always belongs to a primary category. Reorder siblings with the up/down buttons."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Catalog
          </p>
        </PageHeader>

        {isSample ? (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-admin-card border border-admin-border border-l-4 border-l-admin-primary bg-admin-soft-bg px-4 py-3 text-sm leading-6 text-admin-text"
            role="status"
          >
            <SampleBadge />
            <span>
              Categories could not be loaded, so sample categories are shown
              for layout testing only. Sample rows cannot be edited, reordered
              or deleted, and no changes are saved.
            </span>
          </div>
        ) : null}

        <Notice kind="info">
          Storefront category display follows existing publication behaviour;
          saving a category here does not change the public storefront feed.
        </Notice>
        {!isSample && malformedRows > 0 ? (
          <Notice kind="warning">
            {malformedRows} categor{malformedRows === 1 ? "y" : "ies"} could
            not be read and {malformedRows === 1 ? "is" : "are"} hidden below.
            The categories shown are complete and editable.
          </Notice>
        ) : !isSample && !canManage ? (
          <Notice kind="warning">
            Your role can view categories but cannot change them.
          </Notice>
        ) : null}

        {canManage && !isSample ? (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Create category</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryForm
                category={null}
                parentOptions={flattenCategoryOptions(tree, new Set())}
              />
            </CardContent>
          </Card>
        ) : null}

        {canManageSettings && !isSample ? (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Featured categories</CardTitle>
              <CardDescription>
                How many categories the Featured Categories section shows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {layoutSettings === null ? (
                <Notice kind="warning">
                  Layout settings could not be loaded. If the
                  reference-additions migration has not applied yet, this value
                  cannot be saved yet.
                </Notice>
              ) : (
                <>
                  <Notice kind="info">
                    Stored only: no Featured Categories section reads this
                    value yet. It is saved for the follow-up that wires the
                    storefront section to it.
                  </Notice>
                  <FeaturedCountForm
                    initialCount={featuredCount}
                    action={saveFeaturedCategoriesCount}
                  />
                </>
              )}
            </CardContent>
          </Card>
        ) : null}

        <CategoryList tree={tree} flat={display.items} canManage={canManage} />
      </div>
    </main>
  );
}
