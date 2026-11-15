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
import { PublicationActions } from "./publication-actions";
import styles from "./catalogue-v2.module.css";

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
        loading="lazy"
      />
    );
  }
  const initial = item.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className="aa-thumb"
      role="img"
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
  isSample = false,
}: {
  items: CatalogListItem[];
  canManage: boolean;
  /** Sample rows carry no working mutations: no selection, no links, no actions. */
  isSample?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const allowSelection = canManage && !isSample;

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
    setMessage(result.ok ? { text: result.message, kind: "info" } : { text: result.error, kind: "error" });
    if (result.ok) setSelected(new Set());
    setBusy(false);
    router.refresh();
  };

  const runBulkDelete = async () => {
    setBusy(true);
    const result = await bulkDeleteCatalogProducts([...selected]);
    setMessage(result.ok ? { text: result.message, kind: "info" } : { text: result.error, kind: "error" });
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
      setMessage(result.ok ? { text: result.message, kind: "info" } : { text: result.error, kind: "error" });
      router.refresh();
    }
  };

  const runStatusToggle = async (item: CatalogListItem) => {
    setBusy(true);
    const next = item.status === "published" ? "archived" : "published";
    const result = await setCatalogProductStatus(item.id, next);
    setMessage(result.ok ? { text: result.message, kind: "info" } : { text: result.error, kind: "error" });
    setBusy(false);
    router.refresh();
  };

  const runDelete = async (id: string) => {
    setBusy(true);
    const result = await deleteCatalogProduct(id);
    setMessage(result.ok ? { text: result.message, kind: "info" } : { text: result.error, kind: "error" });
    setConfirmDeleteId(null);
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`aa-notice aa-notice--${message.kind === "error" ? "error" : "info"}`}
        >
          {message.text}
        </p>
      ) : null}

      {allowSelection && selected.size > 0 ? (
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
              {allowSelection ? (
                <th scope="col">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all products on this page"
                  />
                </th>
              ) : null}
              <th scope="col">Product</th>
              <th scope="col">Category</th>
              <th scope="col">Price</th>
              <th scope="col">Stock</th>
              <th scope="col">Status</th>
              <th scope="col">Storefront</th>
              <th scope="col">
                <span className="aa-cell-actions">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                {allowSelection ? (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleOne(item.id)}
                      aria-label={`Select ${item.name}`}
                    />
                  </td>
                ) : null}
                <th scope="row">
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
                      {item.badges.length > 0 ? (
                        <span className={styles.badgeRow}>
                          {item.badges.map((badge) => (
                            <span key={badge} className={styles.badgePill}>
                              {badge}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </th>
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
                <td>
                  <PublicationActions
                    productId={item.id}
                    productName={item.name}
                    visibility={item.storefrontVisibility}
                    canManage={canManage && !isSample}
                  />
                </td>
                <td className="aa-cell-actions">
                  {isSample ? (
                    <span className="aa-cell-sub">
                      Actions disabled for sample rows
                    </span>
                  ) : (
                    <>
                  <Link
                    href={`/admin/catalog/products/${item.id}`}
                    className="aa-row-action"
                    aria-label={`${canManage ? "Edit" : "View"} ${item.name}`}
                  >
                    {canManage ? "Edit" : "View"}
                  </Link>{" "}
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        className="aa-row-action"
                        disabled={busy}
                        aria-label={`Duplicate ${item.name}`}
                        onClick={() => void runDuplicate(item.id)}
                      >
                        Duplicate
                      </button>{" "}
                      <button
                        type="button"
                        className="aa-row-action"
                        disabled={busy}
                        aria-label={`${item.status === "published" ? "Set Inactive" : "Set Active"}: ${item.name}`}
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
                            aria-label={`Confirm delete ${item.name}`}
                            onClick={() => void runDelete(item.id)}
                          >
                            Confirm delete
                          </button>{" "}
                          <button
                            type="button"
                            className="aa-row-action"
                            aria-label={`Cancel deleting ${item.name}`}
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
                          aria-label={`Delete ${item.name}`}
                          onClick={() => setConfirmDeleteId(item.id)}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  ) : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
