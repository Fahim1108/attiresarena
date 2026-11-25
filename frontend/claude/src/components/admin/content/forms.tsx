"use client";

import { useActionState, useRef, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import { BANNER_FIT_HEIGHT, BANNER_FIT_MAX_BYTES, BANNER_FIT_WIDTH, fitBannerImage } from "@/components/admin/catalog/banner-image-fit";
import type { AdminActionResult } from "@/lib/admin/authorization";
import type { Banner, ContentBlock } from "@/lib/admin/content";

type FormAction = (
  prev: AdminActionResult | null,
  form: FormData,
) => Promise<AdminActionResult>;

export function AnnouncementForm({
  action,
  initialText,
  initialVisible,
}: {
  action: FormAction;
  initialText: string;
  initialVisible: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field aa-field--full">
          <label htmlFor="announcement-text">Announcement text</label>
          <input
            id="announcement-text"
            name="text"
            defaultValue={initialText}
            maxLength={200}
            required
          />
          <p className="aa-hint">Shown in the announcement bar on desktop and tablet.</p>
        </div>
        <div className="aa-field aa-field--full">
          <label>
            <input type="checkbox" name="visible" defaultChecked={initialVisible} />{" "}
            Show the announcement bar
          </label>
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton>Save announcement bar</SubmitButton>
      </div>
    </form>
  );
}

export function ContentBlockForm({
  action,
  block,
  slug,
  slugLocked,
}: {
  action: FormAction;
  block?: ContentBlock;
  slug: string;
  slugLocked: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <input type="hidden" name="slug" value={slug} />
      <input
        type="hidden"
        name="image_storage_path"
        value={block?.image_storage_path ?? ""}
      />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor={`slug-${slug}`}>Slug</label>
          <input id={`slug-${slug}`} value={slug} disabled />
          <p className="aa-hint">
            {slugLocked
              ? "This slug matches a storefront page and cannot change."
              : "Lowercase letters, numbers and hyphens."}
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor={`title-${slug}`}>Title</label>
          <input
            id={`title-${slug}`}
            name="title"
            defaultValue={block?.title ?? ""}
            maxLength={200}
          />
        </div>
        <div className="aa-field aa-field--full">
          <label htmlFor={`body-${slug}`}>Body text</label>
          <textarea
            id={`body-${slug}`}
            name="body"
            defaultValue={block?.body ?? ""}
            maxLength={20000}
            rows={10}
          />
          <p className="aa-hint">
            Blank lines separate paragraphs. Leave empty to keep the static page text.
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor={`sort-${slug}`}>Sort position</label>
          <input
            id={`sort-${slug}`}
            name="sort_position"
            type="number"
            min={0}
            max={9999}
            defaultValue={block?.sort_position ?? 0}
          />
        </div>
        <div className="aa-field">
          <label>
            <input
              type="checkbox"
              name="visible"
              defaultChecked={block?.visible ?? true}
            />{" "}
            Visible on the storefront
          </label>
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton>Save content block</SubmitButton>
      </div>
    </form>
  );
}

export function BannerForm({
  action,
  banner,
  defaultPlacement,
}: {
  action: FormAction;
  banner?: Banner;
  defaultPlacement: "hero" | "promo";
}) {
  const [state, formAction] = useActionState(action, null);
  // Client feedback item 2: the chosen image is fitted to the 16:9
  // banner frame before submit, so a wrong-size upload still matches.
  // The input's files are replaced with the fitted file, so the server
  // action receives exactly what the admin sees. Submits are blocked
  // while a fit is running, so the original can never slip through.
  const [fitNote, setFitNote] = useState<string | null>(null);
  const [fitting, setFitting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  async function onImageChange(files: FileList | null) {
    const file = files?.[0];
    const input = imageInputRef.current;
    if (!file || !input) return;
    setFitting(true);
    try {
      const fitted = await fitBannerImage(file);
      if (fitted.fitted) {
        const transfer = new DataTransfer();
        transfer.items.add(fitted.file);
        input.files = transfer.files;
      }
      setFitNote(fitted.note);
    } finally {
      setFitting(false);
    }
  }
  return (
    <form
      action={formAction}
      encType="multipart/form-data"
      onSubmit={(e) => {
        if (fitting) e.preventDefault();
      }}
    >
      <FormMessage state={state} />
      <input type="hidden" name="id" value={banner?.id ?? ""} />
      <input
        type="hidden"
        name="existing_image_storage_path"
        value={banner?.image_storage_path ?? ""}
      />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor={banner ? `banner-title-${banner.id}` : "banner-title"}>
            Title
          </label>
          <input
            id={banner ? `banner-title-${banner.id}` : "banner-title"}
            name="title"
            defaultValue={banner?.title ?? ""}
            maxLength={200}
            required
          />
        </div>
        <div className="aa-field">
          <label htmlFor={banner ? `banner-subtitle-${banner.id}` : "banner-subtitle"}>
            Subtitle
          </label>
          <input
            id={banner ? `banner-subtitle-${banner.id}` : "banner-subtitle"}
            name="subtitle"
            defaultValue={banner?.subtitle ?? ""}
            maxLength={300}
          />
        </div>
        <div className="aa-field">
          <label htmlFor={banner ? `banner-image-${banner.id}` : "banner-image"}>
            Image — 16:9, {BANNER_FIT_WIDTH}×{BANNER_FIT_HEIGHT} (JPEG, PNG or WebP, up to {Math.round(BANNER_FIT_MAX_BYTES / 1024)} KiB)
          </label>
          <input
            ref={imageInputRef}
            id={banner ? `banner-image-${banner.id}` : "banner-image"}
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required={!banner}
            onChange={(e) => {
              void onImageChange(e.target.files);
            }}
          />
          <p className="aa-hint">
            Any image is fitted to {BANNER_FIT_WIDTH}×{BANNER_FIT_HEIGHT} (16:9) automatically — nothing is cut off.
            {fitting ? " Fitting…" : ""}
          </p>
          {fitNote ? <p className="aa-hint">{fitNote}</p> : null}
          {banner?.imageUrl ? (
            <p className="aa-hint">
              Current image is kept when no new file is chosen.
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={banner.imageUrl}
                alt="Current banner image"
                width={160}
                height={90}
                loading="lazy"
                style={{ display: "block", marginTop: "0.5rem", objectFit: "cover" }}
              />
            </p>
          ) : null}
        </div>
        <div className="aa-field">
          <label htmlFor={banner ? `banner-link-${banner.id}` : "banner-link"}>
            Link (site path or http(s) URL)
          </label>
          <input
            id={banner ? `banner-link-${banner.id}` : "banner-link"}
            name="link_url"
            inputMode="url"
            spellCheck={false}
            defaultValue={banner?.link_url ?? ""}
            maxLength={1000}
            placeholder="/shop"
          />
        </div>
        <div className="aa-field">
          <label htmlFor={banner ? `banner-placement-${banner.id}` : "banner-placement"}>
            Placement
          </label>
          <select
            id={banner ? `banner-placement-${banner.id}` : "banner-placement"}
            name="placement"
            defaultValue={banner?.placement ?? defaultPlacement}
          >
            <option value="hero">Hero</option>
            <option value="promo">Promotional</option>
          </select>
        </div>
        <div className="aa-field">
          <label htmlFor={banner ? `banner-sort-${banner.id}` : "banner-sort"}>
            Sort position
          </label>
          <input
            id={banner ? `banner-sort-${banner.id}` : "banner-sort"}
            name="sort_position"
            type="number"
            min={0}
            max={9999}
            defaultValue={banner?.sort_position ?? 0}
          />
        </div>
        <div className="aa-field">
          <label>
            <input
              type="checkbox"
              name="visible"
              defaultChecked={banner?.visible ?? true}
            />{" "}
            Visible on the storefront
          </label>
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton>{banner ? "Save banner" : "Add banner"}</SubmitButton>
      </div>
    </form>
  );
}
