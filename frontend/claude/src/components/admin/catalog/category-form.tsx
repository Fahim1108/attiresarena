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
import { validateImageFileMeta } from "@/lib/admin/catalog-variants";
import { focusFirstInvalid, SubmitButton } from "../ui-client";

export interface CategoryParentOption {
  id: string;
  label: string;
}

function CategoryImageField({
  fieldName,
  label,
  currentPath,
  currentUrl,
}: {
  fieldName: "image_storage_path" | "banner_storage_path";
  label: string;
  currentPath: string | null;
  currentUrl: string | null;
}) {
  const [path, setPath] = useState(currentPath ?? "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    const error = validateImageFileMeta(file);
    if (error) {
      setStatus(error);
      return;
    }
    setUploading(true);
    setStatus("Uploading…");
    const form = new FormData();
    form.set("image", file);
    const result = await uploadCategoryImage(form);
    setUploading(false);
    if (result.ok) {
      setPath(result.path);
      setPreviewUrl(result.url);
      setStatus("Uploaded. Save the category to keep it.");
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
            borderRadius: "var(--aa-radius-card)",
            border: "1px solid rgb(var(--aa-border))",
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
}: {
  category: CategoryWithUrls | null;
  parentOptions: CategoryParentOption[];
}) {
  const [state, formAction] = useActionState<CategoryFormState, FormData>(
    saveCategory,
    { ok: false },
  );
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(category));
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
      <p id={`${inputId(field)}-error`} className="aa-hint" style={{ color: "#7a1010" }}>
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
          <label htmlFor={inputId("parent")}>
            Parent category
          </label>
          <select
            id={inputId("parent")}
            name="parent_id"
            defaultValue={category?.parent_id ?? ""}
            aria-invalid={fieldError("parent_id") ? true : undefined}
            aria-describedby={describedBy("parent_id", "parent")}
          >
            <option value="">No parent (top level)</option>
            {parentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="aa-hint">
            Categories may be at most 3 levels deep. A category cannot be
            moved under itself or one of its children.
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
        <CategoryImageField
          fieldName="image_storage_path"
          label="Category image"
          currentPath={category?.image_storage_path ?? null}
          currentUrl={category?.imageUrl ?? null}
        />
        <CategoryImageField
          fieldName="banner_storage_path"
          label="Banner image"
          currentPath={category?.banner_storage_path ?? null}
          currentUrl={category?.bannerUrl ?? null}
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
          />
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
          />
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
