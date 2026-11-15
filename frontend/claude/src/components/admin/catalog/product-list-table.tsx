"use client";

/* Private signed thumbnails are deliberately unoptimized. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PRODUCT_DISPLAY_LABELS } from "@/lib/admin/constants";
import { formatMoney } from "@/lib/admin/format";
import {
  bulkDeleteCatalogProducts,
  bulkSetCatalogProductStatus,
  deleteCatalogProduct,
  duplicateCatalogProduct,
  setCatalogProductStatus,
  type CatalogListItem,
} from "@/lib/admin/catalog-products";
import { EmptyState, StatusBadge } from "../ui";

function displayTone(
  status: CatalogListItem["displayStatus"],
): "success" | "neutral" | "warning" {
  return status === "active"
    ? "success"
    : status === "out-of-stock"
      ? "warning"
      : "neutral";
}

function Thumbnail({ item }: { item: CatalogListItem }) {
  if (item.thumbnailUrl) {
    return (
      <img
        className="aa-thumb"
        src={item.thumbnailUrl}
        alt={item.thumbnailAlt}
        width={44}
        height={44}
      />
    );
  }
  const initial = item.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className="aa-thumb"
      aria-label={`No image for ${item.name}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        color: "rgb(var(--aa-text-muted))",
      }}
    >
      {initial}
    </span>
  );
}

export function ProductListTable({
  items,
  canManage,
}: {
  items: CatalogListItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <EmptyState
        title="No products found"
        description="Try a different search or filter, or create a new product."
        action={
          canManage ? (
            <Link href="/admin/catalog/products/new" className="aa-button">
              Add product
            </Link>
          ) : undefined
        }
      />
    );
  }

  const allSelected =
    items.length > 0 && items.every((item) => selected.has(item.id));
  const toggleAll = () => {
    setSelected(
      allSelected ? new Set() : new Set(items.map((item) => item.id)),
    );
  };
  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulkStatus = async (status: "published" | "archived") => {
    setBusy(true);
    const result = await bulkSetCatalogProductStatus([...selected], status);
    setMessage(result.ok ? result.message : result.error);
    if (result.ok) setSelected(new Set());
    setBusy(false);
    router.refresh();
  };

  const runBulkDelete = async () => {
    setBusy(true);
    const result = await bulkDeleteCatalogProducts([...selected]);
    setMessage(result.ok ? result.message : result.error);
    if (result.ok) setSelected(new Set());
    setConfirmBulkDelete(false);
    setBusy(false);
    router.refresh();
  };

  const runDuplicate = async (id: string) => {
    setBusy(true);
    const result = await duplicateCatalogProduct(id);
    setBusy(false);
    if (result.ok && result.productId) {
      router.push(`/admin/catalog/products/${result.productId}?saved=duplicated`);
    } else {
      setMessage(result.ok ? result.message : result.error);
      router.refresh();
    }
  };

  const runStatusToggle = async (item: CatalogListItem) => {
    setBusy(true);
    const next = item.status === "published" ? "archived" : "published";
    const result = await setCatalogProductStatus(item.id, next);
    setMessage(result.ok ? result.message : result.error);
    setBusy(false);
    router.refresh();
  };

  const runDelete = async (id: string) => {
    setBusy(true);
    const result = await deleteCatalogProduct(id);
    setMessage(result.ok ? result.message : result.error);
    setConfirmDeleteId(null);
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      {message ? (
        <p role="status" className="aa-notice aa-notice--info">
          {message}
        </p>
      ) : null}

      {canManage && selected.size > 0 ? (
        <div
          className="aa-panel"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.6rem",
            alignItems: "center",
          }}
        >
          <strong>{selected.size} selected</strong>
          <button
            type="button"
            className="aa-secondary"
            disabled={busy}
            onClick={() => void runBulkStatus("published")}
          >
            Set Active
          </button>
          <button
            type="button"
            className="aa-secondary"
            disabled={busy}
            onClick={() => void runBulkStatus("archived")}
          >
            Set Inactive
          </button>
          {confirmBulkDelete ? (
            <>
              <button
                type="button"
                className="aa-button"
                data-danger
                disabled={busy}
                onClick={() => void runBulkDelete()}
              >
                Confirm delete selected
              </button>
              <button
                type="button"
                className="aa-secondary"
                onClick={() => setConfirmBulkDelete(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="aa-row-action aa-row-action--danger"
              disabled={busy}
              onClick={() => setConfirmBulkDelete(true)}
            >
              Delete selected
            </button>
          )}
          <button
            type="button"
            className="aa-secondary"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <div className="aa-table-scroll">
        <table className="aa-table">
          <thead>
            <tr>
              {canManage ? (
                <th>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all products on this page"
                  />
                </th>
              ) : null}
              <th>Product</th>
              <th>Category</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Status</th>
              <th>
                <span className="aa-cell-actions">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                {canManage ? (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleOne(item.id)}
                      aria-label={`Select ${item.name}`}
                    />
                  </td>
                ) : null}
                <td>
                  <span
                    style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}
                  >
                    <Thumbnail item={item} />
                    <span>
                      <span className="aa-cell-main">{item.name}</span>
                      <span className="aa-cell-sub">
                        {item.slug} · {item.variantCount} variant
                        {item.variantCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </span>
                </td>
                <td>{item.categoryName ?? "—"}</td>
                <td>
                  {item.minPriceMinor === null
                    ? "—"
                    : item.maxPriceMinor !== null &&
                        item.maxPriceMinor !== item.minPriceMinor
                      ? `${formatMoney(item.minPriceMinor)} – ${formatMoney(item.maxPriceMinor)}`
                      : formatMoney(item.minPriceMinor)}
                </td>
                <td>
                  {item.available}{" "}
                  <span className="aa-cell-sub">
                    {item.stockFilter === "out-of-stock"
                      ? "Out of stock"
                      : item.stockFilter === "low-stock"
                        ? "Low stock"
                        : "In stock"}
                  </span>
                </td>
                <td>
                  <StatusBadge tone={displayTone(item.displayStatus)}>
                    {PRODUCT_DISPLAY_LABELS[item.displayStatus]}
                  </StatusBadge>
                </td>
                <td className="aa-cell-actions">
                  <Link
                    href={`/admin/catalog/products/${item.id}`}
                    className="aa-row-action"
                  >
                    {canManage ? "Edit" : "View"}
                  </Link>{" "}
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        className="aa-row-action"
                        disabled={busy}
                        onClick={() => void runDuplicate(item.id)}
                      >
                        Duplicate
                      </button>{" "}
                      <button
                        type="button"
                        className="aa-row-action"
                        disabled={busy}
                        onClick={() => void runStatusToggle(item)}
                      >
                        {item.status === "published"
                          ? "Set Inactive"
                          : "Set Active"}
                      </button>{" "}
                      {confirmDeleteId === item.id ? (
                        <>
                          <button
                            type="button"
                            className="aa-row-action aa-row-action--danger"
                            disabled={busy}
                            onClick={() => void runDelete(item.id)}
                          >
                            Confirm delete
                          </button>{" "}
                          <button
                            type="button"
                            className="aa-row-action"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="aa-row-action aa-row-action--danger"
                          disabled={busy}
                          onClick={() => setConfirmDeleteId(item.id)}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
