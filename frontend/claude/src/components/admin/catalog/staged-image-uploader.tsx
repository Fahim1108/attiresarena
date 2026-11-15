"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { MAX_PRODUCT_IMAGES } from "@/lib/admin/constants";
import {
  discardStagedCatalogImage,
  stageCatalogImage,
} from "@/lib/admin/catalog-media";
import {
  MAX_COMPRESSIBLE_IMAGE_BYTES,
  remainingImageSlots,
  validateImageFileMeta,
} from "@/lib/admin/catalog-variants";
import {
  COMPRESSOR_DEFAULT_ON,
  compressImageFile,
  formatBytes,
} from "./image-compress";
import { CompressToggle } from "./compress-toggle";
import styles from "./catalogue-v2.module.css";

type StagedItem = {
  key: string;
  name: string;
  previewUrl: string | null;
  status: "compressing" | "uploading" | "staged" | "failed";
  error?: string;
  /** Server storage path once staged; null until then. */
  path: string | null;
  alt: string;
  originalBytes: number;
  uploadedBytes: number | null;
  compressed: boolean;
  note: string | null;
};

/**
 * Pre-upload panel for product creation (owner item 12): images are
 * staged (bytes uploaded to the private bucket) before/during creation
 * and attached to the product when the form is saved. Staged order is
 * the gallery order. Staged images whose product is never saved stay
 * as orphan bytes until a future housekeeping pass.
 *
 * Renders INSIDE the product form: the hidden staged_images_json input
 * carries [{path, alt}] to createCatalogProduct. Honest per-file
 * states only — never fabricated percentages.
 */
export function StagedImageUploader() {
  const [items, setItems] = useState<StagedItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [compress, setCompress] = useState(COMPRESSOR_DEFAULT_ON);
  const [message, setMessage] = useState<{
    text: string;
    kind: "info" | "error";
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keyCounter = useRef(0);
  const previewsRef = useRef<Set<string>>(new Set());
  const compressRef = useRef(compress);
  useEffect(() => {
    compressRef.current = compress;
  }, [compress]);

  useEffect(() => {
    const previews = previewsRef.current;
    return () => {
      for (const url of previews) URL.revokeObjectURL(url);
      previews.clear();
    };
  }, []);

  const patchItem = (key: string, patch: Partial<StagedItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const stageOne = async (key: string, file: File) => {
    const useCompress = compressRef.current;
    if (useCompress) patchItem(key, { status: "compressing" });
    let uploadFile = file;
    let compressed = false;
    let note: string | null = null;
    if (useCompress) {
      const result = await compressImageFile(file);
      uploadFile = result.file;
      compressed = result.compressed;
      note = result.note;
    }
    const sizeError = validateImageFileMeta(uploadFile);
    if (sizeError) {
      patchItem(key, {
        status: "failed",
        error: useCompress
          ? "Even after compression, this image is over 5 MB. Choose a smaller file or turn compression off and retry with a file under 5 MB."
          : sizeError,
        note,
      });
      return;
    }
    patchItem(key, { status: "uploading", compressed, note });
    const form = new FormData();
    form.set("image", uploadFile);
    const result = await stageCatalogImage(form);
    if (result.ok) {
      // Keep the local preview: object URLs stay valid for the session,
      // and attachment uses the storage path, not the signed URL.
      patchItem(key, {
        status: "staged",
        path: result.path,
        uploadedBytes: uploadFile.size,
        compressed,
        note,
      });
    } else {
      patchItem(key, { status: "failed", error: result.error, note });
    }
  };

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const slots = remainingImageSlots(items.length);
    const problems: string[] = [];
    const added: Array<{ key: string; file: File }> = [];
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
      if (added.length >= slots) {
        problems.push(
          `No room for ${file.name}: at most ${MAX_PRODUCT_IMAGES} images per product.`,
        );
        continue;
      }
      keyCounter.current += 1;
      const key = `staged-${keyCounter.current}`;
      const previewUrl = URL.createObjectURL(file);
      previewsRef.current.add(previewUrl);
      added.push({ key, file });
      setItems((current) => [
        ...current,
        {
          key,
          name: file.name,
          previewUrl,
          status: compressRef.current ? "compressing" : "uploading",
          path: null,
          alt: "",
          originalBytes: file.size,
          uploadedBytes: null,
          compressed: false,
          note: null,
        },
      ]);
    }
    setMessage(
      problems.length > 0
        ? { text: problems.join(" "), kind: "error" }
        : null,
    );
    // Stage sequentially: order is preserved and the server is not
    // hammered with parallel large uploads.
    void (async () => {
      for (const { key, file } of added) {
        await stageOne(key, file);
      }
    })();
  };

  const removeItem = async (item: StagedItem) => {
    if (item.previewUrl && previewsRef.current.has(item.previewUrl)) {
      URL.revokeObjectURL(item.previewUrl);
      previewsRef.current.delete(item.previewUrl);
    }
    setItems((current) => current.filter((i) => i.key !== item.key));
    if (item.path) {
      const result = await discardStagedCatalogImage(item.path);
      if (!result.ok) {
        setMessage({ text: result.error, kind: "error" });
      }
    }
  };

  const move = (key: string, delta: -1 | 1) => {
    setItems((current) => {
      const index = current.findIndex((item) => item.key === key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (!moved) return current;
      next.splice(target, 0, moved);
      return next;
    });
  };

  const stagedPayload = items
    .filter((item) => item.status === "staged" && item.path)
    .map((item) => ({ path: item.path as string, alt: item.alt }));

  return (
    <div>
      <input
        type="hidden"
        name="staged_images_json"
        value={JSON.stringify(stagedPayload)}
      />
      <p className="aa-muted">
        Upload photos now and they will be attached when you save the
        product. Staged order becomes the gallery order — the first image
        is the main image.
      </p>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`aa-notice aa-notice--${message.kind === "error" ? "error" : "info"}`}
        >
          {message.text}
        </p>
      ) : null}

      <CompressToggle checked={compress} onChange={setCompress} />

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
          Drag &amp; drop photos here or click to browse
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
          disabled={items.length >= MAX_PRODUCT_IMAGES}
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
          Choose photos
        </button>
        <p className="aa-muted">
          JPEG, PNG or WebP, at most {MAX_PRODUCT_IMAGES} images per
          product. Uploads show Compressing, Uploading, Staged or Failed —
          no percentages, because uploads go through the server.
        </p>
      </div>

      {items.length > 0 ? (
        <div className={styles.queueList}>
          {items.map((item, index) => (
            <div key={item.key} className={styles.queueItem}>
              {item.previewUrl ? (
                <img
                  src={item.previewUrl}
                  alt=""
                  width={64}
                  height={64}
                  className={styles.queueThumb}
                />
              ) : null}
              <div className={styles.queueMain}>
                <p className={styles.queueName}>{item.name}</p>
                <p className={`aa-muted ${styles.queueStatus}`}>
                  {item.status === "compressing"
                    ? "Compressing…"
                    : item.status === "uploading"
                      ? "Uploading…"
                      : item.status === "staged"
                        ? `Staged${item.compressed && item.uploadedBytes !== null ? ` · ${formatBytes(item.originalBytes)} → ${formatBytes(item.uploadedBytes)} compressed` : ` · ${formatBytes(item.uploadedBytes ?? item.originalBytes)}`}`
                        : `Failed: ${item.error ?? "Upload failed."}`}
                  {index === 0 && item.status === "staged"
                    ? " · Main image"
                    : ""}
                </p>
                {item.note ? (
                  <p className="aa-hint" style={{ margin: 0 }}>
                    {item.note}
                  </p>
                ) : null}
              </div>
              {item.status === "staged" ? (
                <>
                  <button
                    type="button"
                    className="aa-secondary"
                    disabled={index === 0}
                    aria-label={`Move ${item.name} earlier`}
                    onClick={() => move(item.key, -1)}
                  >
                    Move earlier
                  </button>
                  <button
                    type="button"
                    className="aa-secondary"
                    disabled={index === items.length - 1}
                    aria-label={`Move ${item.name} later`}
                    onClick={() => move(item.key, 1)}
                  >
                    Move later
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="aa-row-action aa-row-action--danger"
                aria-label={`Remove ${item.name}`}
                onClick={() => void removeItem(item)}
              >
                Remove
              </button>
              {item.status === "staged" ? (
                <label className={`aa-field ${styles.queueAlt}`}>
                  <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>
                    Image description (alt text)
                  </span>
                  <input
                    value={item.alt}
                    maxLength={300}
                    placeholder="Describe the photo for screen readers and search"
                    onChange={(e) =>
                      patchItem(item.key, { alt: e.target.value })
                    }
                  />
                </label>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
