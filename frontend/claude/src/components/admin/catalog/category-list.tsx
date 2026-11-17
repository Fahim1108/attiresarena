"use client";

/* Private signed thumbnails are deliberately unoptimized. */
/* eslint-disable @next/next/no-img-element */
import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  deleteCategory,
  normalizeCategoryOrder,
  reorderCategories,
  type CategoryWithUrls,
} from "@/lib/admin/catalog-categories";
import {
  categoryLevelName,
  collectDescendantIds,
  flattenCategoryOptions,
  moveIdInOrder,
  type CategoryNode,
} from "@/lib/admin/catalog-variants";
import { EmptyState, StatusBadge } from "../ui";
import { CategoryForm } from "./category-form";
import styles from "./catalogue-v2.module.css";

export type CategoryTreeNode = CategoryNode<CategoryWithUrls>;

export function CategoryList({
  tree,
  flat,
  canManage,
}: {
  tree: CategoryTreeNode[];
  flat: CategoryWithUrls[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (tree.length === 0) {
    return (
      <EmptyState
        title="No categories yet"
        description="Create your first category to organise products. Categories may be nested up to 3 levels deep."
      />
    );
  }

  const runDelete = async (id: string) => {
    setBusy(true);
    const result = await deleteCategory(id);
    setMessage(result.ok ? { text: result.message, kind: "info" } : { text: result.error, kind: "error" });
    setConfirmDeleteId(null);
    setBusy(false);
    if (result.ok) router.refresh();
  };

  const runMove = async (
    siblings: readonly CategoryTreeNode[],
    id: string,
    delta: -1 | 1,
  ) => {
    const ids = siblings.map((node) => node.id);
    const next = moveIdInOrder(ids, id, delta);
    if (next.join() === ids.join()) return;
    setBusy(true);
    const result = await reorderCategories(next);
    setMessage(result.ok ? { text: result.message, kind: "info" } : { text: result.error, kind: "error" });
    setBusy(false);
    if (result.ok) router.refresh();
  };

  const runNormalize = async () => {
    setBusy(true);
    const result = await normalizeCategoryOrder();
    setMessage(result.ok ? { text: result.message, kind: "info" } : { text: result.error, kind: "error" });
    setBusy(false);
    if (result.ok) router.refresh();
  };

  const renderNodes = (nodes: readonly CategoryTreeNode[]) => (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.75rem" }}>
      {nodes.map((node, index) => {
        const excluded = collectDescendantIds(flat, node.id);
        excluded.add(node.id);
        const parentOptions = flattenCategoryOptions(tree, excluded);
        return (
          <li
            key={node.id}
            className="aa-panel"
            style={{ margin: 0, marginLeft: `${(node.depth - 1) * 1.5}rem` }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
                alignItems: "center",
              }}
            >
              {node.imageUrl ? (
                <img
                  src={node.imageUrl}
                  alt=""
                  width={44}
                  height={44}
                  style={{
                    objectFit: "cover",
                    borderRadius: "var(--admin-radius-card)",
                    border: "1px solid rgb(var(--admin-border))",
                  }}
                />
              ) : null}
              <div style={{ flex: "1 1 12rem", minWidth: 0 }}>
                <strong>{node.name}</strong>{" "}
                <span className={styles.levelBadge}>
                  {categoryLevelName(node.depth)}
                </span>{" "}
                <span className="aa-muted">
                  {node.slug} · sort {node.sort_position}
                  {node.children.length > 0
                    ? ` · ${node.children.length} subcategor${node.children.length === 1 ? "y" : "ies"}`
                    : ""}
                </span>
                {node.description ? (
                  <span className="aa-cell-sub">{node.description}</span>
                ) : null}
              </div>
              <StatusBadge tone={node.published ? "success" : "neutral"}>
                {node.published ? "Visible" : "Hidden"}
              </StatusBadge>
              {canManage ? (
                <div
                  style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}
                >
                  <button
                    type="button"
                    className="aa-secondary"
                    disabled={busy || index === 0}
                    aria-label={`Move ${node.name} up among siblings`}
                    title={index === 0 ? "Already first among siblings" : "Move up among siblings"}
                    onClick={() => void runMove(nodes, node.id, -1)}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    Up
                  </button>
                  <button
                    type="button"
                    className="aa-secondary"
                    disabled={busy || index === nodes.length - 1}
                    aria-label={`Move ${node.name} down among siblings`}
                    title={
                      index === nodes.length - 1
                        ? "Already last among siblings"
                        : "Move down among siblings"
                    }
                    onClick={() => void runMove(nodes, node.id, 1)}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    Down
                  </button>
                  {confirmDeleteId === node.id ? (
                    <>
                      <button
                        type="button"
                        className="aa-button"
                        data-danger
                        disabled={busy}
                        aria-label={`Confirm delete ${node.name}`}
                        onClick={() => void runDelete(node.id)}
                      >
                        Confirm delete
                      </button>
                      <button
                        type="button"
                        className="aa-secondary"
                        aria-label={`Cancel deleting ${node.name}`}
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
                      aria-label={`Delete ${node.name}`}
                      onClick={() => setConfirmDeleteId(node.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            {canManage ? (
              <details style={{ marginTop: "0.75rem" }}>
                <summary>Edit category</summary>
                <div style={{ marginTop: "0.75rem" }}>
                  <CategoryForm
                    key={`${node.id}:${node.updated_at}`}
                    category={node}
                    parentOptions={parentOptions}
                    depth={node.depth}
                  />
                </div>
              </details>
            ) : null}
            {node.children.length > 0 ? (
              <div style={{ marginTop: "0.75rem" }}>
                {renderNodes(node.children)}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

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
      <div className={styles.listToolbar}>
        <p className="aa-hint" style={{ margin: 0 }}>
          Use ↑ ↓ to reorder. Lower order shows first among siblings.
        </p>
        {canManage ? (
          <button
            type="button"
            className="aa-secondary"
            disabled={busy}
            onClick={() => void runNormalize()}
          >
            Normalize order
          </button>
        ) : null}
      </div>
      {renderNodes(tree)}
    </div>
  );
}
