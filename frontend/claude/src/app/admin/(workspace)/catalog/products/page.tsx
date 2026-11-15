import Link from "next/link";
import {
  listCatalogProducts,
  readCategoryOptions,
} from "@/lib/admin/catalog-products";
import { parseCatalogListFilters } from "@/lib/admin/catalog-variants";
import {
  hrefWithParams,
  Notice,
  PageHeading,
  Pagination,
} from "@/components/admin/ui";
import { ProductListTable } from "@/components/admin/catalog/product-list-table";

export const metadata = { title: "Products" };

export default async function CatalogProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseCatalogListFilters(params);
  const [result, categories] = await Promise.all([
    listCatalogProducts(filters),
    readCategoryOptions(),
  ]);
  const saved = typeof params.saved === "string" ? params.saved : "";
  const pagingParams: Record<string, string | string[] | undefined> = {
    ...params,
  };
  delete pagingParams.saved;

  const textParam = (key: string): string =>
    typeof params[key] === "string" ? (params[key] as string) : "";

  return (
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Catalog"
        title="Products"
        description="Search, filter and manage catalogue products. Status here is Active or Inactive; the public storefront follows its own publication review."
        actions={
          result.canManage ? (
            <Link href="/admin/catalog/products/new" className="aa-button">
              Add product
            </Link>
          ) : undefined
        }
      />
      {saved === "created" ? (
        <Notice kind="success">Product created.</Notice>
      ) : null}

      <form className="aa-toolbar" action="/admin/catalog/products" method="get">
        <div className="aa-field aa-field--grow">
          <label htmlFor="catalog-q">Search</label>
          <input
            id="catalog-q"
            name="q"
            defaultValue={filters.q}
            maxLength={120}
            placeholder="Search by name or slug"
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

      {result.truncated ? (
        <Notice kind="warning">
          More than 500 products match the name/category search. Only the
          newest 500 were considered for the stock and price filters — narrow
          your search to see the rest.
        </Notice>
      ) : null}

      <p className="aa-muted">
        {result.total} matching product{result.total === 1 ? "" : "s"} · Page{" "}
        {result.page} of {result.totalPages}
      </p>

      <ProductListTable items={result.items} canManage={result.canManage} />

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        hrefFor={(page) =>
          hrefWithParams("/admin/catalog/products", pagingParams, {
            page: String(page),
          })
        }
      />
    </main>
  );
}
