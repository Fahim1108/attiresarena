import { z } from "zod";

/**
 * Pure settings helpers and schemas shared by server code, client forms, and
 * tests. This module must stay free of "server-only" and "use server" code:
 * client components import it directly, which would be a build error if it
 * contained inline Server Actions.
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
