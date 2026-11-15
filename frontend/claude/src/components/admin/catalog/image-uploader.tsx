"use client";

/* Private signed image URLs are deliberately unoptimized and expire shortly. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_PRODUCT_IMAGES } from "@/lib/admin/constants";
import {
  removeCatalogMedia,
  reorderCatalogMedia,
  replaceCatalogImage,
  updateCatalogMediaAlt,
  uploadCatalogImage,
  type CatalogMediaItem,
} from "@/lib/admin/catalog-media";
import {
  remainingImageSlots,
  validateImageFileMeta,
} from "@/lib/admin/catalog-variants";
import { Panel } from "../ui";

type QueuedFile = {
  key: string;
  file: File;
  previewUrl: string;
  status: "queued" | "uploading" | "done" | "failed";
  error?: string;
};

/**
 * Product image manager: device file select + drag-drop, per-file honest
 * states (Queued / Uploading / Done / Failed with the real error — never
 * a fabricated percentage, because uploads travel through Server Actions
 * and byte progress is unavailable on that transport), main-image
 * selection (position 0), up/down reorder, replace and delete.
 */
export function ImageUploader({
  productId,
  images,
  canManage,
}: {
  productId: string;
  images: CatalogMediaItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [queued, setQueued] = useState<QueuedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keyCounter = useRef(0);
  const previewsRef = useRef<Set<string>>(new Set());

  useEffect(
    () => () => {
      for (const url of previewsRef.current) URL.revokeObjectURL(url);
      previewsRef.current.clear();
    },
    [],
  );

  const revokePreview = (url: string) => {
    URL.revokeObjectURL(url);
    previewsRef.current.delete(url);
  };

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const slots = remainingImageSlots(
      images.length + queued.filter((q) => q.status !== "failed").length,
    );
    const accepted: QueuedFile[] = [];
    const problems: string[] = [];
    for (const file of list) {
      const error = validateImageFileMeta(file);
      if (error) {
        problems.push(`${file.name}: ${error}`);
        continue;
      }
      if (accepted.length >= slots) {
        problems.push(
          `No room for ${file.name}: at most ${MAX_PRODUCT_IMAGES} images per product.`,
        );
        continue;
      }
      keyCounter.current += 1;
      const previewUrl = URL.createObjectURL(file);
      previewsRef.current.add(previewUrl);
      accepted.push({
        key: `q-${keyCounter.current}`,
        file,
        previewUrl,
        status: "queued",
      });
    }
    if (accepted.length > 0) {
      setQueued((current) => [...current, ...accepted]);
    }
    setMessage(problems.length > 0 ? problems.join(" ") : null);
  };

  const uploadOne = async (key: string) => {
    const item = queued.find((q) => q.key === key);
    if (!item || item.status === "uploading" || item.status === "done") return;
    setQueued((current) =>
      current.map((q) => (q.key === key ? { ...q, status: "uploading" } : q)),
    );
    const form = new FormData();
    form.set("product_id", productId);
    form.set("image", item.file);
    form.set("alt", "");
    const result = await uploadCatalogImage(form);
    if (result.ok) {
      revokePreview(item.previewUrl);
      setQueued((current) =>
        current.map((q) => (q.key === key ? { ...q, status: "done" } : q)),
      );
      setMessage(result.message);
      router.refresh();
    } else {
      setQueued((current) =>
        current.map((q) =>
          q.key === key ? { ...q, status: "failed", error: result.error } : q,
        ),
      );
      setMessage(result.error);
    }
  };

  const uploadAll = async () => {
    setBusy(true);
    try {
      const pending = queued.filter((q) => q.status === "queued" || q.status === "failed");
      for (const item of pending) {
        // Re-read state through the same sequential path as uploadOne.
        await uploadOne(item.key);
      }
    } finally {
      setBusy(false);
      router.refresh();
    }
  };

  const reorder = async (orderedIds: string[]) => {
    setBusy(true);
    setMessage(null);
    const result = await reorderCatalogMedia(productId, orderedIds);
    setMessage(result.ok ? result.message : result.error);
    setBusy(false);
    if (result.ok) router.refresh();
  };

  const move = (id: string, delta: -1 | 1) => {
    const index = images.findIndex((image) => image.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= images.length) return;
    const ids = images.map((image) => image.id);
    const current = ids[index];
    const other = ids[target];
    if (current === undefined || other === undefined) return;
    ids[index] = other;
    ids[target] = current;
    void reorder(ids);
  };

  const makeMain = (id: string) => {
    const ids = [id, ...images.filter((image) => image.id !== id).map((image) => image.id)];
    void reorder(ids);
  };

  const remove = async (id: string) => {
    setBusy(true);
    const result = await removeCatalogMedia(productId, id);
    setMessage(result.ok ? result.message : result.error);
    setConfirmDeleteId(null);
    setBusy(false);
    if (result.ok) router.refresh();
  };

  const replace = async (id: string, file: File) => {
    const error = validateImageFileMeta(file);
    if (error) {
      setMessage(`${file.name}: ${error}`);
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("product_id", productId);
    form.set("media_id", id);
    form.set("image", file);
    const result = await replaceCatalogImage(form);
    setMessage(result.ok ? result.message : result.error);
    setBusy(false);
    if (result.ok) router.refresh();
  };

  const saveAlt = async (id: string) => {
    const alt = altDrafts[id] ?? "";
    setBusy(true);
    const result = await updateCatalogMediaAlt(productId, id, alt);
    setMessage(result.ok ? result.message : result.error);
    setBusy(false);
    if (result.ok) router.refresh();
  };

  const ordered = [...images].sort((a, b) => a.position - b.position);

  return (
    <section id="product-images" aria-label="Product images">
      <Panel
        title={`Images (${images.length}/${MAX_PRODUCT_IMAGES})`}
        description="Images are stored privately in Supabase Storage and shown with short-lived signed URLs. The first image is the main image."
      >
        {message ? (
          <p role="status" className="aa-notice aa-notice--info">
            {message}
          </p>
        ) : null}
        {!canManage ? (
          <p className="aa-notice aa-notice--warning">
            Your role can view images but cannot change them.
          </p>
        ) : null}

        {ordered.length === 0 ? (
          <p className="aa-muted">No images attached yet.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))",
              gap: "1rem",
            }}
          >
            {ordered.map((image, index) => (
              <article
                key={image.id}
                style={{
                  border: "1px solid rgb(var(--aa-border))",
                  borderRadius: "var(--aa-radius-card)",
                  padding: "0.75rem",
                  minWidth: 0,
                }}
              >
                {image.url ? (
                  <img
                    src={image.url}
                    alt={image.altText || "Product photo"}
                    width={240}
                    height={240}
                    style={{
                      objectFit: "contain",
                      maxWidth: "100%",
                      height: "auto",
                      background: "#f7f4f4",
                      borderRadius: "var(--aa-radius-card)",
                    }}
                  />
                ) : (
                  <p className="aa-muted">
                    Preview unavailable. Reload to request a fresh private URL.
                  </p>
                )}
                <p style={{ margin: "0.5rem 0" }}>
                  {index === 0 ? (
                    <strong>Main image</strong>
                  ) : (
                    `Image ${index + 1}`
                  )}
                </p>
                {canManage ? (
                  <>
                    <label className="aa-field" style={{ marginBottom: "0.5rem" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>
                        Image description (alt text)
                      </span>
                      <input
                        value={altDrafts[image.id] ?? image.altText}
                        maxLength={300}
                        onChange={(e) =>
                          setAltDrafts((current) => ({
                            ...current,
                            [image.id]: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.5rem",
                      }}
                    >
                      <button
                        type="button"
                        className="aa-secondary"
                        disabled={busy}
                        onClick={() => void saveAlt(image.id)}
                      >
                        Save description
                      </button>
                      {index > 0 ? (
                        <>
                          <button
                            type="button"
                            className="aa-secondary"
                            disabled={busy}
                            onClick={() => move(image.id, -1)}
                          >
                            Move earlier
                          </button>
                          <button
                            type="button"
                            className="aa-secondary"
                            disabled={busy}
                            onClick={() => makeMain(image.id)}
                          >
                            Make main image
                          </button>
                        </>
                      ) : null}
                      {index < ordered.length - 1 ? (
                        <button
                          type="button"
                          className="aa-secondary"
                          disabled={busy}
                          onClick={() => move(image.id, 1)}
                        >
                          Move later
                        </button>
                      ) : null}
                      <label className="aa-secondary" style={{ cursor: "pointer" }}>
                        Replace
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void replace(image.id, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {confirmDeleteId === image.id ? (
                        <>
                          <button
                            type="button"
                            className="aa-button"
                            data-danger
                            disabled={busy}
                            onClick={() => void remove(image.id)}
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
                          onClick={() => setConfirmDeleteId(image.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="aa-muted">{image.altText || "No description."}</p>
                )}
              </article>
            ))}
          </div>
        )}

        {canManage ? (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
              style={{
                border: `2px dashed ${dragOver ? "rgb(var(--aa-primary))" : "rgb(var(--aa-border))"}`,
                borderRadius: "var(--aa-radius-card)",
                padding: "1.25rem",
                marginTop: "1rem",
                textAlign: "center",
              }}
            >
              <p>Drag images here, or choose files from your device.</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files ?? []);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="aa-secondary"
                disabled={images.length >= MAX_PRODUCT_IMAGES}
                onClick={() => fileInputRef.current?.click()}
              >
                Choose images
              </button>
              <p className="aa-muted">
                JPEG, PNG or WebP, up to 5 MB each, at most{" "}
                {MAX_PRODUCT_IMAGES} images per product. Uploads show Queued,
                Uploading, Done or Failed — no percentages, because uploads go
                through the server.
              </p>
            </div>

            {queued.length > 0 ? (
              <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
                {queued.map((item) => (
                  <div
                    key={item.key}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.75rem",
                      alignItems: "center",
                      border: "1px solid rgb(var(--aa-border))",
                      borderRadius: "var(--aa-radius-card)",
                      padding: "0.6rem",
                    }}
                  >
                    {item.status !== "done" ? (
                      <img
                        src={item.previewUrl}
                        alt=""
                        width={64}
                        height={64}
                        style={{ objectFit: "cover", borderRadius: 4 }}
                      />
                    ) : null}
                    <div style={{ minWidth: 0, flex: "1 1 12rem" }}>
                      <p style={{ margin: 0, overflowWrap: "anywhere" }}>
                        {item.file.name}
                      </p>
                      <p className="aa-muted" style={{ margin: 0 }}>
                        {item.status === "queued"
                          ? "Queued"
                          : item.status === "uploading"
                            ? "Uploading…"
                            : item.status === "done"
                              ? "Done"
                              : `Failed: ${item.error ?? "Upload failed."}`}
                      </p>
                    </div>
                    {item.status === "queued" || item.status === "failed" ? (
                      <button
                        type="button"
                        className="aa-secondary"
                        disabled={busy}
                        onClick={() => void uploadOne(item.key)}
                      >
                        {item.status === "failed" ? "Retry" : "Upload"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="aa-row-action aa-row-action--danger"
                      onClick={() => {
                        revokePreview(item.previewUrl);
                        setQueued((current) =>
                          current.filter((q) => q.key !== item.key),
                        );
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="aa-form-actions">
                  <button
                    type="button"
                    className="aa-button"
                    disabled={
                      busy ||
                      !queued.some(
                        (q) => q.status === "queued" || q.status === "failed",
                      )
                    }
                    onClick={() => void uploadAll()}
                  >
                    {busy ? "Uploading…" : "Upload all queued"}
                  </button>
                  <button
                    type="button"
                    className="aa-secondary"
                    onClick={() => {
                      for (const item of queued) {
                        revokePreview(item.previewUrl);
                      }
                      setQueued([]);
                    }}
                  >
                    Clear list
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </Panel>
    </section>
  );
}
