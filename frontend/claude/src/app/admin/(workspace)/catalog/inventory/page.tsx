import Link from "next/link";
import { AlertTriangle, Boxes, Package, XCircle } from "lucide-react";
import {
  readInventory,
  readMovementHistory,
  readVariantOptions,
} from "@/lib/admin/catalog-inventory";
import { formatCount, formatDateTime, parsePage } from "@/lib/admin/format";
import { resolveDisplayData } from "@/lib/admin/sample-data";
import {
  sampleInventoryOverview,
  sampleInventoryRows,
} from "@/lib/admin/sample-catalogue";
import {
  hrefWithParams,
  Notice,
  Pagination,
  StatusBadge,
} from "@/components/admin/ui";
import { FilterForm } from "@/components/admin/FilterForm";
import { SampleBadge } from "@/components/admin/SampleBadge";
import { InventoryAdjustForm } from "@/components/admin/catalog/inventory-adjust-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import { StatCard } from "@/components/design-system/StatCard";

export const metadata = { title: "Inventory" };

function stockBadge(state: string) {
  if (state === "out-of-stock") {
    return <StatusBadge tone="danger">Out of stock</StatusBadge>;
  }
  if (state === "low-stock") {
    return <StatusBadge tone="warning">Low stock</StatusBadge>;
  }
  if (state === "no-record") {
    return <StatusBadge tone="neutral">No stock record</StatusBadge>;
  }
  return <StatusBadge tone="success">In stock</StatusBadge>;
}

export default async function CatalogInventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const textParam = (key: string): string =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const stockParam = textParam("stock");
  const stock =
    stockParam === "in-stock" ||
    stockParam === "low-stock" ||
    stockParam === "out-of-stock"
      ? stockParam
      : "";
  const variantParam = textParam("variant");
  const variantId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      variantParam,
    )
      ? variantParam
      : undefined;
  const [inventory, movements, variantOptions] = await Promise.all([
    readInventory({
      q: textParam("q").trim().slice(0, 120),
      stock,
      page: parsePage(params.page),
      variantId,
    }),
    readMovementHistory(parsePage(params.mpage)),
    readVariantOptions(),
  ]);
  // Null means UNAVAILABLE (not empty): labelled sample rows with no
  // live querying implied. Movement history is NEVER sampled — an
  // unavailable history shows an honest notice instead.
  const display = resolveDisplayData(inventory?.rows ?? null, sampleInventoryRows);
  const isSample = display.isSample;
  const overview = inventory?.overview ?? sampleInventoryOverview;
  const canAdjust = inventory?.canAdjust ?? false;

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Inventory"
          description="Variant-level stock, manual adjustments with reasons, and the full movement history."
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
              Inventory could not be loaded, so sample stock rows are shown
              for layout testing only. Sample rows cannot be adjusted, and no
              changes are saved.
            </span>
          </div>
        ) : null}

        {variantId && !isSample ? (
          <Notice kind="info">
            Showing a single variant record.{" "}
            <Link href="/admin/catalog/inventory">Show all inventory</Link>
          </Notice>
        ) : null}

        {overview.truncated ? (
          <Notice kind="warning">
            More than 1,000 variants exist. Totals and the table below cover the
            newest 1,000 — use search to narrow to a specific product.
          </Notice>
        ) : null}

        {!isSample && (inventory?.skippedRows ?? 0) > 0 ? (
          <Notice kind="warning">
            {inventory?.skippedRows} variant row
            {(inventory?.skippedRows ?? 0) === 1 ? "" : "s"} could not be read
            and {(inventory?.skippedRows ?? 0) === 1 ? "is" : "are"} not shown
            below. Totals cover the rows that could be read.
          </Notice>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Products with variants"
            value={formatCount(overview.productCount)}
            description={`${formatCount(overview.variantCount)} variants`}
            icon={<Package className="h-5 w-5" aria-hidden="true" />}
          />
          <StatCard
            label="Available stock"
            value={formatCount(overview.totalAvailable)}
            description={`${formatCount(overview.totalOnHand)} on hand · ${formatCount(overview.totalReserved)} reserved`}
            icon={<Boxes className="h-5 w-5" aria-hidden="true" />}
          />
          <StatCard
            label="Low-stock variants"
            value={formatCount(overview.lowStockCount)}
            description="At or below their low-stock threshold"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          />
          <StatCard
            label="Out-of-stock variants"
            value={formatCount(overview.outOfStockCount)}
            description="Nothing available to sell"
            icon={<XCircle className="h-5 w-5" aria-hidden="true" />}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Adjust stock</CardTitle>
          </CardHeader>
          <CardContent>
            {isSample ? (
              <p className="aa-muted">
                Stock adjustments are unavailable while inventory cannot be
                loaded. Sample rows are display-only.
              </p>
            ) : variantOptions === null ? (
              <Notice kind="warning">
                Variant choices could not be loaded. Reload the page to try
                again — no adjustment has been made.
              </Notice>
            ) : (
              <InventoryAdjustForm
                variants={variantOptions}
                canAdjust={canAdjust}
              />
            )}
            <p className="aa-muted">
              Order-driven stock changes (delivery, cancellation, returns) are
              handled by order processing, not by manual adjustments.
            </p>
          </CardContent>
        </Card>

        {!isSample ? (
          <Card>
            <CardContent>
              <FilterForm action="/admin/catalog/inventory" submitLabel="Apply filters" clearHref="/admin/catalog/inventory">
                <div className="aa-field aa-field--grow">
                  <label htmlFor="inventory-q">Search variants</label>
                  <input
                    id="inventory-q"
                    name="q"
                    type="search"
                    defaultValue={textParam("q")}
                    maxLength={120}
                    placeholder="Search by product, size or color…"
                  />
                </div>
                <div className="aa-field">
                  <label htmlFor="inventory-stock">Stock level</label>
                  <select id="inventory-stock" name="stock" defaultValue={stock}>
                    <option value="">Any stock level</option>
                    <option value="in-stock">In stock</option>
                    <option value="low-stock">Low stock</option>
                    <option value="out-of-stock">Out of stock</option>
                  </select>
                </div>
              </FilterForm>
            </CardContent>
          </Card>
        ) : null}

        <p className="aa-muted" role="status">
          {inventory ? (
            <>
              {inventory.total} matching variant{inventory.total === 1 ? "" : "s"}{" "}
              · Page {inventory.page} of {inventory.totalPages}
            </>
          ) : (
            <>
              {display.items.length} sample variant
              {display.items.length === 1 ? "" : "s"}
            </>
          )}
        </p>

        <Card>
          <CardContent>
            <div className="aa-table-scroll">
              <table className="aa-table">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Size / Color</th>
                    <th scope="col">On hand</th>
                    <th scope="col">Reserved</th>
                    <th scope="col">Available</th>
                    <th scope="col">Low-stock threshold</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {display.items.map((row) => (
                    <tr key={row.variantId}>
                      <th scope="row">
                        {isSample ? (
                          <span className="aa-cell-main">{row.productName}</span>
                        ) : (
                          <Link href={`/admin/catalog/products/${row.productId}`}>
                            <span className="aa-cell-main">{row.productName}</span>
                          </Link>
                        )}
                        <span className="aa-cell-sub">
                          {row.active ? "Active variant" : "Inactive variant"}
                        </span>
                      </th>
                      <td data-label="Size / Color">
                        {row.size} / {row.color}
                      </td>
                      <td data-label="On hand">{row.onHand ?? "—"}</td>
                      <td data-label="Reserved">{row.reserved ?? "—"}</td>
                      <td data-label="Available">{row.available ?? "—"}</td>
                      <td data-label="Low-stock threshold">{row.lowStockThreshold ?? "—"}</td>
                      <td data-label="Status">{stockBadge(row.stockState)}</td>
                    </tr>
                  ))}
                  {display.items.length === 0 ? (
                    <tr>
                      <td colSpan={7}>No variants match the current filters.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {!isSample && inventory ? (
          <Pagination
            page={inventory.page}
            totalPages={inventory.totalPages}
            hrefFor={(page) =>
              hrefWithParams("/admin/catalog/inventory", params, {
                page: String(page),
              })
            }
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Movement history</CardTitle>
            <CardDescription>
              Every stock change, newest first. Actor identities are shown shortened because staff profiles are private.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {movements === null ? (
              <Notice kind="warning">
                Movement history could not be loaded. No movements are shown —
                nothing here is sample data.
              </Notice>
            ) : (
              <>
                <div className="aa-table-scroll">
                  <table className="aa-table">
                    <thead>
                      <tr>
                        <th scope="col">Variant</th>
                        <th scope="col">Change</th>
                        <th scope="col">On hand after</th>
                        <th scope="col">Reason</th>
                        <th scope="col">Actor</th>
                        <th scope="col">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.rows.map((movement) => (
                        <tr key={movement.id}>
                          <th scope="row">{movement.variantLabel}</th>
                          <td
                            data-label="Change"
                            className={
                              movement.delta > 0
                                ? "aa-delta-positive"
                                : "aa-delta-negative"
                            }
                          >
                            {movement.delta > 0 ? `+${movement.delta}` : movement.delta}
                          </td>
                          <td data-label="On hand after">{movement.onHandAfter}</td>
                          <td data-label="Reason">{movement.reason}</td>
                          <td data-label="Actor">
                            {movement.actorId
                              ? `Staff ${movement.actorId.slice(0, 8)}…`
                              : "Unknown"}
                          </td>
                          <td data-label="Date">{formatDateTime(movement.createdAt)}</td>
                        </tr>
                      ))}
                      {movements.rows.length === 0 ? (
                        <tr>
                          <td colSpan={6}>No stock movements recorded yet.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={movements.page}
                  totalPages={movements.totalPages}
                  hrefFor={(page) =>
                    hrefWithParams("/admin/catalog/inventory", params, {
                      mpage: String(page),
                    })
                  }
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
