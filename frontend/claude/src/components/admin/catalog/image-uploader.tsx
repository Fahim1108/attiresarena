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
  MAX_COMPRESSIBLE_IMAGE_BYTES,
  remainingImageSlots,
  validateImageFileMeta,
} from "@/lib/admin/catalog-variants";
import {
  compressImageFile,
  formatBytes,
} from "./image-compress";
import { Panel } from "../ui";
import styles from "./catalogue-v2.module.css";

type QueuedFile = {
  key: string;
  file: File;
  previewUrl: string;
  status: "queued" | "compressing" | "uploading" | "done" | "failed";
  error?: string;
  /** Size actually uploaded (the compressed size when compressed). */
  uploadedBytes: number | null;
  compressed: boolean;
  note: string | null;
};

/**
 * Product image manager: device file select + drag-drop, per-file honest
 * states (Queued / Compressing / Uploading / Done / Failed with the real
 * error — never a fabricated percentage, because uploads travel through
 * Server Actions and byte progress is unavailable on that transport),
 * main-image selection (position 0), up/down reorder, replace and delete.
 * The auto-compressor (on by default) shrinks photos client-side before
 * upload; see image-compress.ts for the documented defaults and limits.
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
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keyCounter = useRef(0);
  const previewsRef = useRef<Set<string>>(new Set());
  const compressRef = useRef(true);

  useEffect(() => {
    const previews = previewsRef.current;
    return () => {
      for (const url of previews) URL.revokeObjectURL(url);
      previews.clear();
    };
  }, []);

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
      const error = validateImageFileMeta(
        file,
        compressRef.current
          ? { maxBytes: MAX_COMPRESSIBLE_IMAGE_BYTES }
          : {},
      );
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
        uploadedBytes: null,
        compressed: false,
        note: null,
      });
    }
    if (accepted.length > 0) {
      setQueued((current) => [...current, ...accepted]);
    }
    setMessage(problems.length > 0 ? { text: problems.join(" "), kind: "error" } : null);
  };

  const uploadOne = async (key: string) => {
    const item = queued.find((q) => q.key === key);
    if (
      !item ||
      item.status === "compressing" ||
      item.status === "uploading" ||
      item.status === "done"
    )
      return;
    const useCompress = compressRef.current;
    let uploadFile = item.file;
    let compressed = false;
    let note: string | null = null;
    if (useCompress) {
      setQueued((current) =>
        current.map((q) => (q.key === key ? { ...q, status: "compressing" } : q)),
      );
      const result = await compressImageFile(item.file);
      uploadFile = result.file;
      compressed = result.compressed;
      note = result.note;
      const sizeError = validateImageFileMeta(uploadFile);
      if (sizeError) {
        setQueued((current) =>
          current.map((q) =>
            q.key === key
              ? {
                  ...q,
                  status: "failed",
                  error:
                    "Even after compression, this image is over 5 MB. Choose a smaller file under 5 MB.",
                  note,
                }
              : q,
          ),
        );
        return;
      }
    }
    setQueued((current) =>
      current.map((q) =>
        q.key === key ? { ...q, status: "uploading", compressed, note } : q,
      ),
    );
    const form = new FormData();
    form.set("product_id", productId);
    form.set("image", uploadFile);
    form.set("alt", "");
    const result = await uploadCatalogImage(form);
    if (result.ok) {
      revokePreview(item.previewUrl);
      setQueued((current) =>
        current.map((q) =>
          q.key === key
            ? { ...q, status: "done", uploadedBytes: uploadFile.size }
            : q,
        ),
      );
      setMessage({ text: result.message, kind: "info" });
      router.refresh();
    } else {
      setQueued((current) =>
        current.map((q) =>
          q.key === key ? { ...q, status: "failed", error: result.error } : q,
        ),
      );
      setMessage({ text: result.error, kind: "error" });
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
    setMessage(result.ok ? { text: result.message, kind: "info" } : { text: result.error, kind: "error" });
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
    setMessage(result.ok ? { text: result.message, kind: "info" } : { text: result.error, kind: "error" });
    setConfirmDeleteId(null);
    setBusy(false);
    if (result.ok) router.refresh();
  };

  const replace = async (id: string, file: File) => {
    const useCompress = compressRef.current;
    const error = validateImageFileMeta(
      file,
      useCompress ? { maxBytes: MAX_COMPRESSIBLE_IMAGE_BYTES } : {},
    );
    if (error) {
      setMessage({ text: `${file.name}: ${error}`, kind: "error" });
      return;
    }
    setBusy(true);
    let uploadFile = file;
    let sizeNote = "";
    if (useCompress) {
      const result = await compressImageFile(file);
      uploadFile = result.file;
      if (result.compressed) {
        sizeNote = ` Compressed ${formatBytes(file.size)} → ${formatBytes(uploadFile.size)}.`;
      } else if (result.note) {
        sizeNote = ` ${result.note}`;
      }
      const sizeError = validateImageFileMeta(uploadFile);
      if (sizeError) {
        setBusy(false);
        setMessage({
          text: "Even after compression, this image is over 5 MB. Choose a smaller file under 5 MB.",
          kind: "error",
        });
        return;
      }
    }
    const form = new FormData();
    form.set("product_id", productId);
    form.set("media_id", id);
    form.set("image", uploadFile);
    const result = await replaceCatalogImage(form);
    setMessage(
      result.ok
        ? { text: `${result.message}${sizeNote}`, kind: "info" }
        : { text: result.error, kind: "error" },
    );
    setBusy(false);
    if (result.ok) router.refresh();
  };

  const saveAlt = async (id: string) => {
    const alt = altDrafts[id] ?? "";
    setBusy(true);
    const result = await updateCatalogMediaAlt(productId, id, alt);
    setMessage(result.ok ? { text: result.message, kind: "info" } : { text: result.error, kind: "error" });
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
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`aa-notice aa-notice--${message.kind === "error" ? "error" : "info"}`}
          >
            {message.text}
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
          <div className={styles.galleryGrid}>
            {ordered.map((image, index) => (
              <article key={image.id} className={styles.galleryCard}>
                {image.url ? (
                  <img
                    src={image.url}
                    alt={image.altText || "Product photo"}
                    width={240}
                    height={240}
                    className={styles.galleryImage}
                  />
                ) : (
                  <p className="aa-muted">
                    Preview unavailable. Reload to request a fresh private URL.
                  </p>
                )}
                <p className={styles.cardTitle}>
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
                    <div className={styles.actionRow}>
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
                          className="aa-sr-only"
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
              className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ""}`}
              onClick={() => fileInputRef.current?.click()}
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
            >
              <p className={styles.dropzoneTitle}>
                Drag &amp; drop images here or click to browse
              </p>
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
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Choose images
              </button>
              <p className="aa-muted">
                JPEG, PNG or WebP, at most {MAX_PRODUCT_IMAGES} images per
                product. Uploads show Queued, Compressing, Uploading, Done or
                Failed — no percentages, because uploads go through the
                server.
              </p>
            </div>

            {queued.length > 0 ? (
              <div className={styles.queueList}>
                {queued.map((item) => (
                  <div key={item.key} className={styles.queueItem}>
                    {item.status !== "done" ? (
                      <img
                        src={item.previewUrl}
                        alt=""
                        width={64}
                        height={64}
                        className={styles.queueThumb}
                      />
                    ) : null}
                    <div className={styles.queueMain}>
                      <p className={styles.queueName}>{item.file.name}</p>
                      <p className={`aa-muted ${styles.queueStatus}`}>
                        {item.status === "queued"
                          ? "Queued"
                          : item.status === "compressing"
                            ? "Compressing…"
                            : item.status === "uploading"
                              ? "Uploading…"
                              : item.status === "done"
                                ? `Done${item.compressed && item.uploadedBytes !== null ? ` · ${formatBytes(item.file.size)} → ${formatBytes(item.uploadedBytes)} compressed` : item.uploadedBytes !== null ? ` · ${formatBytes(item.uploadedBytes)}` : ""}`
                                : `Failed: ${item.error ?? "Upload failed."}`}
                      </p>
                      {item.note ? (
                        <p className="aa-hint" style={{ margin: 0 }}>
                          {item.note}
                        </p>
                      ) : null}
                    </div>
                    {item.status === "queued" || item.status === "failed" ? (
                      <button
                        type="button"
                        className="aa-secondary"
                        disabled={busy}
                        aria-label={`${item.status === "failed" ? "Retry upload" : "Upload"} ${item.file.name}`}
                        onClick={() => void uploadOne(item.key)}
                      >
                        {item.status === "failed" ? "Retry" : "Upload"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="aa-row-action aa-row-action--danger"
                      aria-label={`Remove ${item.file.name} from upload queue`}
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
