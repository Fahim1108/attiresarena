import Link from "next/link";
import {
  listCatalogProducts,
  readCategoryOptions,
  readStorefrontFeedHealth,
} from "@/lib/admin/catalog-products";
import { parseCatalogListFilters } from "@/lib/admin/catalog-variants";
import { resolveDisplayData } from "@/lib/admin/sample-data";
import { sampleCatalogProducts } from "@/lib/admin/sample-catalogue";
import {
  hrefWithParams,
  Notice,
  PageHeading,
  Pagination,
} from "@/components/admin/ui";
import { SampleBadge } from "@/components/admin/SampleBadge";
import { FeedHealthIndicator } from "@/components/admin/catalog/feed-health-indicator";
import { ProductListTable } from "@/components/admin/catalog/product-list-table";

export const metadata = { title: "Products" };

export default async function CatalogProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseCatalogListFilters(params);
  const [result, categories, feedHealth] = await Promise.all([
    listCatalogProducts(filters),
    readCategoryOptions({ onUnavailable: "empty" }),
    readStorefrontFeedHealth(),
  ]);
  // Null means UNAVAILABLE (not empty): labelled sample rows, no live
  // querying implied. A live empty list stays an honest empty state.
  const display = resolveDisplayData(result?.items ?? null, sampleCatalogProducts);
  const isSample = display.isSample;
  const canManage = result?.canManage ?? false;
  const saved = typeof params.saved === "string" ? params.saved : "";
  const pagingParams: Record<string, string | string[] | undefined> = {
    ...params,
  };
  delete pagingParams.saved;

  const textParam = (key: string): string =>
    typeof params[key] === "string" ? (params[key] as string) : "";

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Catalog"
        title="Products"
        description="Search, filter and manage catalogue products. Publish a product to show it on the storefront; published products are visible but cannot be ordered yet."
        actions={
          isSample ? (
            <SampleBadge />
          ) : canManage ? (
            <Link href="/admin/catalog/products/new" className="aa-button">
              Add product
            </Link>
          ) : undefined
        }
      />
      <FeedHealthIndicator health={feedHealth} />
      {isSample ? (
        <Notice kind="warning">
          The catalogue could not be loaded, so sample products are shown
          for layout testing only. Sample rows cannot be edited, published
          or deleted, and no changes are saved.
        </Notice>
      ) : result && (result.degraded.length > 0 || result.skippedRows > 0) ? (
        <Notice kind="warning">
          {result.degraded.length > 0 ? (
            <>
              Some product details could not be loaded (
              {result.degraded.join(", ")}), so the affected columns show
              no value. The products below are real and editable.{" "}
            </>
          ) : null}
          {result.skippedRows > 0 ? (
            <>
              {result.skippedRows} product{result.skippedRows === 1 ? "" : "s"}{" "}
              could not be read and {result.skippedRows === 1 ? "is" : "are"}{" "}
              hidden below.
            </>
          ) : null}
        </Notice>
      ) : saved === "created" ? (
        <Notice kind="success">Product created.</Notice>
      ) : null}

      {!isSample ? (
        <form className="aa-toolbar" action="/admin/catalog/products" method="get">
          <div className="aa-field aa-field--grow">
            <label htmlFor="catalog-q">Search</label>
            <input
              id="catalog-q"
              name="q"
              type="search"
              defaultValue={filters.q}
              maxLength={120}
              placeholder="Search by name or slug…"
            />
          </div>
          <div className="aa-field">
            <label htmlFor="catalog-category">Category</label>
            <select
              id="catalog-category"
              name="category"
              defaultValue={filters.categoryId}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div className="aa-field">
            <label htmlFor="catalog-stock">Stock</label>
            <select id="catalog-stock" name="stock" defaultValue={filters.stock}>
              <option value="">Any stock level</option>
              <option value="in-stock">In stock</option>
              <option value="low-stock">Low stock</option>
              <option value="out-of-stock">Out of stock</option>
            </select>
          </div>
          <div className="aa-field">
            <label htmlFor="catalog-min-price">Min price (৳)</label>
            <input
              id="catalog-min-price"
              name="min_price"
              defaultValue={textParam("min_price")}
              inputMode="decimal"
              placeholder="0.00"
            />
          </div>
          <div className="aa-field">
            <label htmlFor="catalog-max-price">Max price (৳)</label>
            <input
              id="catalog-max-price"
              name="max_price"
              defaultValue={textParam("max_price")}
              inputMode="decimal"
              placeholder="No maximum"
            />
          </div>
          <div className="aa-field">
            <label htmlFor="catalog-sort">Sort by</label>
            <select id="catalog-sort" name="sort" defaultValue={filters.sort}>
              <option value="newest">Newest first</option>
              <option value="name">Name</option>
              <option value="price">Lowest price</option>
              <option value="stock">Most stock</option>
            </select>
          </div>
          <button type="submit" className="aa-button">
            Apply filters
          </button>
          <Link href="/admin/catalog/products" className="aa-secondary">
            Clear
          </Link>
        </form>
      ) : null}

      {result?.truncated ? (
        <Notice kind="warning">
          More than 500 products match the name/category search. Only the
          newest 500 were considered for the stock and price filters — narrow
          your search to see the rest.
        </Notice>
      ) : null}

      <p className="aa-muted" role="status">
        {result ? (
          <>
            {result.total} matching product{result.total === 1 ? "" : "s"} ·
            Page {result.page} of {result.totalPages}
          </>
        ) : (
          <>
            {display.items.length} sample product
            {display.items.length === 1 ? "" : "s"}
          </>
        )}
      </p>

      <ProductListTable
        items={display.items}
        canManage={canManage}
        isSample={isSample}
      />

      {!isSample && result ? (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          hrefFor={(page) =>
            hrefWithParams("/admin/catalog/products", pagingParams, {
              page: String(page),
            })
          }
        />
      ) : null}
    </main>
  );
}
