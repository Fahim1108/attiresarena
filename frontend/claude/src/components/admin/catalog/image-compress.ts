/**
 * Client-side image auto-compressor (Admin Panel v2, owner item 12).
 *
 * DECISIONS (documented, owner-visible in the uploader UI):
 * - DEFAULT: ON. The toggle is per-uploader, on by default.
 * - Max long edge 1600px; aspect ratio preserved; NEVER upscaled.
 * - Output is WebP at quality 0.82.
 * - Images that already fit (≤ 5 MB AND long edge ≤ 1600px) pass
 *   through byte-identical — compression only touches oversized files.
 * - If the compressed output is >= the original, the ORIGINAL is kept.
 * - The ORIGINAL IS NOT PRESERVED: only the file returned here is
 *   uploaded. Turning the toggle off uploads originals untouched.
 * - EXIF orientation is honored (createImageBitmap imageOrientation).
 * - Animated images lose animation (first frame only) — accepted:
 *   only JPEG/PNG/WebP stills are supported catalogue formats.
 * - Failures (missing browser APIs, decode errors) fall back to the
 *   original file with a visible note; uploads never block on the
 *   compressor. The server re-validates every uploaded byte.
 *
 * Browser-only APIs (createImageBitmap, Canvas): no vitest coverage —
 * the node test environment has no Canvas. The guards below keep the
 * module import-safe anywhere; behavior is verified in the browser.
 */

import { MAX_IMAGE_BYTES } from "@/lib/admin/catalog-variants";

/** Long-edge cap for compressed images. Smaller images are never upscaled. */
export const COMPRESSOR_MAX_LONG_EDGE = 1600;

/** WebP encoder quality for compressed images. */
export const COMPRESSOR_QUALITY = 0.82;

/** The auto-compressor toggle defaults to ON. */
export const COMPRESSOR_DEFAULT_ON = true;

export interface CompressResult {
  /** The file to upload: compressed output, or the original. */
  file: File;
  /** True when the returned file is a compressed re-encode. */
  compressed: boolean;
  /** User-visible note when compression was unavailable or failed. */
  note: string | null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fallback(
  file: File,
  note: string | null,
): CompressResult {
  return { file, compressed: false, note };
}

export async function compressImageFile(file: File): Promise<CompressResult> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return fallback(
      file,
      "Compression is unavailable in this browser, so the original will be uploaded.",
    );
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = bitmap;
    const longEdge = Math.max(width, height);
    if (longEdge <= COMPRESSOR_MAX_LONG_EDGE && file.size <= MAX_IMAGE_BYTES) {
      // Already fits: pass through byte-identical.
      return fallback(file, null);
    }
    const scale = Math.min(1, COMPRESSOR_MAX_LONG_EDGE / longEdge);
    const outWidth = Math.max(1, Math.round(width * scale));
    const outHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return fallback(
        file,
        "Compression failed, so the original will be uploaded.",
      );
    }
    context.drawImage(bitmap, 0, 0, outWidth, outHeight);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", COMPRESSOR_QUALITY);
    });
    if (!blob) {
      return fallback(
        file,
        "Compression failed, so the original will be uploaded.",
      );
    }
    if (blob.size >= file.size) {
      // Re-encoding did not help: keep the original.
      return fallback(file, null);
    }
    const baseName = file.name.replace(/\.[^.]*$/, "") || "image";
    return {
      file: new File([blob], `${baseName}.webp`, { type: "image/webp" }),
      compressed: true,
      note: null,
    };
  } catch {
    return fallback(
      file,
      "Compression failed, so the original will be uploaded.",
    );
  } finally {
    bitmap?.close();
  }
}
