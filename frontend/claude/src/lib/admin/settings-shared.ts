import { z } from "zod";
import { parseGoogleVerification } from "@/lib/seo";
import { DIVISIONS, districtLabel, divisionLabel, isDistrict } from "@/data/bangladesh";

/**
 * Pure settings helpers and schemas shared by server code, client forms, and
 * tests. This module must stay free of "server-only" and "use server" code:
 * client components import it directly, which would be a build error if it
 * contained inline Server Actions.
 */

/**
 * Setting-key allowlist. The first 17 keys come from migration
 * 20261115000500. The rest are added by migration
 * 20261115001100_admin_v2_marketing_settings.sql, which extends both the
 * public-read policy (public-safe keys only) and admin_set_setting, plus
 * google_search_console_verification from migration 20261119000400
 * (same two places), plus the delivery-zone keys from migration
 * 20261122000100 (same two places). SMS settings were removed: no provider was ever
 * connected and nothing was sent, so sms_provider / sms_sender_id /
 * sms_enabled are deliberately NOT setting keys any more.
 */
export const SETTING_KEYS = [
  "announcement_bar",
  "store_name",
  "contact_phone",
  "contact_email",
  "contact_address",
  "whatsapp_number",
  "social_facebook",
  "social_instagram",
  "social_youtube",
  "social_tiktok",
  "footer_about",
  "seo_default_title",
  "seo_default_description",
  "seo_social_image_path",
  "seo_page_overrides",
  "logo_storage_path",
  "favicon_storage_path",
  // Admin Panel v2 — marketing integrations (migration 011).
  "meta_pixel_id",
  "meta_pixel_events",
  "ga_measurement_id",
  "custom_head_code",
  "custom_body_code",
  // Admin Panel v2 — extended SEO (migration 011).
  "seo_keywords",
  "seo_og_title",
  "seo_og_description",
  "seo_og_image_url",
  "seo_twitter_card",
  "seo_canonical_base_url",
  "seo_robots",
  "seo_sitemap",
  // SEO follow-up M-B (migration 20261119000400).
  "google_search_console_verification",
  // Admin Panel v2 — general display settings (migration 011).
  "display_currency",
  "display_timezone",
  "low_stock_threshold",
  // Delivery zones (migration 20261122000100): the admin-selected inside
  // district and both charges, in minor units for the charges.
  "delivery_inside_district",
  "delivery_inside_charge_minor",
  "delivery_outside_charge_minor",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export function isSettingKey(value: unknown): value is SettingKey {
  return (
    typeof value === "string" &&
    (SETTING_KEYS as readonly string[]).includes(value)
  );
}

export const ANNOUNCEMENT_SCHEMA = z.object({
  text: z.string().trim().min(1).max(200),
  visible: z.boolean(),
});

export const STORE_SETTINGS_SCHEMA = z.object({
  store_name: z.string().trim().min(1).max(120),
  contact_phone: z.string().trim().max(40),
  contact_email: z.string().trim().max(254),
  contact_address: z.string().trim().max(500),
  whatsapp_number: z.string().trim().max(20),
  social_facebook: z.string().trim().max(500),
  social_instagram: z.string().trim().max(500),
  social_youtube: z.string().trim().max(500),
  social_tiktok: z.string().trim().max(500),
  footer_about: z.string().trim().max(1000),
});

const SOCIAL_URL = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value === "" || /^https?:\/\//.test(value),
    "Social links must start with http:// or https://.",
  );

export const STORE_SETTINGS_VALIDATED = STORE_SETTINGS_SCHEMA.extend({
  contact_email: z
    .string()
    .trim()
    .max(254)
    .refine(
      (value) => value === "" || z.email().safeParse(value).success,
      "Enter a valid email address.",
    ),
  whatsapp_number: z
    .string()
    .trim()
    .max(20)
    .refine(
      (value) => value === "" || /^\+?[0-9]{8,15}$/.test(value),
      "Enter digits only, optionally starting with +.",
    ),
  social_facebook: SOCIAL_URL,
  social_instagram: SOCIAL_URL,
  social_youtube: SOCIAL_URL,
  social_tiktok: SOCIAL_URL,
});

export const SEO_PAGE_SLUGS = ["home", "shop", "about", "contact"] as const;
export type SeoPageSlug = (typeof SEO_PAGE_SLUGS)[number];

export const SEO_DEFAULTS_SCHEMA = z.object({
  seo_default_title: z.string().trim().max(200),
  seo_default_description: z.string().trim().max(500),
  seo_page_overrides: z.record(
    z.enum(SEO_PAGE_SLUGS),
    z.object({
      title: z.string().trim().max(200),
      description: z.string().trim().max(500),
    }),
  ),
});

export type StoreSettingsMap = Record<string, unknown>;

export function settingString(
  settings: StoreSettingsMap | null | undefined,
  key: SettingKey,
): string {
  const value = settings?.[key];
  return typeof value === "string" ? value : "";
}

/** Read a stored setting as an integer, or null when absent/not an integer. */
export function settingNumber(
  settings: StoreSettingsMap | null | undefined,
  key: SettingKey,
): number | null {
  const value = settings?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Delivery zones (migration 20261122000100)
// ---------------------------------------------------------------------------

/**
 * Delivery settings form values. Charges are whole taka in the form
 * (the admin thinks in taka); the save action stores minor units.
 * The inside district must be one of Bangladesh's 64 districts.
 */
export const DELIVERY_SETTINGS_SCHEMA = z.object({
  delivery_inside_district: z
    .string()
    .trim()
    .refine((value) => isDistrict(value), "Choose one of the 64 districts."),
  delivery_inside_charge_taka: z.number().int().min(0).max(10000),
  delivery_outside_charge_taka: z.number().int().min(0).max(10000),
});

export type DeliverySettingsFormValues = z.infer<typeof DELIVERY_SETTINGS_SCHEMA>;

/**
 * Flat district options for the admin district select. Every option carries
 * its division — "Dinajpur (দিনাজপুর) — Rangpur (রংপুর)" — so the native
 * select renders all 64 rows uniformly aligned. The previous optgroup
 * version rendered division names as bare flush-left headers (no Bangla,
 * no radio) while district rows were indented with radios, which looked
 * misaligned on phones; a division name also doubles as a district name
 * (Rangpur, Sylhet, Mymensingh…), so a header row could be mistaken for
 * a selectable district. Division names now never appear as a row of
 * their own. Values stay the plain English district names.
 */
export function deliveryDistrictOptions(): { value: string; label: string }[] {
  return Object.entries(DIVISIONS).flatMap(([division, districts]) =>
    districts.map((district) => ({
      value: district,
      label: `${districtLabel(district)} — ${divisionLabel(division)}`,
    })),
  );
}

// ---------------------------------------------------------------------------
// Test data erase (migration 20261123000100)
// ---------------------------------------------------------------------------

/**
 * Counts returned by admin_test_data_erase_counts (and by the erase
 * itself under `deleted`). Every key is a row count. Products,
 * customer accounts and visitor data are NOT in this list: the erase
 * never touches them, so there is nothing to count.
 */
const TEST_DATA_ERASE_COUNTS_SCHEMA = z.object({
  orders: z.number().int().nonnegative(),
  order_items: z.number().int().nonnegative(),
  payment_submissions: z.number().int().nonnegative(),
  order_shipments: z.number().int().nonnegative(),
  courier_booking_claims: z.number().int().nonnegative(),
  coupon_redemptions: z.number().int().nonnegative(),
  checkout_sessions: z.number().int().nonnegative(),
  checkout_items: z.number().int().nonnegative(),
  abandoned_recovery_log: z.number().int().nonnegative(),
  checkout_rate_events: z.number().int().nonnegative(),
  product_reviews: z.number().int().nonnegative(),
  review_moderation_log: z.number().int().nonnegative(),
  coupons: z.number().int().nonnegative(),
  banners: z.number().int().nonnegative(),
});

export type TestDataEraseCounts = z.infer<typeof TEST_DATA_ERASE_COUNTS_SCHEMA>;

/** Parse the erase counts RPC result; null when absent or malformed. */
export function parseTestDataEraseCounts(
  value: unknown,
): TestDataEraseCounts | null {
  const parsed = TEST_DATA_ERASE_COUNTS_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Setting keys that only an owner may write (enforced by RPC + action). */
export const OWNER_ONLY_SETTING_KEYS: readonly SettingKey[] = [
  "custom_head_code",
  "custom_body_code",
];

export function isOwnerOnlySettingKey(key: string): boolean {
  return (OWNER_ONLY_SETTING_KEYS as readonly string[]).includes(key);
}

/** Maximum stored length for one custom-code slot (head or footer). */
export const MAX_CUSTOM_CODE_LENGTH = 20000;

// ---------------------------------------------------------------------------
// Marketing integrations (Admin Panel v2, item 9)
// ---------------------------------------------------------------------------

export const PIXEL_EVENTS = [
  "PageView",
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
  "Purchase",
] as const;
export type PixelEventName = (typeof PIXEL_EVENTS)[number];

export type PixelEventsConfig = Record<PixelEventName, boolean>;

export const PIXEL_EVENTS_SCHEMA = z.object({
  PageView: z.boolean(),
  ViewContent: z.boolean(),
  AddToCart: z.boolean(),
  InitiateCheckout: z.boolean(),
  Purchase: z.boolean(),
});

/** Parse a stored meta_pixel_events value; null when absent or malformed. */
export function parsePixelEvents(value: unknown): PixelEventsConfig | null {
  const parsed = PIXEL_EVENTS_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const META_PIXEL_ID_PATTERN = /^\d{5,20}$/;
export const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;

export const MARKETING_SETTINGS_SCHEMA = z.object({
  meta_pixel_id: z
    .string()
    .trim()
    .max(20)
    .refine(
      (value) => value === "" || META_PIXEL_ID_PATTERN.test(value),
      "Enter the numeric Meta Pixel ID (5–20 digits).",
    ),
  meta_pixel_events: PIXEL_EVENTS_SCHEMA,
  ga_measurement_id: z
    .string()
    .trim()
    .max(24)
    .refine(
      (value) => value === "" || GA_MEASUREMENT_ID_PATTERN.test(value),
      "Enter a measurement ID like G-XXXXXXXXXX.",
    ),
});

export const CUSTOM_CODE_SCHEMA = z.object({
  custom_head_code: z.string().max(MAX_CUSTOM_CODE_LENGTH),
  custom_body_code: z.string().max(MAX_CUSTOM_CODE_LENGTH),
});

// ---------------------------------------------------------------------------
// Extended SEO (Admin Panel v2, item 11)
// ---------------------------------------------------------------------------

export const TWITTER_CARDS = ["summary", "summary_large_image"] as const;
export type TwitterCard = (typeof TWITTER_CARDS)[number];

const HTTP_URL = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value === "" || /^https?:\/\//.test(value),
    "Enter a full URL starting with http:// or https://.",
  );

export const SEO_ROBOTS_SCHEMA = z.object({
  index: z.boolean(),
  follow: z.boolean(),
});
export type SeoRobotsConfig = z.infer<typeof SEO_ROBOTS_SCHEMA>;

/**
 * Sitemap inclusion toggles, honoured by the live sitemap route
 * (src/app/sitemap.ts) on the production store. Preview deployments
 * always serve an empty sitemap regardless of these choices.
 */
export const SEO_SITEMAP_SCHEMA = z.object({
  includeShop: z.boolean(),
  includeCategories: z.boolean(),
  includePolicies: z.boolean(),
  includeProducts: z.boolean(),
});
export type SeoSitemapConfig = z.infer<typeof SEO_SITEMAP_SCHEMA>;

export function parseSeoRobots(value: unknown): SeoRobotsConfig | null {
  const parsed = SEO_ROBOTS_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSeoSitemap(value: unknown): SeoSitemapConfig | null {
  const parsed = SEO_SITEMAP_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const SEO_EXTENDED_SCHEMA = z.object({
  seo_keywords: z.string().trim().max(500),
  seo_og_title: z.string().trim().max(200),
  seo_og_description: z.string().trim().max(500),
  seo_og_image_url: HTTP_URL,
  seo_twitter_card: z.enum(TWITTER_CARDS),
  seo_canonical_base_url: HTTP_URL,
  seo_robots: SEO_ROBOTS_SCHEMA,
  seo_sitemap: SEO_SITEMAP_SCHEMA,
  /**
   * Search Console verification token (M-B). Same rules as the render
   * path (parseGoogleVerification in lib/seo): trimmed, <=500 chars, no
   * whitespace or markup; empty clears it. The DB allowlist enforces
   * the same rules (migration 20261119000400) — saving fails there
   * until that migration is applied.
   */
  google_search_console_verification: z
    .string()
    .trim()
    .max(500)
    .refine(
      (value) => value === "" || parseGoogleVerification(value) !== null,
      "Enter the Google Search Console verification token (no spaces or markup).",
    ),
});

// ---------------------------------------------------------------------------
// General display settings (Admin Panel v2, item 12 — light set)
// ---------------------------------------------------------------------------

/**
 * Display-only general settings. These labels are shown in the admin and
 * stored for future display use; they do not change prices, dates or
 * checkout behaviour. Deliberately absent: tax, shipping, payment,
 * language and date-format settings (no such behaviour exists to
 * configure). The low-stock threshold is a display value only: inventory
 * low-stock flags come from the inventory table, not this setting.
 */
export const GENERAL_DISPLAY_SCHEMA = z.object({
  display_currency: z.string().trim().min(1).max(12),
  display_timezone: z.string().trim().min(1).max(64),
  low_stock_threshold: z.number().int().min(0).max(999),
});

export function parseLowStockThreshold(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 999) {
    return value;
  }
  if (typeof value === "string" && /^\d{1,3}$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}
