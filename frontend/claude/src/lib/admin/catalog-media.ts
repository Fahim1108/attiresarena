'use server';

/**
 * Product media: Server Actions + reads for the catalogue image manager.
 *
 * STORAGE ORDERING CONTRACT (from migration 20261115000700): restrictive
 * storage policies block deleting/overwriting bytes while a product_media
 * row references them. Therefore:
 * * ADD: upload bytes first, then admin_add_product_media; on RPC failure
 *   remove the orphan bytes.
 * * REMOVE: admin_remove_product_media first (returns the path), then
 *   remove the bytes.
 * * REPLACE: upload new bytes, remove the old row, add the new row at the
 *   same position, then remove the old bytes.
 *
 * HONEST PROGRESS: uploads travel through Server Actions because the
 * admin session cookie is HttpOnly, so the browser cannot call Supabase
 * Storage directly with the staff session. Byte-level progress events do
 * not exist on that transport, so the UI reports honest per-file states
 * (Queued -> Uploading... -> Done/Failed with the real error) and NEVER a
 * fabricated percentage. See the image uploader component.
 *
 * BODY-SIZE CAVEAT: files are validated at <= 5 MB here and sent ONE per
 * action call, but the Next.js default Server Action body limit is 1 MiB.
 * Until serverActions.bodySizeLimit is raised in next.config (a
 * coordinator-owned file this module must not touch), uploads above ~1 MiB
 * will fail at the framework level and the real error is surfaced to the
 * user. Do not silently lower the documented 5 MB limit in the UI.
 */

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffSession } from "./access";
import {
  actionError,
  actionOk,
  requireStaff,
  type AdminActionResult,
} from "./authorization";
import {
  areaRoles,
  MAX_PRODUCT_IMAGES,
  PRODUCT_MEDIA_BUCKET,
} from "./constants";
import {
  imageExtensionFor,
  isAcceptedImageType,
  isCatalogStoragePath,
  validCatalogImageBytes,
  validateImageCount,
  validateImageFileMeta,
  validateReorderOrder,
} from "./catalog-variants";

export interface CatalogMediaItem {
  id: string;
  storagePath: string;
  altText: string;
  position: number;
  url: string | null;
}

const mediaRowSchema = z.object({
  id: z.uuid(),
  storage_path: z.string(),
  alt_text: z.string(),
  position: z.number().int().min(0).max(19),
});

export interface CatalogMediaRead {
  items: CatalogMediaItem[];
  /** True when the gallery query failed: the section degrades, not the page. */
  unavailable: boolean;
  /** Gallery rows skipped as malformed; they stay untouched. */
  skipped: number;
}

/**
 * Product gallery rows with short-lived signed URLs (private bucket).
 * Failures are REPORTED, never thrown: a failed gallery read degrades
 * only the gallery section of the edit page, and a failed signed URL
 * leaves that image without a preview URL instead of crashing the page.
 */
export async function readProductMedia(
  productId: string,
): Promise<CatalogMediaRead> {
  const session = await staffSession();
  if (!z.uuid().safeParse(productId).success) {
    return { items: [], unavailable: false, skipped: 0 };
  }
  let result: { data: unknown; error: unknown };
  try {
    result = await session.client
      .from("product_media")
      .select("id,storage_path,alt_text,position")
      .eq("product_id", productId)
      .order("position", { ascending: true });
  } catch {
    return { items: [], unavailable: true, skipped: 0 };
  }
  if (result.error) return { items: [], unavailable: true, skipped: 0 };
  // Per-row validation: one malformed gallery row is skipped, never a
  // page crash.
  const rows: z.infer<typeof mediaRowSchema>[] = [];
  let skipped = 0;
  const data = Array.isArray(result.data) ? result.data : [];
  for (const row of data) {
    const parsed = mediaRowSchema.safeParse(row);
    if (parsed.success) rows.push(parsed.data);
    else skipped += 1;
  }
  const items = await Promise.all(
    rows.map(async (row) => {
      let url: string | null = null;
      try {
        const signed = await session.client.storage
          .from(PRODUCT_MEDIA_BUCKET)
          .createSignedUrl(row.storage_path, 120);
        url = signed.error ? null : signed.data.signedUrl;
      } catch {
        url = null;
      }
      return {
        id: row.id,
        storagePath: row.storage_path,
        altText: row.alt_text,
        position: row.position,
        url,
      };
    }),
  );
  return { items, unavailable: false, skipped };
}

function rpcMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (
      typeof message === "string" &&
      message.trim().length > 0 &&
      message.length <= 300 &&
      !/constraint|violates|SQLSTATE|relation |function |column |does not exist/i.test(
        message,
      )
    ) {
      return message.trim();
    }
  }
  return fallback;
}

function revalidateProduct(productId: string): void {
  revalidatePath("/admin/catalog/products");
  revalidatePath(`/admin/catalog/products/${productId}`);
  // Gallery changes on a published product change storefront images.
  // Same-deployment only; no-op under today's force-dynamic rendering.
  revalidatePath("/");
  revalidatePath("/shop");
}

async function countProductMedia(
  client: Awaited<ReturnType<typeof staffSession>>["client"],
  productId: string,
): Promise<number | null> {
  const result = await client
    .from("product_media")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  if (result.error) return null;
  return result.count ?? 0;
}

/**
 * Short-lived preview URL for a freshly uploaded path. Signing failures
 * (error or rejection) degrade to null — the upload already succeeded,
 * so the caller still returns the stored path.
 */
async function signedPreviewUrl(
  client: Awaited<ReturnType<typeof staffSession>>["client"],
  path: string,
): Promise<string | null> {
  try {
    const signed = await client.storage
      .from(PRODUCT_MEDIA_BUCKET)
      .createSignedUrl(path, 600);
    return signed.error ? null : signed.data.signedUrl;
  } catch {
    return null;
  }
}

async function prepareUpload(
  file: unknown,
): Promise<
  | { bytes: Uint8Array; mime: "image/jpeg" | "image/png" | "image/webp" }
  | { error: string }
> {
  if (!(file instanceof File)) return { error: "Choose an image file." };
  const metaError = validateImageFileMeta(file);
  if (metaError) return { error: metaError };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validCatalogImageBytes(bytes, file.type)) {
    return {
      error:
        "That file is not a valid JPEG, PNG or WebP image, or it exceeds 5 MB.",
    };
  }
  if (!isAcceptedImageType(file.type)) {
    return { error: "Only JPEG, PNG and WebP images are accepted." };
  }
  return { bytes, mime: file.type };
}

export type MediaUploadResult = AdminActionResult & { mediaId?: string };

/** Upload ONE file and attach it at the end of the gallery. */
export async function uploadCatalogImage(
  form: FormData,
): Promise<MediaUploadResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  const productRaw = form.get("product_id");
  const productId = typeof productRaw === "string" ? productRaw : "";
  if (!z.uuid().safeParse(productId).success) {
    return actionError("Invalid product. Reload and try again.");
  }
  const altRaw = form.get("alt");
  const alt = typeof altRaw === "string" ? altRaw.slice(0, 300) : "";
  const prepared = await prepareUpload(form.get("image"));
  if ("error" in prepared) return actionError(prepared.error);
  const existing = await countProductMedia(session.client, productId);
  if (existing === null) {
    return actionError("Gallery could not be checked. Reload and try again.");
  }
  const countError = validateImageCount(existing, 1);
  if (countError) return actionError(countError);
  const path = `${session.user.id}/${randomUUID()}.${imageExtensionFor(prepared.mime)}`;
  const upload = await session.client.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .upload(path, prepared.bytes, {
      contentType: prepared.mime,
      upsert: false,
    });
  if (upload.error) {
    return actionError("Upload failed. Check your access and try again.");
  }
  const attached = await session.client.rpc("admin_add_product_media", {
    p_product_id: productId,
    p_storage_path: path,
    p_storage_object_id: null,
    p_alt_text: alt,
    p_position: null,
  });
  if (attached.error || typeof attached.data !== "string") {
    // Bytes were written but attachment was not confirmed. Removing them
    // is blocked by policy if the row actually committed, so the honest
    // message asks for a reload to check the real state.
    await session.client.storage.from(PRODUCT_MEDIA_BUCKET).remove([path]);
    revalidateProduct(productId);
    return actionError(
      "Image could not be attached. Reload the gallery to check whether it was saved before retrying.",
    );
  }
  revalidateProduct(productId);
  return {
    ok: true,
    message: "Image uploaded and attached.",
    mediaId: attached.data,
  };
}

/** Replace one gallery image: new bytes + new row at the same position. */
export async function replaceCatalogImage(
  form: FormData,
): Promise<MediaUploadResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  const productRaw = form.get("product_id");
  const mediaRaw = form.get("media_id");
  const productId = typeof productRaw === "string" ? productRaw : "";
  const mediaId = typeof mediaRaw === "string" ? mediaRaw : "";
  if (
    !z.uuid().safeParse(productId).success ||
    !z.uuid().safeParse(mediaId).success
  ) {
    return actionError("Invalid image. Reload and try again.");
  }
  const prepared = await prepareUpload(form.get("image"));
  if ("error" in prepared) return actionError(prepared.error);
  const existing = await session.client
    .from("product_media")
    .select("id,storage_path,alt_text,position")
    .eq("id", mediaId)
    .eq("product_id", productId)
    .maybeSingle();
  if (existing.error || !existing.data) {
    return actionError("Image not found. Reload and try again.");
  }
  const oldRowParsed = mediaRowSchema.safeParse(existing.data);
  if (!oldRowParsed.success) {
    return actionError("Image could not be read. Reload and try again.");
  }
  const oldRow = oldRowParsed.data;
  const altRaw = form.get("alt");
  const alt =
    typeof altRaw === "string" ? altRaw.slice(0, 300) : oldRow.alt_text;
  const path = `${session.user.id}/${randomUUID()}.${imageExtensionFor(prepared.mime)}`;
  const upload = await session.client.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .upload(path, prepared.bytes, {
      contentType: prepared.mime,
      upsert: false,
    });
  if (upload.error) {
    return actionError("Upload failed. The existing image was not changed.");
  }
  const removed = await session.client.rpc("admin_remove_product_media", {
    p_media_id: mediaId,
  });
  if (removed.error) {
    await session.client.storage.from(PRODUCT_MEDIA_BUCKET).remove([path]);
    return actionError(
      "The existing image could not be removed, so nothing was replaced.",
    );
  }
  const attached = await session.client.rpc("admin_add_product_media", {
    p_product_id: productId,
    p_storage_path: path,
    p_storage_object_id: null,
    p_alt_text: alt,
    p_position: oldRow.position,
  });
  if (attached.error || typeof attached.data !== "string") {
    await session.client.storage.from(PRODUCT_MEDIA_BUCKET).remove([path]);
    revalidateProduct(productId);
    return actionError(
      "The old image was removed but the new one could not be attached. Upload the replacement again.",
    );
  }
  // Old row is gone, so the restrictive policy no longer blocks removal.
  await session.client.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .remove([oldRow.storage_path]);
  revalidateProduct(productId);
  return {
    ok: true,
    message: "Image replaced.",
    mediaId: attached.data,
  };
}

export async function reorderCatalogMedia(
  productId: string,
  orderedIds: string[],
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  if (!z.uuid().safeParse(productId).success) {
    return actionError("Invalid product. Reload and try again.");
  }
  const parsed = z
    .array(z.uuid())
    .min(1)
    .max(MAX_PRODUCT_IMAGES)
    .safeParse(orderedIds);
  if (!parsed.success) return actionError("Invalid gallery order.");
  const existing = await session.client
    .from("product_media")
    .select("id")
    .eq("product_id", productId);
  if (existing.error) {
    return actionError("Gallery could not be checked. Reload and try again.");
  }
  const existingParsed = z
    .array(z.object({ id: z.uuid() }))
    .safeParse(existing.data ?? []);
  if (!existingParsed.success) {
    return actionError("Gallery could not be checked. Reload and try again.");
  }
  const existingIds = existingParsed.data.map((row) => row.id);
  const orderError = validateReorderOrder(parsed.data, existingIds);
  if (orderError) return actionError(orderError);
  const result = await session.client.rpc("admin_reorder_product_media", {
    p_product_id: productId,
    ordered_ids: parsed.data,
  });
  if (result.error) {
    return actionError(rpcMessage(result.error, "Gallery could not be reordered."));
  }
  revalidateProduct(productId);
  return actionOk("Image order saved.");
}

export async function removeCatalogMedia(
  productId: string,
  mediaId: string,
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  if (
    !z.uuid().safeParse(productId).success ||
    !z.uuid().safeParse(mediaId).success
  ) {
    return actionError("Invalid image. Reload and try again.");
  }
  const removed = await session.client.rpc("admin_remove_product_media", {
    p_media_id: mediaId,
  });
  if (removed.error || typeof removed.data !== "string") {
    return actionError(
      rpcMessage(removed.error, "Image could not be removed."),
    );
  }
  // Row first, bytes after: the restrictive policy blocks byte removal
  // while the row exists, and permits it now.
  await session.client.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .remove([removed.data]);
  revalidateProduct(productId);
  return actionOk("Image removed.");
}

export async function updateCatalogMediaAlt(
  productId: string,
  mediaId: string,
  alt: string,
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  if (
    !z.uuid().safeParse(productId).success ||
    !z.uuid().safeParse(mediaId).success
  ) {
    return actionError("Invalid image. Reload and try again.");
  }
  if (alt.length > 300) {
    return actionError("Image description must be 300 characters or fewer.");
  }
  const result = await session.client.rpc("admin_update_product_media", {
    p_media_id: mediaId,
    p_alt_text: alt,
  });
  if (result.error) {
    return actionError(
      rpcMessage(result.error, "Image description could not be saved."),
    );
  }
  revalidateProduct(productId);
  return actionOk("Image description saved.");
}

export type CategoryImageUploadResult =
  | { ok: true; path: string; url: string | null }
  | { ok: false; error: string };

/**
 * Upload a category image/banner and return its storage path plus a
 * short-lived preview URL. The path is stored only when the category form
 * is saved; unsaved uploads leave orphan bytes in the private bucket
 * (harmless, cleaned up by a future housekeeping pass).
 */
export async function uploadCategoryImage(
  form: FormData,
): Promise<CategoryImageUploadResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  const prepared = await prepareUpload(form.get("image"));
  if ("error" in prepared) return { ok: false, error: prepared.error };
  const path = `${session.user.id}/${randomUUID()}.${imageExtensionFor(prepared.mime)}`;
  const upload = await session.client.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .upload(path, prepared.bytes, {
      contentType: prepared.mime,
      upsert: false,
    });
  if (upload.error) {
    return { ok: false, error: "Upload failed. Check your access and try again." };
  }
  return {
    ok: true,
    path,
    url: await signedPreviewUrl(session.client, path),
  };
}

export type StagedImageResult = CategoryImageUploadResult;

/**
 * Stage ONE image for product creation: bytes upload now, attachment
 * happens on save (createCatalogProduct attaches staged paths via
 * admin_add_product_media). Same orphan caveat as uploadCategoryImage:
 * staged bytes whose product is never saved stay in the private bucket
 * until a future housekeeping pass. Preview URL is short-lived (600s).
 */
export async function stageCatalogImage(
  form: FormData,
): Promise<StagedImageResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  const prepared = await prepareUpload(form.get("image"));
  if ("error" in prepared) return { ok: false, error: prepared.error };
  const path = `${session.user.id}/${randomUUID()}.${imageExtensionFor(prepared.mime)}`;
  const upload = await session.client.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .upload(path, prepared.bytes, {
      contentType: prepared.mime,
      upsert: false,
    });
  if (upload.error) {
    return { ok: false, error: "Upload failed. Check your access and try again." };
  }
  return {
    ok: true,
    path,
    url: await signedPreviewUrl(session.client, path),
  };
}

/**
 * Discard a staged image. Only the caller's own paths, and only when no
 * product gallery row or category image/banner references the path —
 * all three checks fail closed. Attached images use removeCatalogMedia
 * instead (row-first ordering contract).
 */
export async function discardStagedCatalogImage(
  path: string,
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  if (!isCatalogStoragePath(path) || path.split("/")[0] !== session.user.id) {
    return actionError("Invalid staged image.");
  }
  const [inGallery, inCategoryImage, inCategoryBanner] = await Promise.all([
    session.client
      .from("product_media")
      .select("id", { head: true, count: "exact" })
      .eq("storage_path", path),
    session.client
      .from("categories")
      .select("id", { head: true, count: "exact" })
      .eq("image_storage_path", path),
    session.client
      .from("categories")
      .select("id", { head: true, count: "exact" })
      .eq("banner_storage_path", path),
  ]);
  if (inGallery.error || inCategoryImage.error || inCategoryBanner.error) {
    return actionError(
      "Staged image could not be checked. Reload and try again.",
    );
  }
  if (
    (inGallery.count ?? 0) > 0 ||
    (inCategoryImage.count ?? 0) > 0 ||
    (inCategoryBanner.count ?? 0) > 0
  ) {
    return actionError(
      "That image is already in use and cannot be discarded here.",
    );
  }
  const removed = await session.client.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .remove([path]);
  if (removed.error) {
    return actionError("Staged image could not be removed.");
  }
  return actionOk("Staged image discarded.");
}
