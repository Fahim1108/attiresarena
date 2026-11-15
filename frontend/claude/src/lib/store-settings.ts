import "server-only";

import type { PolicyPage } from "@/content/policies";
import type {
  Banner,
  FooterSettings,
  HeaderSettings,
  HeroSettings,
} from "@/types";
import { publicSupabaseConfiguration } from "./supabase-public";

/**
 * Fallback-safe storefront settings reader.
 *
 * Reads the public-safe rows (visible content blocks / banners and the
 * allowlisted store_settings keys) through the publishable client over
 * REST, server-side only, with `cache: "no-store"` so an admin save
 * applies on the next page load. ANY failure — missing configuration,
 * network error, non-OK response, malformed row — yields null/empty, and
 * every merge below then returns the static config unchanged (same
 * reference), so the storefront renders exactly as before.
 *
 * Wiring status (see the build report): only the policy pages call this
 * reader today. The announcement bar, hero slides and footer flow through
 * the services adapter and the root layout, which this module must not
 * touch; their pure merge functions are provided and tested here so the
 * wiring can land without changing this reader.
 */

export interface ContentBlockRow {
  slug: string;
  title: string | null;
  body: string;
  image_storage_path: string | null;
  sort_position: number;
  visible: boolean;
  updated_at: string;
}

export interface BannerRow {
  id: string;
  title: string;
  subtitle: string | null;
  image_storage_path: string;
  link_url: string | null;
  sort_position: number;
  visible: boolean;
  placement: "hero" | "promo";
}

export interface StorefrontContent {
  settings: Record<string, unknown>;
  blocks: ContentBlockRow[];
  banners: BannerRow[];
}

async function readRows(path: string): Promise<unknown[]> {
  const config = publicSupabaseConfiguration();
  if (!config) return [];
  try {
    const response = await fetch(`${config.url}${path}`, {
      headers: {
        apikey: config.key,
        ...(config.key.startsWith("eyJ")
          ? { Authorization: `Bearer ${config.key}` }
          : {}),
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const result: unknown = await response.json();
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBlocks(rows: unknown[]): ContentBlockRow[] {
  const blocks: ContentBlockRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (
      typeof row.slug !== "string" ||
      typeof row.body !== "string" ||
      typeof row.visible !== "boolean" ||
      typeof row.updated_at !== "string"
    ) {
      continue;
    }
    blocks.push({
      slug: row.slug,
      title: typeof row.title === "string" ? row.title : null,
      body: row.body,
      image_storage_path:
        typeof row.image_storage_path === "string"
          ? row.image_storage_path
          : null,
      sort_position:
        typeof row.sort_position === "number" ? row.sort_position : 0,
      visible: row.visible,
      updated_at: row.updated_at,
    });
  }
  return blocks;
}

function parseBanners(rows: unknown[]): BannerRow[] {
  const banners: BannerRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (
      typeof row.id !== "string" ||
      typeof row.title !== "string" ||
      typeof row.image_storage_path !== "string" ||
      typeof row.visible !== "boolean" ||
      (row.placement !== "hero" && row.placement !== "promo")
    ) {
      continue;
    }
    banners.push({
      id: row.id,
      title: row.title,
      subtitle: typeof row.subtitle === "string" ? row.subtitle : null,
      image_storage_path: row.image_storage_path,
      link_url: typeof row.link_url === "string" ? row.link_url : null,
      sort_position:
        typeof row.sort_position === "number" ? row.sort_position : 0,
      visible: row.visible,
      placement: row.placement,
    });
  }
  return banners;
}

function parseSettings(rows: unknown[]): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (typeof row.key !== "string" || !("value" in row)) continue;
    settings[row.key] = row.value;
  }
  return settings;
}

export async function getStorefrontContent(): Promise<StorefrontContent | null> {
  if (!publicSupabaseConfiguration()) return null;
  const [settingRows, blockRows, bannerRows] = await Promise.all([
    readRows("/rest/v1/store_settings?select=key,value"),
    readRows(
      "/rest/v1/content_blocks?select=slug,title,body,image_storage_path,sort_position,visible,updated_at&visible=eq.true&order=sort_position.asc",
    ),
    readRows(
      "/rest/v1/banners?select=id,title,subtitle,image_storage_path,link_url,sort_position,visible,placement&visible=eq.true&order=sort_position.asc",
    ),
  ]);
  return {
    settings: parseSettings(settingRows),
    blocks: parseBlocks(blockRows),
    banners: parseBanners(bannerRows),
  };
}

/** Visible content blocks only (used by the policy pages). Empty on failure. */
export async function getVisibleContentBlocks(): Promise<ContentBlockRow[]> {
  const rows = await readRows(
    "/rest/v1/content_blocks?select=slug,title,body,image_storage_path,sort_position,visible,updated_at&visible=eq.true&order=sort_position.asc",
  );
  return parseBlocks(rows);
}

/** Read a stored setting as trimmed text; null when absent or not text. */
export function settingText(
  settings: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = settings?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Policy-page override. Returns the static page unchanged (same reference)
 * when no visible block matches the page slug or the block body is empty.
 * When a block matches, its paragraphs (blank-line separated) replace the
 * static sections under a single section headed by the block title, and
 * the "last updated" date comes from the block.
 */
export function resolvePolicyPage(
  page: PolicyPage,
  blocks: ContentBlockRow[] | null | undefined,
): PolicyPage {
  const block = blocks?.find((b) => b.slug === page.slug && b.visible);
  if (!block) return page;
  const paragraphs = block.body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return page;
  const updated = block.updated_at.slice(0, 10);
  return {
    ...page,
    title: block.title?.trim() ? block.title.trim() : page.title,
    sections: [
      {
        heading: block.title?.trim() ? block.title.trim() : page.title,
        body: paragraphs,
      },
    ],
    updated: /^\d{4}-\d{2}-\d{2}$/.test(updated) ? updated : page.updated,
  };
}

export interface AnnouncementBarValue {
  text: string;
  visible: boolean;
}

export function parseAnnouncementBar(
  value: unknown,
): AnnouncementBarValue | null {
  if (!isRecord(value)) return null;
  if (typeof value.text !== "string" || typeof value.visible !== "boolean") {
    return null;
  }
  const text = value.text.trim();
  if (!text) return null;
  return { text, visible: value.visible };
}

/**
 * Announcement-bar override (NOT YET WIRED — see module header). The stored
 * text replaces the bar's left message and `visible` controls the bar.
 * Returns the static header unchanged when no valid value is stored.
 */
export function applyAnnouncementOverride(
  header: HeaderSettings,
  settings: Record<string, unknown> | null | undefined,
): HeaderSettings {
  const override = parseAnnouncementBar(settings?.["announcement_bar"]);
  if (!override) return header;
  return {
    ...header,
    announcement: {
      ...header.announcement,
      enabled: override.visible,
      left: override.text,
    },
  };
}

/**
 * Footer override (NOT YET WIRED — see module header). Stored contact
 * details, social links and footer text replace the static values field
 * by field; anything not stored keeps the static value. Social links only
 * replace when they are valid http(s) URLs. Returns the static footer
 * unchanged when nothing applies.
 */
export function applyFooterOverride(
  footer: FooterSettings,
  settings: Record<string, unknown> | null | undefined,
): FooterSettings {
  const phone = settingText(settings, "contact_phone");
  const email = settingText(settings, "contact_email");
  const address = settingText(settings, "contact_address");
  const about = settingText(settings, "footer_about");
  const socials: Record<string, string | null> = {
    facebook: settingText(settings, "social_facebook"),
    instagram: settingText(settings, "social_instagram"),
    youtube: settingText(settings, "social_youtube"),
    tiktok: settingText(settings, "social_tiktok"),
  };
  const hasSocial = Object.values(socials).some(
    (href) => href !== null && /^https?:\/\//.test(href),
  );
  if (!phone && !email && !address && !about && !hasSocial) return footer;
  return {
    ...footer,
    tagline: about ?? footer.tagline,
    contact: {
      ...footer.contact,
      phone: phone ?? footer.contact.phone,
      email: email ?? footer.contact.email,
      address: address ?? footer.contact.address,
    },
    social: footer.social.map((link) => {
      const href = socials[link.network];
      if (href !== null && href !== undefined && /^https?:\/\//.test(href)) {
        return { ...link, href };
      }
      return link;
    }),
  };
}

/**
 * Hero-slide override (NOT YET WIRED — see module header). Visible hero
 * banners, in stored order, replace the static slides. Banner images live
 * in a private Storage bucket, so the caller must supply a resolver that
 * turns a storage path into a displayable URL; banners without a URL are
 * skipped. Returns the static hero unchanged when no banner resolves.
 */
export function applyHeroOverride(
  hero: HeroSettings,
  banners: BannerRow[] | null | undefined,
  imageUrl: (storagePath: string) => string | null,
): HeroSettings {
  const slides: Banner[] = [];
  for (const banner of banners ?? []) {
    if (!banner.visible || banner.placement !== "hero") continue;
    const src = imageUrl(banner.image_storage_path);
    if (!src) continue;
    slides.push({
      id: banner.id,
      title: banner.title,
      subtitle: banner.subtitle ?? undefined,
      cta: banner.link_url
        ? { label: "Shop Now", href: banner.link_url }
        : undefined,
      image: { src, alt: banner.title },
      align: "left",
      tone: "light",
    });
  }
  if (slides.length === 0) return hero;
  return { ...hero, slides };
}
