import Link from "next/link";
import {
  readInventory,
  readMovementHistory,
  readVariantOptions,
} from "@/lib/admin/catalog-inventory";
import { formatCount, formatDateTime, parsePage } from "@/lib/admin/format";
import {
  hrefWithParams,
  Notice,
  PageHeading,
  Pagination,
  Panel,
  StatusBadge,
} from "@/components/admin/ui";
import { InventoryAdjustForm } from "@/components/admin/catalog/inventory-adjust-form";

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
  const { overview } = inventory;

  return (
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Catalog"
        title="Inventory"
        description="Variant-level stock, manual adjustments with reasons, and the full movement history."
      />

      {variantId ? (
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

      <div className="aa-kpi-grid">
        <section className="aa-panel aa-kpi">
          <span>Products with variants</span>
          <strong>{formatCount(overview.productCount)}</strong>
          <span className="aa-kpi-delta">
            {formatCount(overview.variantCount)} variants
          </span>
        </section>
        <section className="aa-panel aa-kpi">
          <span>Available stock</span>
          <strong>{formatCount(overview.totalAvailable)}</strong>
          <span className="aa-kpi-delta">
            {formatCount(overview.totalOnHand)} on hand ·{" "}
            {formatCount(overview.totalReserved)} reserved
          </span>
        </section>
        <section className="aa-panel aa-kpi">
          <span>Low-stock variants</span>
          <strong>{formatCount(overview.lowStockCount)}</strong>
          <span className="aa-kpi-delta">
            At or below their low-stock threshold
          </span>
        </section>
        <section className="aa-panel aa-kpi">
          <span>Out-of-stock variants</span>
          <strong>{formatCount(overview.outOfStockCount)}</strong>
          <span className="aa-kpi-delta">Nothing available to sell</span>
        </section>
      </div>

      <Panel title="Adjust stock">
        <InventoryAdjustForm
          variants={variantOptions}
          canAdjust={inventory.canAdjust}
        />
        <p className="aa-muted">
          Order-driven stock changes (delivery, cancellation, returns) are
          handled by order processing, not by manual adjustments.
        </p>
      </Panel>

      <form className="aa-toolbar" action="/admin/catalog/inventory" method="get">
        <div className="aa-field aa-field--grow">
          <label htmlFor="inventory-q">Search variants</label>
          <input
            id="inventory-q"
            name="q"
            defaultValue={textParam("q")}
            maxLength={120}
            placeholder="Search by product, size or color"
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
        <button type="submit" className="aa-button">
          Apply filters
        </button>
        <Link href="/admin/catalog/inventory" className="aa-secondary">
          Clear
        </Link>
      </form>

      <p className="aa-muted">
        {inventory.total} matching variant{inventory.total === 1 ? "" : "s"} ·
        Page {inventory.page} of {inventory.totalPages}
      </p>

      <div className="aa-table-scroll">
        <table className="aa-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Size / Color</th>
              <th>On hand</th>
              <th>Reserved</th>
              <th>Available</th>
              <th>Low-stock threshold</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {inventory.rows.map((row) => (
              <tr key={row.variantId}>
                <td>
                  <Link href={`/admin/catalog/products/${row.productId}`}>
                    <span className="aa-cell-main">{row.productName}</span>
                  </Link>
                  <span className="aa-cell-sub">
                    {row.active ? "Active variant" : "Inactive variant"}
                  </span>
                </td>
                <td>
                  {row.size} / {row.color}
                </td>
                <td>{row.onHand ?? "—"}</td>
                <td>{row.reserved ?? "—"}</td>
                <td>{row.available ?? "—"}</td>
                <td>{row.lowStockThreshold ?? "—"}</td>
                <td>{stockBadge(row.stockState)}</td>
              </tr>
            ))}
            {inventory.rows.length === 0 ? (
              <tr>
                <td colSpan={7}>No variants match the current filters.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Pagination
        page={inventory.page}
        totalPages={inventory.totalPages}
        hrefFor={(page) =>
          hrefWithParams("/admin/catalog/inventory", params, {
            page: String(page),
          })
        }
      />

      <Panel
        title="Movement history"
        description="Every stock change, newest first. Actor identities are shown shortened because staff profiles are private."
      >
        <div className="aa-table-scroll">
          <table className="aa-table">
            <thead>
              <tr>
                <th>Variant</th>
                <th>Change</th>
                <th>On hand after</th>
                <th>Reason</th>
                <th>Actor</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {movements.rows.map((movement) => (
                <tr key={movement.id}>
                  <td>{movement.variantLabel}</td>
                  <td
                    style={{
                      color: movement.delta > 0 ? "#1d4d22" : "#7a1010",
                      fontWeight: 600,
                    }}
                  >
                    {movement.delta > 0 ? `+${movement.delta}` : movement.delta}
                  </td>
                  <td>{movement.onHandAfter}</td>
                  <td>{movement.reason}</td>
                  <td>
                    {movement.actorId
                      ? `Staff ${movement.actorId.slice(0, 8)}…`
                      : "Unknown"}
                  </td>
                  <td>{formatDateTime(movement.createdAt)}</td>
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
      </Panel>
    </main>
  );
}
