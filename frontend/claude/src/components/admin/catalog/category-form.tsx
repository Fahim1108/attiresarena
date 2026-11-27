"use client";

/* Private signed image URLs are deliberately unoptimized and expire shortly. */
/* eslint-disable @next/next/no-img-element */
import { useActionState, useEffect, useRef, useState } from "react";
import { slugify } from "@/lib/admin/format";
import {
  saveCategory,
  type CategoryFormState,
  type CategoryWithUrls,
} from "@/lib/admin/catalog-categories";
import { uploadCategoryImage } from "@/lib/admin/catalog-media";
import {
  MAX_COMPRESSIBLE_IMAGE_BYTES,
  validateImageFileMeta,
  type CategoryLevelChoice,
} from "@/lib/admin/catalog-variants";
import {
  compressImageFile,
  formatBytes,
} from "./image-compress";
import { RadioOptionGroup } from "./radio-option-cards";
import { focusFirstInvalid, SubmitButton } from "../ui-client";
import type { CategoryParentOption } from "@/lib/admin/catalog-variants";

export type { CategoryParentOption } from "@/lib/admin/catalog-variants";

function CategoryImageField({
  fieldName,
  label,
  currentPath,
  currentUrl,
  compress,
}: {
  fieldName: "image_storage_path" | "banner_storage_path";
  label: string;
  currentPath: string | null;
  currentUrl: string | null;
  /** Auto-compression is always on (owner decision 2026-11-27) — no toggle. */
  compress: boolean;
}) {
  const [path, setPath] = useState(currentPath ?? "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    const error = validateImageFileMeta(
      file,
      compress ? { maxBytes: MAX_COMPRESSIBLE_IMAGE_BYTES } : {},
    );
    if (error) {
      setStatus(error);
      return;
    }
    setUploading(true);
    let uploadFile = file;
    let sizeNote = "";
    if (compress) {
      setStatus("Compressing…");
      const result = await compressImageFile(file);
      uploadFile = result.file;
      if (result.compressed) {
        sizeNote = ` Compressed ${formatBytes(file.size)} → ${formatBytes(uploadFile.size)}.`;
      } else if (result.note) {
        sizeNote = ` ${result.note}`;
      }
      const sizeError = validateImageFileMeta(uploadFile);
      if (sizeError) {
        setUploading(false);
        setStatus(
          "Even after compression, this image is over 5 MB. Choose a smaller file under 5 MB.",
        );
        return;
      }
    }
    setStatus("Uploading…");
    const form = new FormData();
    form.set("image", uploadFile);
    const result = await uploadCategoryImage(form);
    setUploading(false);
    if (result.ok) {
      setPath(result.path);
      setPreviewUrl(result.url);
      setStatus(`Uploaded.${sizeNote} Save the category to keep it.`);
    } else {
      setStatus(result.error);
    }
  };

  return (
    <div className="aa-field">
      <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{label}</span>
      <input type="hidden" name={fieldName} value={path} />
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={`${label} preview`}
          width={200}
          height={120}
          loading="lazy"
          style={{
            objectFit: "cover",
            maxWidth: "100%",
            height: "auto",
            borderRadius: "var(--admin-radius-card)",
            border: "1px solid rgb(var(--admin-border))",
          }}
        />
      ) : path ? (
        <p className="aa-muted">
          An image is saved. Reload the page for a fresh preview link.
        </p>
      ) : (
        <p className="aa-muted">No image.</p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="aa-secondary"
          disabled={uploading}
          aria-label={`${label}: ${path ? "replace image" : "upload image"}`}
          onClick={() => inputRef.current?.click()}
        >
          {path ? "Replace image" : "Upload image"}
        </button>
        {path ? (
          <button
            type="button"
            className="aa-row-action aa-row-action--danger"
            aria-label={`${label}: remove image`}
            onClick={() => {
              setPath("");
              setPreviewUrl(null);
              setStatus("Image will be removed when you save.");
            }}
          >
            Remove image
          </button>
        ) : null}
      </div>
      {status ? <p role="status" className="aa-hint">{status}</p> : null}
      <p className="aa-hint">JPEG, PNG or WebP, up to 5 MB.</p>
    </div>
  );
}

export function CategoryForm({
  category,
  parentOptions,
  depth,
}: {
  category: CategoryWithUrls | null;
  parentOptions: CategoryParentOption[];
  /**
   * Tree depth of the edited category (1 = primary, 2 = secondary,
   * 3 = sub-category). Omitted for the create form, which starts at
   * Primary and never offers Sub-category.
   */
  depth?: number;
}) {
  const [state, formAction] = useActionState<CategoryFormState, FormData>(
    saveCategory,
    { ok: false },
  );
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(category));
  const [seoTitleLength, setSeoTitleLength] = useState(
    category?.seo_title?.length ?? 0,
  );
  const [seoDescriptionLength, setSeoDescriptionLength] = useState(
    category?.seo_description?.length ?? 0,
  );
  const isCreate = category === null;
  const [level, setLevel] = useState<CategoryLevelChoice>(
    depth === 2 ? "secondary" : depth === 3 ? "sub" : "primary",
  );
  const [parentId, setParentId] = useState(category?.parent_id ?? "");
  const primaries = parentOptions.filter((option) => option.depth === 1);
  const subParents = parentOptions.filter((option) => option.depth <= 2);
  const parentDisabled =
    level === "primary" || (level === "secondary" && primaries.length === 0);
  const onLevelChange = (next: CategoryLevelChoice) => {
    setLevel(next);
    if (next === "primary") {
      setParentId("");
    } else if (next === "secondary") {
      setParentId(primaries[0]?.id ?? "");
    } else {
      const current = parentOptions.find((option) => option.id === parentId);
      if (!current || current.depth > 2) setParentId("");
    }
  };
  const idSuffix = category?.id ?? "new";
  const inputId = (field: string) => `category-${field}-${idSuffix}`;
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.fieldErrors && Object.keys(state.fieldErrors).length > 0) {
      focusFirstInvalid(formRef.current);
    }
  }, [state]);

  const fieldError = (key: string) => state.fieldErrors?.[key];
  // Inline errors are announced through aria-describedby on their field
  // (plus focus moves to the first invalid field), not assertive alerts.
  const errorText = (key: string, field: string) => {
    const message = fieldError(key);
    if (!message) return null;
    return (
      <p id={`${inputId(field)}-error`} className="aa-hint aa-field-error">
        {message}
      </p>
    );
  };
  const describedBy = (key: string, field: string) =>
    fieldError(key) ? `${inputId(field)}-error` : undefined;

  return (
    <form action={formAction} ref={formRef}>
      {category ? (
        <>
          <input type="hidden" name="id" value={category.id} />
          <input type="hidden" name="updated_at" value={category.updated_at} />
          <input
            type="hidden"
            name="old_image_storage_path"
            value={category.image_storage_path ?? ""}
          />
          <input
            type="hidden"
            name="old_banner_storage_path"
            value={category.banner_storage_path ?? ""}
          />
        </>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="aa-notice aa-notice--success">
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="aa-notice aa-notice--error">
          {state.error}
        </p>
      ) : null}
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor={inputId("name")}>Name</label>
          <input
            id={inputId("name")}
            name="name"
            value={name}
            maxLength={120}
            aria-invalid={fieldError("name") ? true : undefined}
            aria-describedby={describedBy("name", "name")}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(slugify(e.target.value));
            }}
            required
          />
          {errorText("name", "name")}
        </div>
        <div className="aa-field">
          <label htmlFor={inputId("slug")}>URL slug</label>
          <input
            id={inputId("slug")}
            name="slug"
            value={slug}
            maxLength={160}
            aria-invalid={fieldError("slug") ? true : undefined}
            aria-describedby={describedBy("slug", "slug")}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugEdited(true);
            }}
            required
          />
          {errorText("slug", "slug")}
        </div>
        <div className="aa-field">
          <span
            id={inputId("level-label")}
            style={{ fontWeight: 600, fontSize: "0.88rem" }}
          >
            Category level
          </span>
          <input type="hidden" name="category_level" value={level} />
          <RadioOptionGroup
            name={`category_level_choice_${idSuffix}`}
            ariaLabelledBy={inputId("level-label")}
            describedBy={describedBy("category_level", "level")}
            options={[
              {
                value: "primary",
                label: "Primary",
                hint: "Top level",
                checked: level === "primary",
                onChange: () => onLevelChange("primary"),
              },
              {
                value: "secondary",
                label: "Secondary",
                hint: "Under a primary",
                checked: level === "secondary",
                onChange: () => onLevelChange("secondary"),
              },
              ...(isCreate
                ? []
                : [
                    {
                      value: "sub",
                      label: "Sub-category",
                      hint: "Third level",
                      checked: level === "sub",
                      onChange: () => onLevelChange("sub"),
                    },
                  ]),
            ]}
          />
          <p className="aa-hint">
            Primary categories sit at the top level. Secondary categories
            must belong to a primary. Sub-categories are legacy third-level
            entries and cannot be created here.
          </p>
          {errorText("category_level", "level")}
        </div>
        <div className="aa-field">
          <label htmlFor={inputId("parent")}>Parent category</label>
          {parentDisabled ? (
            <input type="hidden" name="parent_id" value="" />
          ) : null}
          <select
            id={inputId("parent")}
            name="parent_id"
            value={level === "primary" ? "" : parentId}
            disabled={parentDisabled}
            onChange={(e) => setParentId(e.target.value)}
            aria-invalid={fieldError("parent_id") ? true : undefined}
            aria-describedby={describedBy("parent_id", "parent")}
          >
            {level === "primary" ? (
              <option value="">No parent (top level)</option>
            ) : level === "secondary" ? (
              primaries.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))
            ) : (
              <>
                <option value="">No parent (promote to top level)</option>
                {subParents.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </>
            )}
          </select>
          <p className="aa-hint">
            {level === "primary"
              ? "Primary categories have no parent."
              : level === "secondary"
                ? primaries.length === 0
                  ? "Create a primary category first — a secondary category needs a primary parent."
                  : "A secondary category must belong to a primary category."
                : "Categories may be at most 3 levels deep. A category cannot be moved under itself or one of its children."}
          </p>
          {errorText("parent_id", "parent")}
        </div>
        <div className="aa-field">
          <label htmlFor={inputId("sort")}>
            Sort position
          </label>
          <input
            id={inputId("sort")}
            name="sort_position"
            defaultValue={String(category?.sort_position ?? 0)}
            inputMode="numeric"
            aria-invalid={fieldError("sort_position") ? true : undefined}
            aria-describedby={describedBy("sort_position", "sort")}
          />
          <p className="aa-hint">
            Lower numbers sort first among siblings. Use the up/down buttons
            in the list for quick reordering.
          </p>
          {errorText("sort_position", "sort")}
        </div>
        <div className="aa-field aa-field--full">
          <label htmlFor={inputId("description")}>
            Description
          </label>
          <textarea
            id={inputId("description")}
            name="description"
            defaultValue={category?.description ?? ""}
            maxLength={2000}
            aria-invalid={fieldError("description") ? true : undefined}
            aria-describedby={describedBy("description", "description")}
          />
          {errorText("description", "description")}
        </div>
        <div className="aa-field aa-field--full">
        </div>
        <CategoryImageField
          fieldName="image_storage_path"
          label="Category image"
          currentPath={category?.image_storage_path ?? null}
          currentUrl={category?.imageUrl ?? null}
          compress={true}
        />
        <CategoryImageField
          fieldName="banner_storage_path"
          label="Banner image"
          currentPath={category?.banner_storage_path ?? null}
          currentUrl={category?.bannerUrl ?? null}
          compress={true}
        />
        <div className="aa-field">
          <label htmlFor={inputId("seo-title")}>
            SEO title
          </label>
          <input
            id={inputId("seo-title")}
            name="seo_title"
            defaultValue={category?.seo_title ?? ""}
            maxLength={160}
            aria-invalid={fieldError("seo_title") ? true : undefined}
            aria-describedby={describedBy("seo_title", "seo-title")}
            onChange={(e) => setSeoTitleLength(e.target.value.length)}
          />
          <p className="aa-hint">{seoTitleLength}/160 characters</p>
          {errorText("seo_title", "seo-title")}
        </div>
        <div className="aa-field">
          <label htmlFor={inputId("seo-description")}>
            SEO description
          </label>
          <textarea
            id={inputId("seo-description")}
            name="seo_description"
            defaultValue={category?.seo_description ?? ""}
            maxLength={320}
            aria-invalid={fieldError("seo_description") ? true : undefined}
            aria-describedby={describedBy("seo_description", "seo-description")}
            onChange={(e) => setSeoDescriptionLength(e.target.value.length)}
          />
          <p className="aa-hint">{seoDescriptionLength}/320 characters</p>
          {errorText("seo_description", "seo-description")}
        </div>
        <div className="aa-field">
          <label
            style={{ display: "inline-flex", gap: "0.45rem", alignItems: "center" }}
          >
            <input
              type="checkbox"
              name="published"
              defaultChecked={category?.published ?? false}
            />
            Visible (published)
          </label>
          <p className="aa-hint">
            Visibility here is the admin record state; storefront category
            display follows existing publication behaviour.
          </p>
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton pendingLabel="Saving…">
          {category ? "Save category" : "Create category"}
        </SubmitButton>
      </div>
    </form>
  );
}
