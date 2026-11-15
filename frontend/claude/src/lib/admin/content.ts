import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  requireStaff,
  actionOk,
  actionError,
  toActionError,
} from "./authorization";
import { areaRoles, PRODUCT_MEDIA_BUCKET } from "./constants";
import { signedStorageUrl, uploadStorageImage } from "./settings";
import type { AdminActionResult } from "./authorization";

/** Slug rule shared with the content_blocks CHECK constraint. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export const CONTENT_BLOCK_SCHEMA = z.object({
  slug: z.string().regex(SLUG_PATTERN, "Use lowercase letters, numbers and hyphens."),
  title: z.string().trim().max(200),
  body: z.string().max(20000),
  image_storage_path: z.string().max(500),
  sort_position: z.number().int().min(0).max(9999),
  visible: z.boolean(),
});

export const BANNER_SCHEMA = z.object({
  id: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(300),
  image_storage_path: z
    .string()
    .min(1)
    .max(500)
    .refine(
      (value) => value.startsWith("banners/"),
      "Banner images must use the banners/ prefix.",
    ),
  link_url: z
    .string()
    .trim()
    .max(1000)
    .refine(
      (value) => value === "" || /^(\/|https?:\/\/)/.test(value),
      "Links must be a site path or an http(s) URL.",
    ),
  sort_position: z.number().int().min(0).max(9999),
  visible: z.boolean(),
  placement: z.enum(["hero", "promo"]),
});

/** Order banner ids by (sort_position, created_at) — the admin list order. */
export function orderBannerIds<T extends { id: string; sort_position: number; created_at: string }>(
  banners: readonly T[],
): string[] {
  return [...banners]
    .sort((a, b) =>
      a.sort_position === b.sort_position
        ? a.created_at.localeCompare(b.created_at)
        : a.sort_position - b.sort_position,
    )
    .map((banner) => banner.id);
}

export interface ContentBlock {
  slug: string;
  title: string | null;
  body: string;
  image_storage_path: string | null;
  sort_position: number;
  visible: boolean;
  updated_at: string;
}

export interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  image_storage_path: string;
  link_url: string | null;
  sort_position: number;
  visible: boolean;
  placement: "hero" | "promo";
  created_at: string;
  imageUrl: string | null;
}

/** Content blocks the storefront can override, with honest wiring status. */
export const MANAGED_BLOCKS: {
  slug: string;
  label: string;
  storefront: string;
  wired: boolean;
}[] = [
  { slug: "about", label: "About", storefront: "/about", wired: false },
  { slug: "privacy-policy", label: "Privacy Policy", storefront: "/privacy-policy", wired: true },
  { slug: "terms", label: "Terms & Conditions", storefront: "/terms", wired: true },
  { slug: "return-policy", label: "Return & Exchange Policy", storefront: "/return-policy", wired: true },
  { slug: "shipping-policy", label: "Shipping Policy", storefront: "/shipping-policy", wired: true },
];

/** Announcement bar value for the Content area (content.manage may read it). */
export async function getAnnouncementBarValue(): Promise<{
  text: string;
  visible: boolean;
} | null> {
  const session = await requireStaff(areaRoles("content"));
  const result = await session.client
    .from("store_settings")
    .select("value")
    .eq("key", "announcement_bar")
    .maybeSingle();
  if (result.error || !result.data) return null;
  const value: unknown = result.data.value;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.text !== "string" || typeof record.visible !== "boolean") {
    return null;
  }
  return { text: record.text, visible: record.visible };
}

export async function getContentBlocks(): Promise<ContentBlock[] | null> {
  const session = await requireStaff(areaRoles("content"));
  const result = await session.client
    .from("content_blocks")
    .select("slug, title, body, image_storage_path, sort_position, visible, updated_at")
    .order("sort_position", { ascending: true })
    .order("slug", { ascending: true });
  if (result.error) return null;
  return (result.data ?? []).map((row) => ({
    slug: row.slug,
    title: row.title,
    body: row.body,
    image_storage_path: row.image_storage_path,
    sort_position: row.sort_position,
    visible: row.visible,
    updated_at: row.updated_at,
  }));
}

export async function getBanners(): Promise<Banner[] | null> {
  const session = await requireStaff(areaRoles("content"));
  const result = await session.client
    .from("banners")
    .select("id, title, subtitle, image_storage_path, link_url, sort_position, visible, placement, created_at")
    .order("sort_position", { ascending: true })
    .order("created_at", { ascending: true });
  if (result.error) return null;
  const banners: Banner[] = [];
  for (const row of result.data ?? []) {
    banners.push({
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      image_storage_path: row.image_storage_path,
      link_url: row.link_url,
      sort_position: row.sort_position,
      visible: row.visible,
      placement: row.placement === "promo" ? "promo" : "hero",
      created_at: row.created_at,
      imageUrl: await signedStorageUrl(row.image_storage_path),
    });
  }
  return banners;
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function formInt(form: FormData, name: string, fallback: number): number {
  const parsed = Number.parseInt(formText(form, name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Revalidate the storefront page a content block overrides (Admin Panel v2,
 * item 9a). Only the wired policy pages benefit today; the About override
 * is unwired, so revalidating /about is harmless but changes nothing until
 * its wiring lands. Same-deployment only: a Preview save never refreshes
 * Production. Revalidation-only addition — no other behaviour changed.
 */
function revalidateBlockPage(slug: string): void {
  const managed = MANAGED_BLOCKS.find((block) => block.slug === slug);
  if (managed) revalidatePath(managed.storefront);
}

/** Banner changes surface on the homepage once hero/promo wiring lands. */
function revalidateBannerSurfaces(): void {
  revalidatePath("/");
}

export async function saveContentBlock(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("content"));
  const parsed = CONTENT_BLOCK_SCHEMA.safeParse({
    slug: formText(form, "slug"),
    title: formText(form, "title"),
    body: formText(form, "body"),
    image_storage_path: formText(form, "image_storage_path"),
    sort_position: formInt(form, "sort_position", 0),
    visible: form.get("visible") === "on",
  });
  if (!parsed.success) {
    return actionError("Check the block fields and try again.");
  }
  const result = await session.client.rpc("admin_save_content_block", {
    p_slug: parsed.data.slug,
    p_title: parsed.data.title || null,
    p_body: parsed.data.body,
    p_image_storage_path: parsed.data.image_storage_path || null,
    p_sort_position: parsed.data.sort_position,
    p_visible: parsed.data.visible,
  });
  if (result.error) {
    return actionError(toActionError(result.error, "Content block could not be saved."));
  }
  revalidatePath("/admin/content/pages");
  revalidateBlockPage(parsed.data.slug);
  return actionOk("Content block saved.");
}

export async function deleteContentBlock(form: FormData): Promise<void> {
  "use server";
  const session = await requireStaff(areaRoles("content"));
  const slug = formText(form, "slug");
  if (!isValidSlug(slug)) return;
  await session.client.rpc("admin_delete_content_block", { p_slug: slug });
  revalidatePath("/admin/content/pages");
  revalidateBlockPage(slug);
}

export async function saveBanner(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("content"));
  const existingPath = formText(form, "existing_image_storage_path");
  const file = form.get("image");
  let imagePath = existingPath;
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadStorageImage(session.client, file, "banners");
    if ("error" in uploaded) return actionError(uploaded.error);
    imagePath = uploaded.path;
  }
  const parsed = BANNER_SCHEMA.safeParse({
    id: formText(form, "id") || null,
    title: formText(form, "title"),
    subtitle: formText(form, "subtitle"),
    image_storage_path: imagePath,
    link_url: formText(form, "link_url"),
    sort_position: formInt(form, "sort_position", 0),
    visible: form.get("visible") === "on",
    placement: formText(form, "placement"),
  });
  if (!parsed.success) {
    if (imagePath !== existingPath && imagePath) {
      await session.client.storage
        .from(PRODUCT_MEDIA_BUCKET)
        .remove([imagePath]);
    }
    return actionError("Check the banner fields and try again. New banners need an image.");
  }
  const result = await session.client.rpc("admin_save_banner", {
    p_id: parsed.data.id,
    p_title: parsed.data.title,
    p_subtitle: parsed.data.subtitle || null,
    p_image_storage_path: parsed.data.image_storage_path,
    p_link_url: parsed.data.link_url || null,
    p_sort_position: parsed.data.sort_position,
    p_visible: parsed.data.visible,
    p_placement: parsed.data.placement,
  });
  if (result.error) {
    if (imagePath !== existingPath && imagePath) {
      await session.client.storage
        .from(PRODUCT_MEDIA_BUCKET)
        .remove([imagePath]);
    }
    return actionError(toActionError(result.error, "Banner could not be saved."));
  }
  revalidatePath("/admin/content/banners");
  revalidatePath("/admin/content/homepage");
  revalidatePath("/admin/marketing/promotions");
  revalidateBannerSurfaces();
  return actionOk("Banner saved.");
}

export async function deleteBanner(form: FormData): Promise<void> {
  "use server";
  const session = await requireStaff(areaRoles("content"));
  const id = formText(form, "id");
  const imagePath = formText(form, "image_storage_path");
  if (!id) return;
  const result = await session.client.rpc("admin_delete_banner", { p_id: id });
  if (!result.error && imagePath.startsWith("banners/")) {
    await session.client.storage
      .from(PRODUCT_MEDIA_BUCKET)
      .remove([imagePath]);
  }
  revalidatePath("/admin/content/banners");
  revalidatePath("/admin/content/homepage");
  revalidatePath("/admin/marketing/promotions");
  revalidateBannerSurfaces();
}

export async function moveBanner(form: FormData): Promise<void> {
  "use server";
  const session = await requireStaff(areaRoles("content"));
  const id = formText(form, "id");
  const direction = formText(form, "direction");
  if (!id || (direction !== "up" && direction !== "down")) return;
  const result = await session.client
    .from("banners")
    .select("id, sort_position, created_at")
    .order("sort_position", { ascending: true })
    .order("created_at", { ascending: true });
  if (result.error) return;
  const ids = orderBannerIds(result.data ?? []);
  const index = ids.indexOf(id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= ids.length) return;
  const current = ids[index];
  const other = ids[swapWith];
  if (current === undefined || other === undefined) return;
  ids[index] = other;
  ids[swapWith] = current;
  await session.client.rpc("admin_reorder_banners", { p_ids: ids });
  revalidatePath("/admin/content/banners");
  revalidatePath("/admin/content/homepage");
  revalidatePath("/admin/marketing/promotions");
  revalidateBannerSurfaces();
}

export async function toggleBannerVisibility(form: FormData): Promise<void> {
  "use server";
  const session = await requireStaff(areaRoles("content"));
  const id = formText(form, "id");
  if (!id) return;
  const found = await session.client
    .from("banners")
    .select("id, title, subtitle, image_storage_path, link_url, sort_position, visible, placement")
    .eq("id", id)
    .maybeSingle();
  if (found.error || !found.data) return;
  await session.client.rpc("admin_save_banner", {
    p_id: found.data.id,
    p_title: found.data.title,
    p_subtitle: found.data.subtitle,
    p_image_storage_path: found.data.image_storage_path,
    p_link_url: found.data.link_url,
    p_sort_position: found.data.sort_position,
    p_visible: !found.data.visible,
    p_placement: found.data.placement,
  });
  revalidatePath("/admin/content/banners");
  revalidatePath("/admin/content/homepage");
  revalidatePath("/admin/marketing/promotions");
  revalidateBannerSurfaces();
}
