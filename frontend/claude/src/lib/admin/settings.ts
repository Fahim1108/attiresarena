import "server-only";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { deliveryAnnouncementText } from "@/lib/delivery-settings";
import { parseAnnouncementBar } from "@/lib/store-settings";
import { requireStaff, isOwner, actionOk, actionError, toActionError } from "./authorization";
import { verifyStaffPassword } from "./account";
import { areaRoles, PRODUCT_MEDIA_BUCKET } from "./constants";
import { draftMediaLimit, validDraftImage } from "./media-validation";
import type { AdminActionResult } from "./authorization";


import {
  ANNOUNCEMENT_SCHEMA,
  CUSTOM_CODE_SCHEMA,
  DELIVERY_SETTINGS_SCHEMA,
  GENERAL_DISPLAY_SCHEMA,
  MARKETING_SETTINGS_SCHEMA,
  PIXEL_EVENTS,
  SEO_DEFAULTS_SCHEMA,
  SEO_EXTENDED_SCHEMA,
  SEO_PAGE_SLUGS,
  STORE_SETTINGS_SCHEMA,
  STORE_SETTINGS_VALIDATED,
  TWITTER_CARDS,
  isSettingKey,
  parseLowStockThreshold,
  parseTestDataEraseCounts,
} from "./settings-shared";
import type {
  PixelEventsConfig,
  SettingKey,
  StoreSettingsMap,
  TestDataEraseCounts,
} from "./settings-shared";

// Re-exported so existing import sites (pages, tests) keep working; the
// definitions live in ./settings-shared so client components can import
// them without pulling in this module's inline Server Actions.
export {
  ANNOUNCEMENT_SCHEMA,
  CUSTOM_CODE_SCHEMA,
  GENERAL_DISPLAY_SCHEMA,
  MARKETING_SETTINGS_SCHEMA,
  PIXEL_EVENTS,
  SEO_DEFAULTS_SCHEMA,
  SEO_EXTENDED_SCHEMA,
  SEO_PAGE_SLUGS,
  SETTING_KEYS,
  STORE_SETTINGS_SCHEMA,
  STORE_SETTINGS_VALIDATED,
  TWITTER_CARDS,
  isOwnerOnlySettingKey,
  isSettingKey,
  parseLowStockThreshold,
  parsePixelEvents,
  parseSeoRobots,
  parseSeoSitemap,
  settingString,
} from "./settings-shared";
export type {
  PixelEventName,
  PixelEventsConfig,
  SeoPageSlug,
  SeoRobotsConfig,
  SeoSitemapConfig,
  SettingKey,
  StoreSettingsMap,
  TwitterCard,
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

/**
 * Revalidate the storefront after a settings save. The root layout is
 * force-dynamic and the settings reader uses `cache: "no-store"`, so a
 * saved value already applies on the next page load; this invalidation
 * additionally refreshes cached RSC payloads for visitors mid-session.
 * It only affects THIS deployment: a save on Preview never refreshes
 * Production (or vice versa) — each deployment serves its own cache.
 * Revalidation cannot wire an unwired surface: footer, announcement-bar
 * and hero overrides still need their storefront wiring to take effect.
 */
function revalidateStorefrontLayout(): void {
  revalidatePath("/", "layout");
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
  revalidateStorefrontLayout();
  return actionOk("Store settings saved.");
}

/**
 * Save the delivery zones (migration 20261122000100): the inside district
 * plus both charges. Charges are entered in whole taka and stored in
 * minor units (100 minor = ৳1), matching the checkout settings the DB
 * trigger mirrors them into. Saving updates the storefront delivery
 * card, the checkout estimate and the advance amount on the next page
 * load — and it also rewrites the announcement bar text to match the
 * new zones (keeping its stored visibility), so the bar can never show
 * stale charges. The bar stays manually editable from Content → Homepage.
 */
export async function saveDeliverySettings(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const parsed = DELIVERY_SETTINGS_SCHEMA.safeParse({
    delivery_inside_district: formText(form, "delivery_inside_district"),
    delivery_inside_charge_taka: Number(formText(form, "delivery_inside_charge_taka")),
    delivery_outside_charge_taka: Number(formText(form, "delivery_outside_charge_taka")),
  });
  if (!parsed.success) {
    return actionError("Check the delivery fields and try again.");
  }
  const values: [SettingKey, unknown][] = [
    ["delivery_inside_district", parsed.data.delivery_inside_district],
    ["delivery_inside_charge_minor", parsed.data.delivery_inside_charge_taka * 100],
    ["delivery_outside_charge_minor", parsed.data.delivery_outside_charge_taka * 100],
  ];
  for (const [key, value] of values) {
    const saved = await setSetting(session.client, key, value);
    if (saved.error) return actionError(saved.error);
  }
  const current = await getStoreSettingsMap();
  const bar = parseAnnouncementBar(current?.["announcement_bar"]);
  const announcement = await setSetting(session.client, "announcement_bar", {
    text: deliveryAnnouncementText({
      insideDistrict: parsed.data.delivery_inside_district,
      insideChargeMinor: parsed.data.delivery_inside_charge_taka * 100,
      outsideChargeMinor: parsed.data.delivery_outside_charge_taka * 100,
    }),
    visible: bar?.visible ?? true,
  });
  if (announcement.error) return actionError(announcement.error);
  revalidatePath("/admin/settings/store");
  revalidatePath("/admin/content/homepage");
  revalidateStorefrontLayout();
  return actionOk(
    "Delivery settings saved. The storefront, checkout and advance amounts now use the new district and charges.",
  );
}

/** The confirmation word for the test-data erase. Must match the RPC. */
const ERASE_CONFIRMATION_WORD = "ERASE";

/**
 * Load the test-data erase preview counts (owner-only). Null when
 * unavailable — for example the erase migration has not been applied
 * on this database yet. The page treats null as "counts unknown" and
 * disables the erase button instead of erasing blind.
 */
export async function getTestDataEraseCounts(): Promise<TestDataEraseCounts | null> {
  const session = await requireStaff(areaRoles("settings"));
  const result = await session.client.rpc("admin_test_data_erase_counts");
  if (result.error) return null;
  return parseTestDataEraseCounts(result.data);
}

/**
 * Erase all test data (migration 20261123000100, owner-only, type ERASE
 * to confirm + re-enter the admin login password). Flow:
 *
 * 1. Owner + MFA re-checks (the settings area is owner-only, and the
 *    RPC hard-checks the owner role again — no per-user grant can
 *    ever enable this).
 * 2. The typed ERASE word AND the owner's current admin login password
 *    must both be right. The password is verified server-side only, via
 *    the throwaway-client check in ./account (never logged, never stored,
 *    never sent to the database — the RPC only ever receives the ERASE
 *    word). A wrong password stops here: nothing is deleted, no partial
 *    erase. Wrong passwords behave like staff sign-in — plain failure,
 *    with Supabase Auth's own rate limiting as the backstop.
 * 3. The RPC deletes every database row in one transaction and returns
 *    the deleted counts. No service-role key is needed any more: the
 *    erase deletes no auth accounts and no storage files (products,
 *    customers and visitor data all stay), so there is no post-RPC
 *    cleanup step at all.
 */
export async function eraseTestData(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  if (!isOwner(session)) {
    return actionError("Only the store owner can erase test data.");
  }
  if (formText(form, "confirmation") !== ERASE_CONFIRMATION_WORD) {
    return actionError("Type ERASE to confirm the erase. Nothing was deleted.");
  }
  const password = formText(form, "password");
  if (!password) {
    return actionError(
      "Enter your admin login password to confirm the erase. Nothing was deleted.",
    );
  }
  const email = session.user.email;
  if (!email || !(await verifyStaffPassword(email, password))) {
    return actionError(
      "ভুল পাসওয়ার্ড — the password is incorrect. Nothing was deleted.",
    );
  }
  const erased = await session.client.rpc("admin_test_data_erase", {
    p_confirmation: ERASE_CONFIRMATION_WORD,
  });
  if (erased.error) {
    return actionError(toActionError(erased.error, "Test data could not be erased."));
  }
  const result = erased.data as { deleted?: unknown } | null;
  const counts = parseTestDataEraseCounts(result?.deleted);
  if (!counts) {
    return actionError(
      "Test data erase returned an unexpected result. Check the audit log before trying again.",
    );
  }
  revalidatePath("/admin/settings/store");
  revalidateStorefrontLayout();
  const erasedParts: string[] = [];
  if (counts.orders > 0) erasedParts.push(`${counts.orders} orders`);
  if (counts.payment_submissions > 0)
    erasedParts.push(`${counts.payment_submissions} payment records`);
  if (counts.product_reviews > 0)
    erasedParts.push(`${counts.product_reviews} reviews`);
  if (counts.coupons > 0) erasedParts.push(`${counts.coupons} coupons`);
  if (counts.banners > 0) erasedParts.push(`${counts.banners} banners`);
  if (counts.checkout_sessions > 0)
    erasedParts.push(`${counts.checkout_sessions} checkout sessions`);
  return actionOk(
    erasedParts.length > 0
      ? `Erased ${erasedParts.join(", ")}.`
      : "Nothing to erase — all counts were already zero.",
  );
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
  revalidateStorefrontLayout();
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
  revalidateStorefrontLayout();
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
  revalidateStorefrontLayout();
  return actionOk("Image uploaded and saved.");
}

const BRAND_IMAGE_REMOVED_MESSAGES: Record<string, string> = {
  logo: "Logo removed.",
  favicon: "Favicon removed.",
  social: "Social sharing image removed.",
};

export async function clearBrandImage(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const kind = formText(form, "kind");
  const key = BRAND_IMAGE_KEYS[kind];
  if (!key) return actionError("Unknown image type.");
  const saved = await setSetting(session.client, key, "");
  if (saved.error) return actionError(saved.error);
  revalidatePath("/admin/settings/theme");
  revalidatePath("/admin/marketing/seo");
  revalidateStorefrontLayout();
  return actionOk(BRAND_IMAGE_REMOVED_MESSAGES[kind] ?? "Image removed.");
}

// ---------------------------------------------------------------------------
// Marketing integrations (Admin Panel v2, item 9)
// ---------------------------------------------------------------------------

export async function saveMarketingSettings(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const events: PixelEventsConfig = {
    PageView: false,
    ViewContent: false,
    AddToCart: false,
    InitiateCheckout: false,
    Purchase: false,
  };
  for (const event of PIXEL_EVENTS) {
    events[event] = form.get(`pixel_${event}`) === "on";
  }
  const parsed = MARKETING_SETTINGS_SCHEMA.safeParse({
    meta_pixel_id: formText(form, "meta_pixel_id"),
    meta_pixel_events: events,
    ga_measurement_id: formText(form, "ga_measurement_id"),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(
      first?.message ?? "Check the marketing fields and try again.",
    );
  }
  const entries: [SettingKey, unknown][] = [
    ["meta_pixel_id", parsed.data.meta_pixel_id],
    ["meta_pixel_events", parsed.data.meta_pixel_events],
    ["ga_measurement_id", parsed.data.ga_measurement_id],
  ];
  for (const [key, value] of entries) {
    const saved = await setSetting(session.client, key, value);
    if (saved.error) return actionError(saved.error);
  }
  revalidatePath("/admin/marketing/promotions");
  revalidateStorefrontLayout();
  return actionOk("Marketing settings saved.");
}

/**
 * Save owner-only custom header/footer code. Enforced at three layers:
 * the settings area is owner-only, this action re-checks isOwner, and the
 * RPC requires an owner row in user_roles. Empty code clears the slot.
 * The code is stored verbatim and rendered on every storefront page, so
 * the UI carries a plain-language risk note and this action never
 * sanitises or "fixes" the input (that would silently change behaviour).
 */
export async function saveCustomCode(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  if (!isOwner(session)) {
    return actionError("Only the owner can save custom code.");
  }
  const parsed = CUSTOM_CODE_SCHEMA.safeParse({
    custom_head_code: formText(form, "custom_head_code"),
    custom_body_code: formText(form, "custom_body_code"),
  });
  if (!parsed.success) {
    return actionError("Custom code must be at most 20,000 characters per slot.");
  }
  for (const key of ["custom_head_code", "custom_body_code"] as const) {
    const result = await session.client.rpc("admin_set_custom_code", {
      p_key: key,
      p_value: parsed.data[key],
    });
    if (result.error) {
      return actionError(
        toActionError(result.error, "Custom code could not be saved."),
      );
    }
  }
  revalidatePath("/admin/marketing/promotions");
  revalidateStorefrontLayout();
  return actionOk("Custom code saved. It runs on every storefront page.");
}

// ---------------------------------------------------------------------------
// Extended SEO (Admin Panel v2, item 11) + general display (item 12)
// ---------------------------------------------------------------------------

export async function saveSeoExtendedSettings(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const twitterCard = formText(form, "seo_twitter_card");
  const parsed = SEO_EXTENDED_SCHEMA.safeParse({
    seo_keywords: formText(form, "seo_keywords"),
    seo_og_title: formText(form, "seo_og_title"),
    seo_og_description: formText(form, "seo_og_description"),
    seo_og_image_url: formText(form, "seo_og_image_url"),
    seo_twitter_card:
      (TWITTER_CARDS as readonly string[]).includes(twitterCard)
        ? twitterCard
        : "summary_large_image",
    seo_canonical_base_url: formText(form, "seo_canonical_base_url"),
    seo_robots: {
      index: form.get("seo_robots_index") === "on",
      follow: form.get("seo_robots_follow") === "on",
    },
    seo_sitemap: {
      includeShop: form.get("seo_sitemap_shop") === "on",
      includeCategories: form.get("seo_sitemap_categories") === "on",
      includePolicies: form.get("seo_sitemap_policies") === "on",
      includeProducts: form.get("seo_sitemap_products") === "on",
    },
    google_search_console_verification: formText(
      form,
      "google_search_console_verification",
    ),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(
      first?.message ?? "Check the SEO fields and try again.",
    );
  }
  const entries: [SettingKey, unknown][] = [
    ["seo_keywords", parsed.data.seo_keywords],
    ["seo_og_title", parsed.data.seo_og_title],
    ["seo_og_description", parsed.data.seo_og_description],
    ["seo_og_image_url", parsed.data.seo_og_image_url],
    ["seo_twitter_card", parsed.data.seo_twitter_card],
    ["seo_canonical_base_url", parsed.data.seo_canonical_base_url],
    ["seo_robots", parsed.data.seo_robots],
    ["seo_sitemap", parsed.data.seo_sitemap],
    [
      "google_search_console_verification",
      parsed.data.google_search_console_verification,
    ],
  ];
  for (const [key, value] of entries) {
    const saved = await setSetting(session.client, key, value);
    if (saved.error) return actionError(saved.error);
  }
  revalidatePath("/admin/marketing/seo");
  revalidateStorefrontLayout();
  return actionOk("SEO settings saved.");
}

export async function saveGeneralDisplaySettings(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const threshold = parseLowStockThreshold(formText(form, "low_stock_threshold"));
  const parsed = GENERAL_DISPLAY_SCHEMA.safeParse({
    display_currency: formText(form, "display_currency"),
    display_timezone: formText(form, "display_timezone"),
    low_stock_threshold: threshold ?? -1,
  });
  if (!parsed.success) {
    return actionError("Enter a currency, a timezone and a threshold of 0–999.");
  }
  const entries: [SettingKey, unknown][] = [
    ["display_currency", parsed.data.display_currency],
    ["display_timezone", parsed.data.display_timezone],
    ["low_stock_threshold", parsed.data.low_stock_threshold],
  ];
  for (const [key, value] of entries) {
    const saved = await setSetting(session.client, key, value);
    if (saved.error) return actionError(saved.error);
  }
  revalidatePath("/admin/settings/general");
  return actionOk("General settings saved.");
}
