import "server-only";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireStaff, actionOk, actionError, toActionError } from "./authorization";
import { areaRoles, PRODUCT_MEDIA_BUCKET } from "./constants";
import { draftMediaLimit, validDraftImage } from "./media-validation";
import type { AdminActionResult } from "./authorization";


import {
  ANNOUNCEMENT_SCHEMA,
  SEO_DEFAULTS_SCHEMA,
  SEO_PAGE_SLUGS,
  STORE_SETTINGS_SCHEMA,
  STORE_SETTINGS_VALIDATED,
  isSettingKey,
} from "./settings-shared";
import type { SettingKey, StoreSettingsMap } from "./settings-shared";

// Re-exported so existing import sites (pages, tests) keep working; the
// definitions live in ./settings-shared so client components can import
// them without pulling in this module's inline Server Actions.
export {
  ANNOUNCEMENT_SCHEMA,
  SEO_DEFAULTS_SCHEMA,
  SEO_PAGE_SLUGS,
  SETTING_KEYS,
  STORE_SETTINGS_SCHEMA,
  STORE_SETTINGS_VALIDATED,
  isSettingKey,
  settingString,
} from "./settings-shared";
export type {
  SeoPageSlug,
  SettingKey,
  StoreSettingsMap,
} from "./settings-shared";

/** Load all stored settings via RLS (staff read). Null when unavailable. */
export async function getStoreSettingsMap(): Promise<StoreSettingsMap | null> {
  const session = await requireStaff(areaRoles("settings"));
  const result = await session.client
    .from("store_settings")
    .select("key, value");
  if (result.error) return null;
  const map: StoreSettingsMap = {};
  for (const row of result.data ?? []) {
    if (typeof row.key === "string") map[row.key] = row.value;
  }
  return map;
}

/** Signed display URL for a private-bucket image. Null when unavailable. */
export async function signedStorageUrl(
  storagePath: string | null | undefined,
): Promise<string | null> {
  if (!storagePath) return null;
  const session = await requireStaff();
  const signed = await session.client.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (signed.error) return null;
  return signed.data.signedUrl;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Validate and upload one image to the private bucket under the given
 * prefix (banners/ or brand/). Returns the storage path or an error
 * message. Enforces the 768 KiB Server Action limit and magic-byte checks.
 */
export async function uploadStorageImage(
  client: Awaited<ReturnType<typeof requireStaff>>["client"],
  file: unknown,
  prefix: "banners" | "brand",
): Promise<{ path: string } | { error: string }> {
  if (!(file instanceof File) || file.size === 0 || file.size > draftMediaLimit) {
    return { error: "Choose a JPEG, PNG or WebP image up to 768 KiB." };
  }
  const extension = IMAGE_EXTENSIONS[file.type];
  if (!extension) {
    return { error: "Choose a JPEG, PNG or WebP image up to 768 KiB." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validDraftImage(bytes, file.type)) {
    return { error: "Choose a valid JPEG, PNG or WebP image up to 768 KiB." };
  }
  const path = `${prefix}/${randomUUID()}.${extension}`;
  const uploaded = await client.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploaded.error) {
    return { error: "Upload failed. Check your access and try again." };
  }
  return { path: uploaded.data.path };
}

async function setSetting(
  client: Awaited<ReturnType<typeof requireStaff>>["client"],
  key: SettingKey,
  value: unknown,
): Promise<{ error?: string }> {
  const result = await client.rpc("admin_set_setting", {
    p_key: key,
    p_value: value,
  });
  if (result.error) {
    return { error: toActionError(result.error, "Setting could not be saved.") };
  }
  return {};
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveStoreSettings(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  // Only keys present in the submitted form are updated, so partial forms
  // (for example the theme page's store-name field) cannot wipe the rest.
  const present: Record<string, string> = {};
  for (const key of Object.keys(STORE_SETTINGS_SCHEMA.shape)) {
    if (form.has(key)) present[key] = formText(form, key);
  }
  const parsed = STORE_SETTINGS_VALIDATED.partial().safeParse(present);
  if (!parsed.success) {
    return actionError("Check the highlighted fields and try again.");
  }
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined || !isSettingKey(key)) continue;
    const saved = await setSetting(session.client, key, value);
    if (saved.error) return actionError(saved.error);
  }
  revalidatePath("/admin/settings/store");
  revalidatePath("/admin/settings/theme");
  revalidatePath("/admin/settings/general");
  return actionOk("Store settings saved.");
}

export async function saveAnnouncementBar(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("content"));
  const parsed = ANNOUNCEMENT_SCHEMA.safeParse({
    text: formText(form, "text"),
    visible: form.get("visible") === "on",
  });
  if (!parsed.success) {
    return actionError("Enter announcement text of 1–200 characters.");
  }
  const saved = await setSetting(session.client, "announcement_bar", {
    text: parsed.data.text,
    visible: parsed.data.visible,
  });
  if (saved.error) return actionError(saved.error);
  revalidatePath("/admin/content/homepage");
  return actionOk("Announcement bar saved.");
}

export async function saveSeoSettings(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  // Defaults update only when present in the form. Page overrides update
  // only when at least one override field is present; forms that submit
  // overrides always submit all eight fields (visible or hidden).
  const hasOverrides = SEO_PAGE_SLUGS.some(
    (slug) => form.has(`seo_${slug}_title`) || form.has(`seo_${slug}_description`),
  );
  const overrides: Record<string, { title: string; description: string }> = {};
  for (const slug of SEO_PAGE_SLUGS) {
    overrides[slug] = {
      title: formText(form, `seo_${slug}_title`),
      description: formText(form, `seo_${slug}_description`),
    };
  }
  const parsed = SEO_DEFAULTS_SCHEMA.safeParse({
    seo_default_title: formText(form, "seo_default_title"),
    seo_default_description: formText(form, "seo_default_description"),
    seo_page_overrides: overrides,
  });
  if (!parsed.success) {
    return actionError("Check the SEO fields and try again.");
  }
  if (form.has("seo_default_title")) {
    const defaults = await setSetting(
      session.client,
      "seo_default_title",
      parsed.data.seo_default_title,
    );
    if (defaults.error) return actionError(defaults.error);
  }
  if (form.has("seo_default_description")) {
    const description = await setSetting(
      session.client,
      "seo_default_description",
      parsed.data.seo_default_description,
    );
    if (description.error) return actionError(description.error);
  }
  if (hasOverrides) {
    const pages = await setSetting(
      session.client,
      "seo_page_overrides",
      parsed.data.seo_page_overrides,
    );
    if (pages.error) return actionError(pages.error);
  }
  revalidatePath("/admin/marketing/seo");
  revalidatePath("/admin/settings/general");
  return actionOk("SEO settings saved.");
}

const BRAND_IMAGE_KEYS: Record<string, SettingKey> = {
  logo: "logo_storage_path",
  favicon: "favicon_storage_path",
  social: "seo_social_image_path",
};

export async function uploadBrandImage(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const kind = formText(form, "kind");
  const key = BRAND_IMAGE_KEYS[kind];
  if (!key) return actionError("Unknown image type.");
  const uploaded = await uploadStorageImage(
    session.client,
    form.get("image"),
    "brand",
  );
  if ("error" in uploaded) return actionError(uploaded.error);
  const saved = await setSetting(session.client, key, uploaded.path);
  if (saved.error) {
    await session.client.storage
      .from(PRODUCT_MEDIA_BUCKET)
      .remove([uploaded.path]);
    return actionError(saved.error);
  }
  revalidatePath("/admin/settings/theme");
  revalidatePath("/admin/marketing/seo");
  return actionOk("Image uploaded and saved.");
}

export async function clearBrandImage(form: FormData): Promise<void> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const kind = formText(form, "kind");
  const key = BRAND_IMAGE_KEYS[kind];
  if (!key) return;
  await setSetting(session.client, key, "");
  revalidatePath("/admin/settings/theme");
  revalidatePath("/admin/marketing/seo");
}
