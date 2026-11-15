"use client";

import { useMemo, useState } from "react";
import { officialShirtSizeGuide } from "@/config/shirt-size-guide";
import { SIZE_OPTIONS } from "@/lib/admin/constants";
import { parseMoneyToMinor } from "@/lib/admin/format";
import {
  MAX_VARIANTS_PER_PRODUCT,
  variantPriceErrors,
  type VariantInput,
} from "@/lib/admin/catalog-variants";

export interface VariantDraftInitial {
  id?: string;
  size: string;
  color: string;
  price_minor: number;
  sale_price_minor: number | null;
  cost_price_minor: number | null;
  stock: number;
  active: boolean;
  onHand: number | null;
  available: number | null;
}

interface VariantDraft {
  key: string;
  id?: string;
  size: string;
  color: string;
  price: string;
  sale: string;
  cost: string;
  stock: string;
  active: boolean;
  onHand: number | null;
  available: number | null;
}

function minorToDecimal(minor: number): string {
  return (minor / 100).toFixed(2);
}

function toDraft(initial: VariantDraftInitial, index: number): VariantDraft {
  return {
    key: initial.id ?? `new-${index}`,
    id: initial.id,
    size: initial.size,
    color: initial.color,
    price: minorToDecimal(initial.price_minor),
    sale:
      initial.sale_price_minor === null
        ? ""
        : minorToDecimal(initial.sale_price_minor),
    cost:
      initial.cost_price_minor === null
        ? ""
        : minorToDecimal(initial.cost_price_minor),
    stock: String(initial.stock),
    active: initial.active,
    onHand: initial.onHand,
    available: initial.available,
  };
}

function toVariantInput(
  draft: VariantDraft,
  canViewCosts: boolean,
): VariantInput {
  const price = parseMoneyToMinor(draft.price) ?? -1;
  const sale =
    draft.sale.trim() === "" ? null : (parseMoneyToMinor(draft.sale) ?? -1);
  // Cost-blind sessions serialize null: the server strips costs on read
  // and rejects cost-blind updates, so a null here can never erase a
  // stored cost.
  const cost =
    !canViewCosts || draft.cost.trim() === ""
      ? null
      : (parseMoneyToMinor(draft.cost) ?? -1);
  const stock = /^\d{1,9}$/.test(draft.stock.trim())
    ? Number.parseInt(draft.stock.trim(), 10)
    : -1;
  return {
    ...(draft.id ? { id: draft.id } : {}),
    size: draft.size.trim(),
    color: draft.color.trim(),
    price_minor: price,
    sale_price_minor: sale,
    cost_price_minor: cost,
    stock,
    active: draft.active,
  };
}

/**
 * Variant editor. Serializes its rows into the hidden `variants_json`
 * field the product Server Action validates. No SKU is shown or entered
 * anywhere: SKUs are server-generated internals.
 *
 * Saved variants cannot be removed from this editor (variants may be
 * referenced by inventory and orders); uncheck Active to hide one. Stock
 * for saved variants is display-only here and changes only through
 * Inventory adjustments. New rows carry an initial stock value.
 */
export function VariantEditor({
  initial,
  canViewCosts,
  fieldError,
}: {
  initial: VariantDraftInitial[];
  /** False for cost-blind roles: cost inputs are omitted entirely. */
  canViewCosts: boolean;
  fieldError?: string;
}) {
  const [rows, setRows] = useState<VariantDraft[]>(() =>
    initial.map(toDraft),
  );
  const [nextKey, setNextKey] = useState(initial.length + 1);

  const serialized = useMemo(
    () => JSON.stringify(rows.map((row) => toVariantInput(row, canViewCosts))),
    [rows, canViewCosts],
  );

  const updateRow = (key: string, patch: Partial<VariantDraft>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const addRow = () => {
    if (rows.length >= MAX_VARIANTS_PER_PRODUCT) return;
    const key = `new-${nextKey}`;
    setNextKey((n) => n + 1);
    setRows((current) => [
      ...current,
      {
        key,
        size: "",
        color: "",
        price: "",
        sale: "",
        cost: "",
        stock: "1",
        active: true,
        onHand: null,
        available: null,
      },
    ]);
  };

  return (
    <div>
      <p className="aa-muted">
        Each variant is one size and color combination with its own price and
        stock. Leave the list empty for a simple product: a single default
        variant (One Size / Standard) is created from the Pricing section
        above.
      </p>
      <details>
        <summary>{officialShirtSizeGuide.title} (inches)</summary>
        <div className="aa-table-scroll">
          <table className="aa-table">
            <thead>
              <tr>
                {officialShirtSizeGuide.columns.map((column) => (
                  <th scope="col" key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {officialShirtSizeGuide.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th scope="row" key={i}>{cell}</th>
                    ) : (
                      <td key={i} data-label={officialShirtSizeGuide.columns[i] ?? ""}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {officialShirtSizeGuide.notes.map((note) => (
          <p key={note} className="aa-muted">
            {note}
          </p>
        ))}
      </details>

      <input type="hidden" name="variants_json" value={serialized} />
      {fieldError ? (
        <p role="alert" className="aa-notice aa-notice--error">
          {fieldError}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="aa-muted">
          No variants yet. Add one below, or leave this empty for a simple
          product.
        </p>
      ) : null}

      <div style={{ display: "grid", gap: "1rem" }}>
        {rows.map((row, index) => {
          const parsed = toVariantInput(row, canViewCosts);
          const hasContent =
            row.size.trim() !== "" ||
            row.color.trim() !== "" ||
            row.price.trim() !== "";
          const hints = hasContent ? variantPriceErrors(parsed) : [];
          const saved = Boolean(row.id);
          return (
            <section
              key={row.key}
              aria-label={`Variant ${index + 1}`}
              style={{
                border: "1px solid rgb(var(--aa-border))",
                borderRadius: "var(--aa-radius-card)",
                padding: "1rem",
              }}
            >
              <div className="aa-form-grid aa-form-grid--3">
                <div className="aa-field">
                  <label htmlFor={`variant-size-${row.key}`}>Size</label>
                  <input
                    id={`variant-size-${row.key}`}
                    list="aa-size-options"
                    value={row.size}
                    maxLength={40}
                    onChange={(e) => updateRow(row.key, { size: e.target.value })}
                    placeholder="e.g. M or custom size"
                    required
                  />
                </div>
                <div className="aa-field">
                  <label htmlFor={`variant-color-${row.key}`}>Color</label>
                  <input
                    id={`variant-color-${row.key}`}
                    value={row.color}
                    maxLength={80}
                    onChange={(e) => updateRow(row.key, { color: e.target.value })}
                    placeholder="e.g. Maroon"
                    required
                  />
                </div>
                <div className="aa-field">
                  <label htmlFor={`variant-price-${row.key}`}>
                    Regular price (৳)
                  </label>
                  <input
                    id={`variant-price-${row.key}`}
                    value={row.price}
                    inputMode="decimal"
                    onChange={(e) => updateRow(row.key, { price: e.target.value })}
                    placeholder="0.00"
                    required
                  />
                </div>
                <div className="aa-field">
                  <label htmlFor={`variant-sale-${row.key}`}>
                    Sale price (৳, optional)
                  </label>
                  <input
                    id={`variant-sale-${row.key}`}
                    value={row.sale}
                    inputMode="decimal"
                    onChange={(e) => updateRow(row.key, { sale: e.target.value })}
                    placeholder="Leave empty for no sale"
                  />
                </div>
                {canViewCosts ? (
                  <div className="aa-field">
                    <label htmlFor={`variant-cost-${row.key}`}>
                      Cost price (৳, optional)
                    </label>
                    <input
                      id={`variant-cost-${row.key}`}
                      value={row.cost}
                      inputMode="decimal"
                      onChange={(e) => updateRow(row.key, { cost: e.target.value })}
                      placeholder="Admin only, never shown to customers"
                    />
                  </div>
                ) : null}
                <div className="aa-field">
                  {saved ? (
                    <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>
                      Stock (see Inventory)
                    </span>
                  ) : (
                    <label htmlFor={`variant-stock-${row.key}`}>
                      Initial stock
                    </label>
                  )}
                  {saved ? (
                    <p className="aa-muted" style={{ margin: 0 }}>
                      On hand {row.onHand ?? "—"} · Available{" "}
                      {row.available ?? "—"}. Change stock in Inventory.
                    </p>
                  ) : (
                    <input
                      id={`variant-stock-${row.key}`}
                      value={row.stock}
                      inputMode="numeric"
                      onChange={(e) => updateRow(row.key, { stock: e.target.value })}
                    />
                  )}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "1rem",
                  alignItems: "center",
                  marginTop: "0.75rem",
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    gap: "0.45rem",
                    alignItems: "center",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={row.active}
                    onChange={(e) =>
                      updateRow(row.key, { active: e.target.checked })
                    }
                  />
                  Active
                </label>
                {!saved ? (
                  <button
                    type="button"
                    className="aa-row-action aa-row-action--danger"
                    aria-label={`Remove variant ${index + 1}`}
                    onClick={() =>
                      setRows((current) =>
                        current.filter((r) => r.key !== row.key),
                      )
                    }
                  >
                    Remove this variant
                  </button>
                ) : (
                  <span className="aa-muted">
                    Saved variants cannot be removed here; uncheck Active to
                    hide one.
                  </span>
                )}
              </div>
              {hints.map((hint) => (
                <p key={hint} className="aa-notice aa-notice--warning">
                  Variant {index + 1}: {hint}
                </p>
              ))}
            </section>
          );
        })}
      </div>

      <datalist id="aa-size-options">
        {SIZE_OPTIONS.map((size) => (
          <option key={size} value={size} />
        ))}
      </datalist>

      <div className="aa-form-actions">
        <button
          type="button"
          className="aa-secondary"
          onClick={addRow}
          disabled={rows.length >= MAX_VARIANTS_PER_PRODUCT}
        >
          Add variant
        </button>
        {rows.length >= MAX_VARIANTS_PER_PRODUCT ? (
          <span className="aa-muted">
            Maximum {MAX_VARIANTS_PER_PRODUCT} variants per product.
          </span>
        ) : null}
      </div>
    </div>
  );
}
