"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { PRODUCT_BADGES } from "@/lib/admin/constants";
import { slugify } from "@/lib/admin/format";
import type {
  CategoryOption,
  ProductFormState,
} from "@/lib/admin/catalog-products";
import { Notice, Panel } from "../ui";
import { SubmitButton } from "../ui-client";
import { VariantEditor, type VariantDraftInitial } from "./variant-editor";

export interface ProductFormInitial {
  name: string;
  slug: string;
  description: string;
  status: "published" | "archived";
  categoryId: string | null;
  brand: string | null;
  highlights: string[];
  tags: string[];
  badges: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  metaKeywords: string | null;
  basePriceMinor: number | null;
  baseSaleMinor: number | null;
  baseCostMinor: number | null;
  baseStock: number;
}

function minorToDecimal(minor: number | null): string {
  return minor === null ? "" : (minor / 100).toFixed(2);
}

interface CategoryDisplayOption {
  id: string;
  label: string;
}

/** Flatten categories depth-first so children read as subcategories. */
function flattenCategories(categories: CategoryOption[]): CategoryDisplayOption[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const children = new Map<string | null, CategoryOption[]>();
  for (const c of categories) {
    const key = c.parent_id !== null && byId.has(c.parent_id) ? c.parent_id : null;
    const list = children.get(key) ?? [];
    list.push(c);
    children.set(key, list);
  }
  for (const list of children.values()) {
    list.sort(
      (a, b) =>
        (a.sort_position ?? 0) - (b.sort_position ?? 0) ||
        a.name.localeCompare(b.name),
    );
  }
  const options: CategoryDisplayOption[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const c of children.get(parentId) ?? []) {
      if (visited.has(c.id)) continue;
      visited.add(c.id);
      options.push({
        id: c.id,
        label: `${"— ".repeat(depth)}${c.name}${c.published ? "" : " (hidden)"}`,
      });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  // Any category orphaned by a cycle still needs to be selectable.
  for (const c of categories) {
    if (!visited.has(c.id)) {
      options.push({ id: c.id, label: c.name });
    }
  }
  return options;
}

const STOREFRONT_NOTE =
  "Saving here makes the product Active in the admin panel. Display on the public storefront follows the existing publication review and its allowlist — new products do not appear on the storefront automatically.";

export function ProductForm({
  mode,
  action,
  productId,
  updatedAt,
  initial,
  variants,
  categories,
  canManage,
  imagesPanel,
  imageCount,
}: {
  mode: "create" | "edit";
  action: (
    prev: ProductFormState,
    form: FormData,
  ) => Promise<ProductFormState>;
  productId?: string;
  updatedAt?: string;
  initial: ProductFormInitial;
  variants: VariantDraftInitial[];
  categories: CategoryOption[];
  canManage: boolean;
  imagesPanel: ReactNode;
  imageCount: number;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [slugEdited, setSlugEdited] = useState(mode === "edit");
  const [highlights, setHighlights] = useState<string[]>(
    initial.highlights.length ? initial.highlights : [""],
  );

  const fieldError = (key: string) => state.fieldErrors?.[key];
  const errorText = (key: string) => {
    const message = fieldError(key);
    if (!message) return null;
    return (
      <p role="alert" className="aa-hint" style={{ color: "#7a1010" }}>
        {message}
      </p>
    );
  };

  const categoryOptions = flattenCategories(categories);

  return (
    <>
      <form action={formAction}>
        {productId ? <input type="hidden" name="id" value={productId} /> : null}
        {updatedAt ? (
          <input type="hidden" name="updated_at" value={updatedAt} />
        ) : null}
        <Notice kind="info">{STOREFRONT_NOTE}</Notice>
        {state.error ? (
          <p role="alert" className="aa-notice aa-notice--error">
            {state.error}
          </p>
        ) : null}
        {!canManage ? (
          <Notice kind="warning">
            Your role can view this product but cannot save changes.
          </Notice>
        ) : null}

        <fieldset
          disabled={!canManage}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <Panel title="Basic details">
            <div className="aa-form-grid">
              <div className="aa-field">
                <label htmlFor="product-name">Product name</label>
                <input
                  id="product-name"
                  name="name"
                  value={name}
                  maxLength={200}
                  aria-invalid={fieldError("name") ? true : undefined}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slugEdited) setSlug(slugify(e.target.value));
                  }}
                  required
                />
                {errorText("name")}
              </div>
              <div className="aa-field">
                <label htmlFor="product-slug">URL slug</label>
                <input
                  id="product-slug"
                  name="slug"
                  value={slug}
                  maxLength={160}
                  aria-invalid={fieldError("slug") ? true : undefined}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugEdited(true);
                  }}
                  required
                />
                <p className="aa-hint">
                  Lowercase letters, numbers and single hyphens. Generated
                  from the name until you edit it.
                </p>
                {errorText("slug")}
              </div>
              <div className="aa-field">
                <label htmlFor="product-brand">Brand (optional)</label>
                <input
                  id="product-brand"
                  name="brand"
                  defaultValue={initial.brand ?? ""}
                  maxLength={120}
                />
                {errorText("brand")}
              </div>
              <div className="aa-field">
                <label htmlFor="product-category">
                  Category / subcategory
                </label>
                <select
                  id="product-category"
                  name="category_id"
                  defaultValue={initial.categoryId ?? ""}
                >
                  <option value="">No category</option>
                  {categoryOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="aa-hint">
                  Indented entries are subcategories of the entry above them.
                </p>
                {errorText("category_id")}
              </div>
              <div className="aa-field aa-field--full">
                <label htmlFor="product-description">Description</label>
                <textarea
                  id="product-description"
                  name="description"
                  defaultValue={initial.description}
                  maxLength={20000}
                />
                {errorText("description")}
              </div>
              <div className="aa-field aa-field--full">
                <span id="highlights-label" style={{ fontWeight: 600, fontSize: "0.88rem" }}>
                  Highlights (optional)
                </span>
                <div style={{ display: "grid", gap: "0.5rem" }} role="group" aria-labelledby="highlights-label">
                  {highlights.map((highlight, index) => (
                    <div
                      key={index}
                      style={{ display: "flex", gap: "0.5rem" }}
                    >
                      <input
                        name="highlights"
                        value={highlight}
                        maxLength={200}
                        aria-label={`Highlight ${index + 1}`}
                        onChange={(e) =>
                          setHighlights((current) =>
                            current.map((h, i) =>
                              i === index ? e.target.value : h,
                            ),
                          )
                        }
                        placeholder="e.g. 100% cotton, pre-shrunk"
                      />
                      <button
                        type="button"
                        className="aa-row-action aa-row-action--danger"
                        aria-label={`Remove highlight ${index + 1}`}
                        onClick={() =>
                          setHighlights((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="aa-secondary"
                  disabled={highlights.length >= 20}
                  onClick={() => setHighlights((current) => [...current, ""])}
                >
                  Add highlight
                </button>
                {errorText("highlights")}
              </div>
              <div className="aa-field aa-field--full">
                <label htmlFor="product-tags">Tags (comma-separated)</label>
                <input
                  id="product-tags"
                  name="tags"
                  defaultValue={initial.tags.join(", ")}
                  placeholder="e.g. cotton, summer, formal"
                />
                <p className="aa-hint">Up to 20 tags.</p>
                {errorText("tags")}
              </div>
            </div>
          </Panel>

          <Panel
            title="Pricing"
            description="Used for the default variant when the product has no variants below. When variants exist, each variant carries its own prices."
          >
            <div className="aa-form-grid aa-form-grid--3">
              <div className="aa-field">
                <label htmlFor="product-price">Regular price (৳)</label>
                <input
                  id="product-price"
                  name="base_price"
                  defaultValue={minorToDecimal(initial.basePriceMinor)}
                  inputMode="decimal"
                  aria-invalid={fieldError("base_price") ? true : undefined}
                  placeholder="0.00"
                />
                {errorText("base_price")}
              </div>
              <div className="aa-field">
                <label htmlFor="product-sale-price">
                  Sale price (৳, optional)
                </label>
                <input
                  id="product-sale-price"
                  name="base_sale_price"
                  defaultValue={minorToDecimal(initial.baseSaleMinor)}
                  inputMode="decimal"
                  aria-invalid={fieldError("base_sale_price") ? true : undefined}
                  placeholder="Leave empty for no sale"
                />
                {errorText("base_sale_price")}
              </div>
              <div className="aa-field">
                <label htmlFor="product-cost-price">
                  Cost price (৳, optional)
                </label>
                <input
                  id="product-cost-price"
                  name="base_cost_price"
                  defaultValue={minorToDecimal(initial.baseCostMinor)}
                  inputMode="decimal"
                  aria-invalid={fieldError("base_cost_price") ? true : undefined}
                  placeholder="Admin only"
                />
                <p className="aa-hint">
                  Cost prices are admin-only and never shown to customers.
                </p>
                {errorText("base_cost_price")}
              </div>
              <div className="aa-field">
                <label htmlFor="product-stock">
                  Stock (simple products only)
                </label>
                <input
                  id="product-stock"
                  name="base_stock"
                  defaultValue={String(initial.baseStock)}
                  inputMode="numeric"
                  aria-invalid={fieldError("base_stock") ? true : undefined}
                />
                <p className="aa-hint">
                  Initial stock for the default variant. Defaults to 1.
                </p>
                {errorText("base_stock")}
              </div>
            </div>
          </Panel>

          <Panel title="Images">
            {mode === "edit" ? (
              <p>
                {imageCount} image{imageCount === 1 ? "" : "s"} attached.{" "}
                <a href="#product-images">Manage images below</a> — uploads,
                ordering and alt text live there so image changes never
                interfere with saving this form.
              </p>
            ) : (
              <p>
                Save the product first, then add images on its edit page.
                Images are stored privately and shown with signed URLs.
              </p>
            )}
          </Panel>

          <Panel title="Variants">
            <VariantEditor
              initial={variants}
              fieldError={fieldError("variants")}
            />
          </Panel>

          <Panel title="Badges">
            <div className="aa-check-row">
              {PRODUCT_BADGES.map((badge) => (
                <label key={badge}>
                  <input
                    type="checkbox"
                    name="badges"
                    value={badge}
                    defaultChecked={initial.badges.includes(badge)}
                  />
                  {badge}
                </label>
              ))}
            </div>
            {errorText("badges")}
          </Panel>

          <Panel title="Search (SEO)">
            <div className="aa-form-grid">
              <div className="aa-field aa-field--full">
                <label htmlFor="product-seo-title">SEO title</label>
                <input
                  id="product-seo-title"
                  name="seo_title"
                  defaultValue={initial.seoTitle ?? ""}
                  maxLength={160}
                />
                {errorText("seo_title")}
              </div>
              <div className="aa-field aa-field--full">
                <label htmlFor="product-seo-description">
                  SEO description
                </label>
                <textarea
                  id="product-seo-description"
                  name="seo_description"
                  defaultValue={initial.seoDescription ?? ""}
                  maxLength={320}
                />
                {errorText("seo_description")}
              </div>
              <div className="aa-field aa-field--full">
                <label htmlFor="product-meta-keywords">
                  Meta keywords (comma-separated)
                </label>
                <input
                  id="product-meta-keywords"
                  name="meta_keywords"
                  defaultValue={initial.metaKeywords ?? ""}
                  maxLength={500}
                />
                {errorText("meta_keywords")}
              </div>
            </div>
          </Panel>

          <Panel title="Visibility">
            <div className="aa-check-row" role="radiogroup" aria-label="Product status">
              <label>
                <input
                  type="radio"
                  name="status"
                  value="published"
                  defaultChecked={initial.status === "published"}
                />
                Active (published in the admin panel)
              </label>
              <label>
                <input
                  type="radio"
                  name="status"
                  value="archived"
                  defaultChecked={initial.status === "archived"}
                />
                Inactive (archived)
              </label>
            </div>
            <p className="aa-muted">{STOREFRONT_NOTE}</p>
            {errorText("status")}
          </Panel>
        </fieldset>

        {canManage ? (
          <div className="aa-form-actions">
            <SubmitButton pendingLabel="Saving…">
              {mode === "create" ? "Create product" : "Save changes"}
            </SubmitButton>
            <Link href="/admin/catalog/products" className="aa-secondary">
              Cancel
            </Link>
          </div>
        ) : null}
      </form>

      {imagesPanel}
    </>
  );
}
