"use client";

import { useMemo, useState } from "react";
import { SIZE_OPTIONS } from "@/lib/admin/constants";
import {
  MAIN_SIZES_DEFAULT_COLOR,
  MAX_VARIANTS_PER_PRODUCT,
  type MainSizeRowInput,
} from "@/lib/admin/catalog-variants";

interface MainSizeDraft {
  key: string;
  size: string;
  stock: string;
}

function toRowInput(draft: MainSizeDraft): MainSizeRowInput {
  const stock = /^\d{1,9}$/.test(draft.stock.trim())
    ? Number.parseInt(draft.stock.trim(), 10)
    : -1;
  return { size: draft.size.trim(), stock };
}

/**
 * Main-level sizes editor. Serializes its rows into the hidden
 * `main_sizes_json` field the product Server Action expands into
 * ordinary variant rows (materialization — see catalog-variants.ts),
 * so customers can select a size without any variant added below.
 *
 * No pre-fill on edit (coordinator decision OQ-5): rows added here are
 * always NEW sizes. A size that already exists under Variants must be
 * edited there; the server reports it as a field error here instead of
 * creating a duplicate. Each size carries its own stock, set per row.
 */
export function MainSizesEditor({
  fieldError,
  colorError,
}: {
  fieldError?: string;
  colorError?: string;
}) {
  const [rows, setRows] = useState<MainSizeDraft[]>([]);
  const [nextKey, setNextKey] = useState(1);

  const serialized = useMemo(
    () => JSON.stringify(rows.map(toRowInput)),
    [rows],
  );

  const updateRow = (key: string, patch: Partial<MainSizeDraft>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const addRow = () => {
    if (rows.length >= MAX_VARIANTS_PER_PRODUCT) return;
    const key = `size-${nextKey}`;
    setNextKey((n) => n + 1);
    setRows((current) => [...current, { key, size: "", stock: "1" }]);
  };

  return (
    <div>
      <p className="aa-muted">
        Sizes listed here work without adding variants below: customers
        can select them on the product page. Each size carries its own
        stock, set below, and uses the prices from the Pricing section
        above. If a size already exists under Variants, edit it there
        instead of adding it here.
      </p>
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="main-color">Main color</label>
          <input
            id="main-color"
            name="main_color"
            defaultValue={MAIN_SIZES_DEFAULT_COLOR}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={colorError ? true : undefined}
            aria-describedby={colorError ? "main-color-error" : undefined}
            placeholder="e.g. Standard…"
          />
          <p className="aa-hint">
            The color shown for these sizes. Needed only when sizes are
            listed here.
          </p>
          {colorError ? (
            <p
              role="alert"
              id="main-color-error"
              className="aa-notice aa-notice--error"
            >
              {colorError}
            </p>
          ) : null}
        </div>
      </div>

      <input type="hidden" name="main_sizes_json" value={serialized} />
      {fieldError ? (
        <p role="alert" id="main-sizes-error" className="aa-notice aa-notice--error">
          {fieldError}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="aa-muted">
          No sizes yet. Add a size below, or leave this empty and use
          Variants.
        </p>
      ) : null}

      <div style={{ display: "grid", gap: "0.75rem" }}>
        {rows.map((row, index) => (
          <div
            key={row.key}
            style={{
              display: "flex",
              gap: "0.5rem",
              flexWrap: "wrap",
              alignItems: "end",
            }}
          >
            <div className="aa-field" style={{ flex: "1 1 8rem" }}>
              <label htmlFor={`main-size-${row.key}`}>Size</label>
              <input
                id={`main-size-${row.key}`}
                list="aa-main-size-options"
                value={row.size}
                maxLength={40}
                onChange={(e) =>
                  updateRow(row.key, { size: e.target.value })
                }
                placeholder="e.g. M…"
                aria-invalid={
                  fieldError && index === 0 ? true : undefined
                }
                aria-describedby={
                  fieldError && index === 0
                    ? "main-sizes-error"
                    : undefined
                }
              />
            </div>
            <div className="aa-field" style={{ flex: "0 0 7rem" }}>
              <label htmlFor={`main-stock-${row.key}`}>Stock</label>
              <input
                id={`main-stock-${row.key}`}
                value={row.stock}
                inputMode="numeric"
                onChange={(e) =>
                  updateRow(row.key, { stock: e.target.value })
                }
                placeholder="1"
              />
            </div>
            <button
              type="button"
              className="aa-row-action aa-row-action--danger"
              aria-label={`Remove size ${index + 1}`}
              onClick={() =>
                setRows((current) =>
                  current.filter((r) => r.key !== row.key),
                )
              }
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <datalist id="aa-main-size-options">
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
          Add size
        </button>
        {rows.length >= MAX_VARIANTS_PER_PRODUCT ? (
          <span className="aa-muted">
            Maximum {MAX_VARIANTS_PER_PRODUCT} variants per product,
            including main sizes.
          </span>
        ) : null}
      </div>
    </div>
  );
}
