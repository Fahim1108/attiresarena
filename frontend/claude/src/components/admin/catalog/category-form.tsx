"use client";

/* Private signed image URLs are deliberately unoptimized and expire shortly. */
/* eslint-disable @next/next/no-img-element */
import { useActionState, useRef, useState } from "react";
import { slugify } from "@/lib/admin/format";
import {
  saveCategory,
  type CategoryFormState,
  type CategoryWithUrls,
} from "@/lib/admin/catalog-categories";
import { uploadCategoryImage } from "@/lib/admin/catalog-media";
import { validateImageFileMeta } from "@/lib/admin/catalog-variants";
import { SubmitButton } from "../ui-client";

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
          alt=""
          width={200}
          height={120}
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
          onClick={() => inputRef.current?.click()}
        >
          {path ? "Replace image" : "Upload image"}
        </button>
        {path ? (
          <button
            type="button"
            className="aa-row-action aa-row-action--danger"
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
      {status ? <p className="aa-hint">{status}</p> : null}
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

  return (
    <form action={formAction}>
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
          <label htmlFor={`category-name-${category?.id ?? "new"}`}>Name</label>
          <input
            id={`category-name-${category?.id ?? "new"}`}
            name="name"
            value={name}
            maxLength={120}
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
          <label htmlFor={`category-slug-${category?.id ?? "new"}`}>URL slug</label>
          <input
            id={`category-slug-${category?.id ?? "new"}`}
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
          {errorText("slug")}
        </div>
        <div className="aa-field">
          <label htmlFor={`category-parent-${category?.id ?? "new"}`}>
            Parent category
          </label>
          <select
            id={`category-parent-${category?.id ?? "new"}`}
            name="parent_id"
            defaultValue={category?.parent_id ?? ""}
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
          {errorText("parent_id")}
        </div>
        <div className="aa-field">
          <label htmlFor={`category-sort-${category?.id ?? "new"}`}>
            Sort position
          </label>
          <input
            id={`category-sort-${category?.id ?? "new"}`}
            name="sort_position"
            defaultValue={String(category?.sort_position ?? 0)}
            inputMode="numeric"
          />
          <p className="aa-hint">
            Lower numbers sort first among siblings. Use the up/down buttons
            in the list for quick reordering.
          </p>
          {errorText("sort_position")}
        </div>
        <div className="aa-field aa-field--full">
          <label htmlFor={`category-description-${category?.id ?? "new"}`}>
            Description
          </label>
          <textarea
            id={`category-description-${category?.id ?? "new"}`}
            name="description"
            defaultValue={category?.description ?? ""}
            maxLength={2000}
          />
          {errorText("description")}
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
          <label htmlFor={`category-seo-title-${category?.id ?? "new"}`}>
            SEO title
          </label>
          <input
            id={`category-seo-title-${category?.id ?? "new"}`}
            name="seo_title"
            defaultValue={category?.seo_title ?? ""}
            maxLength={160}
          />
          {errorText("seo_title")}
        </div>
        <div className="aa-field">
          <label htmlFor={`category-seo-description-${category?.id ?? "new"}`}>
            SEO description
          </label>
          <textarea
            id={`category-seo-description-${category?.id ?? "new"}`}
            name="seo_description"
            defaultValue={category?.seo_description ?? ""}
            maxLength={320}
          />
          {errorText("seo_description")}
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
