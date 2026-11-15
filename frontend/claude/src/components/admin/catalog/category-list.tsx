"use client";

/* Private signed thumbnails are deliberately unoptimized. */
/* eslint-disable @next/next/no-img-element */
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  deleteCategory,
  reorderCategories,
  type CategoryWithUrls,
} from "@/lib/admin/catalog-categories";
import {
  collectDescendantIds,
  moveIdInOrder,
  type CategoryNode,
} from "@/lib/admin/catalog-variants";
import { EmptyState, StatusBadge } from "../ui";
import { CategoryForm, type CategoryParentOption } from "./category-form";

export type CategoryTreeNode = CategoryNode<CategoryWithUrls>;

/** Flatten a category tree to labelled parent options, skipping excluded ids. */
export function flattenCategoryOptions(
  nodes: readonly CategoryTreeNode[],
  exclude: ReadonlySet<string>,
): CategoryParentOption[] {
  const options: CategoryParentOption[] = [];
  const walk = (list: readonly CategoryTreeNode[]) => {
    for (const node of list) {
      if (!exclude.has(node.id)) {
        options.push({
          id: node.id,
          label: `${"— ".repeat(node.depth - 1)}${node.name}`,
        });
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return options;
}

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
  const [message, setMessage] = useState<string | null>(null);
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
    setMessage(result.ok ? result.message : result.error);
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
    setMessage(result.ok ? result.message : result.error);
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
                    borderRadius: "var(--aa-radius-card)",
                    border: "1px solid rgb(var(--aa-border))",
                  }}
                />
              ) : null}
              <div style={{ flex: "1 1 12rem", minWidth: 0 }}>
                <strong>{node.name}</strong>{" "}
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
                    title={index === 0 ? "Already first among siblings" : "Move up among siblings"}
                    onClick={() => void runMove(nodes, node.id, -1)}
                  >
                    ↑ Up
                  </button>
                  <button
                    type="button"
                    className="aa-secondary"
                    disabled={busy || index === nodes.length - 1}
                    title={
                      index === nodes.length - 1
                        ? "Already last among siblings"
                        : "Move down among siblings"
                    }
                    onClick={() => void runMove(nodes, node.id, 1)}
                  >
                    ↓ Down
                  </button>
                  {confirmDeleteId === node.id ? (
                    <>
                      <button
                        type="button"
                        className="aa-button"
                        data-danger
                        disabled={busy}
                        onClick={() => void runDelete(node.id)}
                      >
                        Confirm delete
                      </button>
                      <button
                        type="button"
                        className="aa-secondary"
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
        <p role="status" className="aa-notice aa-notice--info">
          {message}
        </p>
      ) : null}
      {renderNodes(tree)}
    </div>
  );
}
