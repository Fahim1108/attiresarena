"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { PRODUCT_BADGES } from "@/lib/admin/constants";
import { slugify } from "@/lib/admin/format";
import { youtubeWatchUrl } from "@/lib/youtube-video";
import { YoutubeVideoPlayer } from "@/components/product/YoutubeVideoPlayer";
import {
  deriveCategoryPair,
  primaryCategories,
  secondaryCategoriesFor,
} from "@/lib/admin/catalog-variants";
import type {
  CategoryOption,
  ProductFormState,
} from "@/lib/admin/catalog-products";
import { Notice, Panel } from "../ui";
import { focusFirstInvalid, SubmitButton } from "../ui-client";
import { MainSizesEditor } from "./main-sizes-editor";
import { RadioOptionGroup } from "./radio-option-cards";
import { VariantEditor, type VariantDraftInitial } from "./variant-editor";

export interface ProductFormInitial {
  name: string;
  slug: string;
  description: string;
  status: "published" | "archived";
  categoryId: string | null;
  secondaryCategoryId: string | null;
  brand: string | null;
  highlights: string[];
  tags: string[];
  badges: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  metaKeywords: string | null;
  /** Canonical 11-char YouTube video ID, or null when no video is set. */
  youtubeVideoId: string | null;
  basePriceMinor: number | null;
  baseSaleMinor: number | null;
  baseCostMinor: number | null;
  baseStock: number;
}

function minorToDecimal(minor: number | null): string {
  return minor === null ? "" : (minor / 100).toFixed(2);
}

const STOREFRONT_NOTE =
  "Saving here sets the product Active or Inactive in the admin panel. Publishing — from the product list or the edit page — shows it on the public storefront. Published products are visible but cannot be ordered yet.";

export function ProductForm({
  mode,
  action,
  productId,
  updatedAt,
  initial,
  variants,
  categories,
  canManage,
  canViewCosts,
  imagesPanel,
  imageCount,
  stagedPanel,
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
  /** False for cost-blind roles: cost inputs are omitted entirely. */
  canViewCosts: boolean;
  imagesPanel: ReactNode;
  imageCount: number;
  /** Pre-upload panel, rendered inside the form in create mode only. */
  stagedPanel?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.fieldErrors && Object.keys(state.fieldErrors).length > 0) {
      focusFirstInvalid(formRef.current);
    }
  }, [state]);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [slugEdited, setSlugEdited] = useState(mode === "edit");
  const [highlights, setHighlights] = useState<string[]>(
    initial.highlights.length ? initial.highlights : [""],
  );
  const [seoTitleLength, setSeoTitleLength] = useState(
    initial.seoTitle?.length ?? 0,
  );
  const [seoDescriptionLength, setSeoDescriptionLength] = useState(
    initial.seoDescription?.length ?? 0,
  );
  // Primary + secondary assignment. The stored assignment is mapped
  // onto the pair once (see deriveCategoryPair); a third-level stored
  // category cannot be represented and is reported below the selects.
  const [pair] = useState(() =>
    deriveCategoryPair(categories, initial.categoryId, initial.secondaryCategoryId),
  );
  const [primaryId, setPrimaryId] = useState(pair.primaryId ?? "");
  const [secondaryId, setSecondaryId] = useState(pair.secondaryId ?? "");
  const replacedCategory = pair.replacedId
    ? (categories.find((c) => c.id === pair.replacedId) ?? null)
    : null;
  const primaries = primaryCategories(categories);
  const secondaries = primaryId
    ? secondaryCategoriesFor(categories, primaryId)
    : [];
  const categoryLabel = (category: CategoryOption) =>
    `${category.name}${category.published ? "" : " (hidden)"}`;

  const fieldError = (key: string) => state.fieldErrors?.[key];
  // Saved video, when the stored ID is valid: pre-fills the link field
  // and powers the saved-link + preview below the field.
  const savedVideoUrl = initial.youtubeVideoId
    ? youtubeWatchUrl(initial.youtubeVideoId)
    : null;
  // Inline errors are announced through aria-describedby on their field
  // (plus focus moves to the first invalid field), not assertive alerts.
  const errorText = (key: string, inputId: string) => {
    const message = fieldError(key);
    if (!message) return null;
    return (
      <p id={`${inputId}-error`} className="aa-hint aa-field-error">
        {message}
      </p>
    );
  };
  const describedBy = (key: string, inputId: string) =>
    fieldError(key) ? `${inputId}-error` : undefined;

  return (
    <>
      <form action={formAction} ref={formRef}>
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
                  aria-describedby={describedBy("name", "product-name")}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slugEdited) setSlug(slugify(e.target.value));
                  }}
                  required
                />
                {errorText("name", "product-name")}
              </div>
              <div className="aa-field">
                <label htmlFor="product-slug">URL slug</label>
                <input
                  id="product-slug"
                  name="slug"
                  value={slug}
                  maxLength={160}
                  aria-invalid={fieldError("slug") ? true : undefined}
                  aria-describedby={describedBy("slug", "product-slug")}
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
                {errorText("slug", "product-slug")}
              </div>
              <div className="aa-field">
                <label htmlFor="product-brand">Brand (optional)</label>
                <input
                  id="product-brand"
                  name="brand"
                  defaultValue={initial.brand ?? ""}
                  maxLength={120}
                  aria-invalid={fieldError("brand") ? true : undefined}
                  aria-describedby={describedBy("brand", "product-brand")}
                />
                {errorText("brand", "product-brand")}
              </div>
              <div className="aa-field">
                <label htmlFor="product-category">Primary category</label>
                <select
                  id="product-category"
                  name="category_id"
                  value={primaryId}
                  onChange={(e) => {
                    setPrimaryId(e.target.value);
                    setSecondaryId("");
                  }}
                  aria-invalid={fieldError("category_id") ? true : undefined}
                  aria-describedby={describedBy("category_id", "product-category")}
                >
                  <option value="">No category</option>
                  {primaries.map((category) => (
                    <option key={category.id} value={category.id}>
                      {categoryLabel(category)}
                    </option>
                  ))}
                </select>
                <p className="aa-hint">
                  Top-level category. A product without a category cannot be
                  published.
                </p>
                {errorText("category_id", "product-category")}
              </div>
              <div className="aa-field">
                <label htmlFor="product-secondary-category">
                  Secondary category
                </label>
                <select
                  id="product-secondary-category"
                  name="secondary_category_id"
                  value={secondaryId}
                  disabled={primaryId === ""}
                  onChange={(e) => setSecondaryId(e.target.value)}
                  aria-invalid={
                    fieldError("secondary_category_id") ? true : undefined
                  }
                  aria-describedby={describedBy(
                    "secondary_category_id",
                    "product-secondary-category",
                  )}
                >
                  <option value="">No secondary category</option>
                  {secondaries.map((category) => (
                    <option key={category.id} value={category.id}>
                      {categoryLabel(category)}
                    </option>
                  ))}
                </select>
                <p className="aa-hint">
                  Optional. A secondary category must belong to the chosen
                  primary category.
                </p>
                {errorText(
                  "secondary_category_id",
                  "product-secondary-category",
                )}
              </div>
              {/* Only when the form can be saved: in read-only mode
                  (role-based or degraded reads) no save can replace
                  the assignment, so the warning would mislead. */}
              {pair.replacedId && canManage ? (
                <p className="aa-notice aa-notice--warning aa-field--full">
                  This product was assigned to{" "}
                  {replacedCategory
                    ? `"${replacedCategory.name}"`
                    : "a category"}{" "}
                  that does not fit the primary + secondary pair. Saving will
                  replace that assignment with the selection above.
                </p>
              ) : null}
              <div className="aa-field aa-field--full">
                <label htmlFor="product-description">Description</label>
                <textarea
                  id="product-description"
                  name="description"
                  defaultValue={initial.description}
                  maxLength={20000}
                  aria-invalid={fieldError("description") ? true : undefined}
                  aria-describedby={describedBy("description", "product-description")}
                />
                {errorText("description", "product-description")}
              </div>
              <div className="aa-field aa-field--full">
                <span id="highlights-label" style={{ fontWeight: 600, fontSize: "0.88rem" }}>
                  Highlights (optional)
                </span>
                <div style={{ display: "grid", gap: "0.5rem" }} role="group" aria-labelledby="highlights-label" aria-describedby={describedBy("highlights", "product-highlights")}>
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
                {highlights.length >= 20 ? (
                  <p className="aa-hint">Maximum 20 highlights.</p>
                ) : null}
                {errorText("highlights", "product-highlights")}
              </div>
              <div className="aa-field aa-field--full">
                <label htmlFor="product-tags">Tags (comma-separated)</label>
                <input
                  id="product-tags"
                  name="tags"
                  defaultValue={initial.tags.join(", ")}
                  placeholder="e.g. cotton, summer, formal"
                  aria-invalid={fieldError("tags") ? true : undefined}
                  aria-describedby={describedBy("tags", "product-tags")}
                />
                <p className="aa-hint">Up to 20 tags.</p>
                {errorText("tags", "product-tags")}
              </div>
            </div>
          </Panel>

          <Panel
            title="Pricing"
            description="Used for the default variant when the product has no variants or sizes below, and for the sizes in the Sizes section. When variants exist, each variant carries its own prices."
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
                  aria-describedby={describedBy("base_price", "product-price")}
                  placeholder="0.00"
                />
                {errorText("base_price", "product-price")}
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
                  aria-describedby={describedBy("base_sale_price", "product-sale-price")}
                  placeholder="Leave empty for no sale"
                />
                {errorText("base_sale_price", "product-sale-price")}
              </div>
              {canViewCosts ? (
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
                    aria-describedby={describedBy("base_cost_price", "product-cost-price")}
                    placeholder="Admin only"
                  />
                  <p className="aa-hint">
                    Cost prices are admin-only and never shown to customers.
                  </p>
                  {errorText("base_cost_price", "product-cost-price")}
                </div>
              ) : null}
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
                  aria-describedby={describedBy("base_stock", "product-stock")}
                />
                <p className="aa-hint">
                  Initial stock for the default variant. Defaults to 1.
                </p>
                {errorText("base_stock", "product-stock")}
              </div>
            </div>
          </Panel>

          <Panel title="Sizes">
            <MainSizesEditor
              fieldError={fieldError("main_sizes")}
              colorError={fieldError("main_color")}
            />
          </Panel>

          <Panel title="Images">
            {mode === "edit" ? (
              <p>
                {imageCount} image{imageCount === 1 ? "" : "s"} attached.{" "}
                <a href="#product-images">Manage images below</a> — uploads,
                ordering and alt text live there so image changes never
                interfere with saving this form.
              </p>
            ) : stagedPanel ? (
              stagedPanel
            ) : (
              <p>
                Save the product first, then add images on its edit page.
                Images are stored privately and shown with signed URLs.
              </p>
            )}
          </Panel>

          <Panel title="Product video">
            <div className="aa-form-grid">
              <div className="aa-field aa-field--full">
                <label htmlFor="product-youtube-video">
                  YouTube link (optional)
                </label>
                <input
                  id="product-youtube-video"
                  name="youtube_video_url"
                  type="url"
                  inputMode="url"
                  defaultValue={savedVideoUrl ?? ""}
                  maxLength={2048}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://www.youtube.com/watch?v=…"
                  style={{ minHeight: 44 }}
                  aria-invalid={fieldError("youtube_video_url") ? true : undefined}
                  aria-describedby={describedBy("youtube_video_url", "product-youtube-video")}
                />
                <p className="aa-hint">
                  Paste a YouTube link for this product. The video appears
                  as an extra slide in the storefront gallery and only
                  loads when a shopper presses play. Leave empty for no
                  video.
                </p>
                {errorText("youtube_video_url", "product-youtube-video")}
              </div>
            </div>
            {savedVideoUrl && initial.youtubeVideoId ? (
              <div style={{ marginTop: "1rem" }}>
                <p>
                  Saved video:{" "}
                  <a href={savedVideoUrl} target="_blank" rel="noreferrer">
                    Watch on YouTube
                  </a>
                </p>
                <div
                  style={{
                    marginTop: "0.5rem",
                    maxWidth: "30rem",
                    aspectRatio: "16 / 9",
                  }}
                >
                  <YoutubeVideoPlayer
                    videoId={initial.youtubeVideoId}
                    title={initial.name || "Product"}
                  />
                </div>
              </div>
            ) : null}
          </Panel>

          <Panel title="Variants">
            <VariantEditor
              initial={variants}
              canViewCosts={canViewCosts}
              fieldError={fieldError("variants")}
            />
          </Panel>

          <Panel title="Badges">
            <div className="aa-check-row" aria-describedby={describedBy("badges", "product-badges")}>
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
            {errorText("badges", "product-badges")}
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
                  aria-invalid={fieldError("seo_title") ? true : undefined}
                  aria-describedby={describedBy("seo_title", "product-seo-title")}
                  onChange={(e) => setSeoTitleLength(e.target.value.length)}
                />
                <p className="aa-hint">{seoTitleLength}/160 characters</p>
                {errorText("seo_title", "product-seo-title")}
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
                  aria-invalid={fieldError("seo_description") ? true : undefined}
                  aria-describedby={describedBy("seo_description", "product-seo-description")}
                  onChange={(e) => setSeoDescriptionLength(e.target.value.length)}
                />
                <p className="aa-hint">
                  {seoDescriptionLength}/320 characters
                </p>
                {errorText("seo_description", "product-seo-description")}
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
                  aria-invalid={fieldError("meta_keywords") ? true : undefined}
                  aria-describedby={describedBy("meta_keywords", "product-meta-keywords")}
                />
                {errorText("meta_keywords", "product-meta-keywords")}
              </div>
            </div>
          </Panel>

          <Panel title="Visibility">
            <RadioOptionGroup
              name="status"
              ariaLabel="Product status"
              describedBy={describedBy("status", "product-status")}
              options={[
                {
                  value: "published",
                  label: "Active",
                  hint: "Published in the admin panel",
                  defaultChecked: initial.status === "published",
                },
                {
                  value: "archived",
                  label: "Inactive",
                  hint: "Archived",
                  defaultChecked: initial.status === "archived",
                },
              ]}
            />
            <p className="aa-muted">{STOREFRONT_NOTE}</p>
            {errorText("status", "product-status")}
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
