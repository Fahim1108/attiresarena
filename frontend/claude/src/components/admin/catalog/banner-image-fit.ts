/**
 * Banner auto-fit (client feedback item 2). The hero frame is 16:9
 * (aspect-video, object-contain) and the built-in banners are
 * 1920x1080, so every uploaded banner is fitted to exactly 1920x1080
 * before it is submitted.
 *
 * CONTAIN, never crop: the artwork must stay whole — the contact
 * strip along the bottom edge of a banner must never be cut off — so
 * the image is scaled to fit inside the frame (never upscaled) and
 * centred on a white canvas, the hero's own background. A wrong-size
 * upload therefore still matches the frame, with white bars instead
 * of a cropped or stretched image.
 *
 * The fitted file is WebP and must stay under the 768 KiB server
 * cap: quality steps down (0.82 -> 0.7 -> 0.55), then the canvas
 * drops to 1600x900. The smallest attempt is returned even when it
 * is still over the cap, with a note — the server still rejects it,
 * but the message names the limit instead of failing silently.
 *
 * Browser-only APIs (createImageBitmap, Canvas): no vitest coverage
 * — the node test environment has no Canvas. The guards below keep
 * the module import-safe anywhere; behavior is verified in the
 * browser. EXIF orientation is honored (createImageBitmap
 * imageOrientation), like the catalogue auto-compressor.
 */

/** Banner frame: 16:9, matching the built-in 1920x1080 banners. */
export const BANNER_FIT_WIDTH = 1920;
export const BANNER_FIT_HEIGHT = 1080;

/** Server cap for a banner upload (draftMediaLimit, lib/admin/settings.ts). */
export const BANNER_FIT_MAX_BYTES = 768 * 1024;

const FALLBACK_WIDTH = 1600;
const FALLBACK_HEIGHT = 900;
const QUALITIES = [0.82, 0.7, 0.55];

export interface FitBannerResult {
  /** The file to upload: the fitted image, or the original when fitting was unavailable. */
  file: File;
  /** True when the returned file is a fitted re-encode. */
  fitted: boolean;
  /** User-visible note when fitting was unavailable, skipped, or still over the cap. */
  note: string | null;
}

function fallback(file: File, note: string | null): FitBannerResult {
  return { file, fitted: false, note };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

function drawContain(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  // Never upscale: a smaller image stays sharp at native size.
  const scale = Math.min(1, width / bitmap.width, height / bitmap.height);
  const drawWidth = Math.max(1, Math.round(bitmap.width * scale));
  const drawHeight = Math.max(1, Math.round(bitmap.height * scale));
  ctx.drawImage(
    bitmap,
    Math.round((width - drawWidth) / 2),
    Math.round((height - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );
  return canvas;
}

export async function fitBannerImage(file: File): Promise<FitBannerResult> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return fallback(
      file,
      "Auto-fit is unavailable in this browser, so the original will be uploaded.",
    );
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return fallback(file, "Banners must be JPEG, PNG, or WebP.");
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return fallback(file, "That image could not be read, so the original will be uploaded.");
  }
  try {
    const original = `${bitmap.width}x${bitmap.height}`;
    // Already exactly the frame and under the cap: keep the original bytes.
    if (
      bitmap.width === BANNER_FIT_WIDTH &&
      bitmap.height === BANNER_FIT_HEIGHT &&
      file.size <= BANNER_FIT_MAX_BYTES
    ) {
      return { file, fitted: false, note: null };
    }
    const name = file.name.replace(/\.[^.]*$/, "") || "banner";
    for (const [width, height] of [
      [BANNER_FIT_WIDTH, BANNER_FIT_HEIGHT],
      [FALLBACK_WIDTH, FALLBACK_HEIGHT],
    ] as const) {
      const canvas = drawContain(bitmap, width, height);
      for (const quality of QUALITIES) {
        const blob = await toBlob(canvas, quality);
        if (!blob) continue;
        if (blob.size <= BANNER_FIT_MAX_BYTES) {
          return {
            file: new File([blob], `${name}.webp`, { type: "image/webp" }),
            fitted: true,
            note: `Fitted from ${original} to ${width}x${height} (16:9). Nothing was cut off — the whole image is kept on a white background.`,
          };
        }
      }
    }
    // Smallest attempt, still over the cap: the server will reject it,
    // but the note names the limit instead of failing silently.
    const canvas = drawContain(bitmap, FALLBACK_WIDTH, FALLBACK_HEIGHT);
    const blob = await toBlob(canvas, QUALITIES[QUALITIES.length - 1]!);
    if (!blob) return fallback(file, "That image could not be fitted, so the original will be uploaded.");
    return {
      file: new File([blob], `${name}.webp`, { type: "image/webp" }),
      fitted: true,
      note: `Fitted to ${FALLBACK_WIDTH}x${FALLBACK_HEIGHT} (16:9), but it is still larger than 768 KiB — the save may be rejected. Try a simpler image.`,
    };
  } finally {
    bitmap.close();
  }
}
