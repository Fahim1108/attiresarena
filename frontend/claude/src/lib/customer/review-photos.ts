import { z } from "zod";
import type { ActionResult } from "@/types";
import type { CustomerClient } from "./supabase";

/**
 * Customer review photos (client feedback item 19). Photos are
 * OPTIONAL on a review and auto-compressed in the browser before
 * upload (see ReviewForm, which reuses the admin auto-compressor).
 *
 * Writes go ONLY through the attach_product_review_photo RPC over
 * the customer JWT client, after the bytes are uploaded to the
 * review-photos bucket: the table has no INSERT/UPDATE/DELETE grant
 * or policy, so direct table writes cannot work by design. Never a
 * privileged-key client. Identity comes from the caller's JWT inside
 * the RPC (auth.uid()); the upload folder is the caller's own id,
 * enforced by the bucket's INSERT policy as well.
 *
 * Uploads travel through Server Actions because the customer session
 * cookie is HttpOnly, so the browser cannot call Supabase Storage
 * directly with the customer session. The Server Action body limit
 * is 6 MB (next.config) and each photo is validated at <= 5 MB here;
 * the auto-compressor keeps real phone photos far below that.
 *
 * Pre-migration the bucket/table/RPC do not exist: the upload fails
 * and the caller reports it, but the review itself already
 * submitted — a photo failure never fails the review.
 */

/** Storage bucket for review photos (migration 20261124000300). */
export const REVIEW_PHOTO_BUCKET = "review-photos";

/** Max photos per review (positions 0-2, enforced by the RPC too). */
export const MAX_REVIEW_PHOTOS = 3;

/** Per-photo byte cap, same as the bucket limit. */
export const MAX_REVIEW_PHOTO_BYTES = 5 * 1024 * 1024;

const REVIEW_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Storage path shape: <owner-uuid>/<object-uuid>.<ext> (same as catalogue media). */
export const REVIEW_PHOTO_PATH_PATTERN =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function isReviewPhotoPath(path: string): boolean {
  return path.length <= 200 && REVIEW_PHOTO_PATH_PATTERN.test(path);
}

/** Public delivery URL for one stored review photo. */
export function reviewPhotoUrl(storagePath: string): string | null {
  if (!isReviewPhotoPath(storagePath)) return null;
  const [owner, object] = storagePath.split("/");
  if (!owner || !object) return null;
  return `/api/review-photos/${encodeURIComponent(owner)}/${encodeURIComponent(object)}`;
}

const attachPhotoRowSchema = z.object({
  id: z.uuid(),
  review_id: z.uuid(),
  storage_path: z.string(),
  position: z.number().int(),
});

/**
 * Upload one already-compressed photo file and attach it to the
 * caller's own review. On RPC failure the orphan bytes are removed
 * (best effort). Returns the photo id, or a user-facing error.
 */
export async function uploadReviewPhoto(
  client: CustomerClient,
  userId: string,
  reviewId: string,
  file: File,
  position: number,
): Promise<ActionResult<{ photoId: string }>> {
  if (!z.uuid().safeParse(userId).success) {
    return { ok: false, reason: "error", message: "Your sign-in expired. Please sign in again." };
  }
  if (!z.uuid().safeParse(reviewId).success) {
    return { ok: false, reason: "error", message: "Your review could not be found. Please try again." };
  }
  if (!Number.isInteger(position) || position < 0 || position >= MAX_REVIEW_PHOTOS) {
    return { ok: false, reason: "validation", message: "This review already has the maximum 3 photos." };
  }
  const extension = REVIEW_PHOTO_TYPES[file.type];
  if (!extension) {
    return { ok: false, reason: "validation", message: "Photos must be JPEG, PNG, or WebP." };
  }
  if (file.size <= 0 || file.size > MAX_REVIEW_PHOTO_BYTES) {
    return { ok: false, reason: "validation", message: "Each photo must be 5 MB or smaller." };
  }
  const storagePath = `${userId}/${crypto.randomUUID()}.${extension}`;
  const uploaded = await client.storage
    .from(REVIEW_PHOTO_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploaded.error) {
    return { ok: false, reason: "error", message: "Your photo could not be saved. Please try again." };
  }
  const attached = await client.rpc("attach_product_review_photo", {
    p_review_id: reviewId,
    p_storage_path: storagePath,
    p_position: position,
  });
  if (attached.error) {
    // Orphan bytes: the row never landed, so remove the upload.
    await client.storage.from(REVIEW_PHOTO_BUCKET).remove([storagePath]);
    return { ok: false, reason: "error", message: "Your photo could not be saved. Please try again." };
  }
  if (!z.uuid().safeParse(attached.data).success) {
    await client.storage.from(REVIEW_PHOTO_BUCKET).remove([storagePath]);
    return { ok: false, reason: "error", message: "Your photo could not be saved. Please try again." };
  }
  return { ok: true, data: { photoId: attached.data as string } };
}

/** Project one public photo row; null when the row fails validation. */
export function projectReviewPhotoRow(row: unknown): {
  reviewId: string;
  storagePath: string;
  position: number;
} | null {
  const parsed = attachPhotoRowSchema.safeParse(row);
  if (!parsed.success) return null;
  return {
    reviewId: parsed.data.review_id,
    storagePath: parsed.data.storage_path,
    position: parsed.data.position,
  };
}
