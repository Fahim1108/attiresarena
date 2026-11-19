import "server-only";

import type { Metadata } from "next";
import type { PolicyPage } from "@/content/policies";
import {
  GA_MEASUREMENT_ID_PATTERN,
  MAX_CUSTOM_CODE_LENGTH,
  META_PIXEL_ID_PATTERN,
  parsePixelEvents,
  parseSeoRobots,
  type PixelEventsConfig,
} from "./admin/settings-shared";
import {
  isProductionEnv,
  parseGoogleVerification,
  resolveCanonicalBase,
  resolveDefaultOgImage,
  resolveGlobalKeywords,
  resolveIndexingPolicy,
  SEO_OG_LOCALE,
  type SeoEnv,
} from "./seo";
import type {
  Banner,
  Category,
  FooterSettings,
  HeaderSettings,
  HeroSettings,
} from "@/types";
import { publicSupabaseConfiguration } from "./supabase-public";
import { isCatalogStoragePath } from "./admin/catalog-variants";
import {
  DEFAULT_ERROR_404,
  activeWidgets,
  parseWidgetRow,
  resolveErrorPage,
  type ErrorPageConfig,
  type Widget,
} from "./admin/reference-adapt";

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
 * Wiring status: the policy pages call this reader, and the root layout
 * calls it for marketing/metadata and applies the footer override below
 * to the storefront settings. The announcement bar and hero slides still
 * flow through the services adapter, which this module must not touch;
 * their pure merge functions are provided and tested here so the wiring
 * can land without changing this reader.
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

/**
 * Active homepage widgets for the storefront countdown slot. The public
 * RLS policy returns active rows only; expiry and ordering are applied
 * here. Empty on any failure, so the homepage renders exactly as before
 * when no widget is active.
 */
export async function getActiveHomepageWidgets(nowMs: number = Date.now()): Promise<Widget[]> {
  const rows = await readRows(
    "/rest/v1/homepage_widgets?select=id,title,type,placement,title_visible,title_alignment,title_size,subtitle,ends_at,offer_title,discount_text,style_theme,use_theme_color,background_color,accent_color,title_color,content_color,sort_position,active,created_at,updated_at&active=eq.true&order=sort_position.asc,created_at.asc",
  );
  const widgets: Widget[] = [];
  for (const row of rows) {
    const widget = parseWidgetRow(row);
    if (widget) widgets.push(widget);
  }
  return activeWidgets(widgets, nowMs);
}

/**
 * Stored 404 page copy, or the built-in default (same reference) when
 * nothing is stored or the read fails. The storefront 404 page renders
 * byte-identically when unconfigured.
 */
export async function getErrorPage404(): Promise<ErrorPageConfig> {
  const rows = await readRows(
    "/rest/v1/layout_settings?select=value&key=eq.error_404",
  );
  const first = rows[0];
  if (!isRecord(first) || !("value" in first)) return DEFAULT_ERROR_404;
  return resolveErrorPage(first.value);
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

// ---------------------------------------------------------------------------
// Published categories (Admin Panel v2, categories wiring)
// ---------------------------------------------------------------------------

/**
 * One row of public.categories as the storefront reads it: same
 * public-safe pattern as getStorefrontContent (publishable REST client,
 * `cache: "no-store"`, empty on any failure). The anon RLS policy
 * `category_public` returns published rows only, so an unpublished row
 * is indistinguishable from a missing one over this read — the merge
 * below therefore never hides a static category on unpublish alone.
 */
export interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  published: boolean;
  description: string;
  image_storage_path: string | null;
  banner_storage_path: string | null;
  seo_title: string | null;
  seo_description: string | null;
  sort_position: number;
}

const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function nonBlankText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Validate one categories row; null when malformed (never throws). */
export function parseCategoryRow(value: unknown): CategoryRow | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : null;
  const slug = typeof value.slug === "string" ? value.slug : null;
  const name = nonBlankText(value.name);
  if (!id || !slug || !CATEGORY_SLUG_PATTERN.test(slug) || !name) return null;
  const parentId = value.parent_id ?? null;
  if (parentId !== null && typeof parentId !== "string") return null;
  if (typeof value.published !== "boolean") return null;
  if (typeof value.description !== "string") return null;
  if (
    typeof value.sort_position !== "number" ||
    !Number.isInteger(value.sort_position)
  )
    return null;
  const image = value.image_storage_path ?? null;
  const banner = value.banner_storage_path ?? null;
  if (image !== null && typeof image !== "string") return null;
  if (banner !== null && typeof banner !== "string") return null;
  const seoTitle = value.seo_title ?? null;
  const seoDescription = value.seo_description ?? null;
  if (seoTitle !== null && typeof seoTitle !== "string") return null;
  if (seoDescription !== null && typeof seoDescription !== "string") return null;
  return {
    id,
    parent_id: parentId,
    name,
    slug,
    published: value.published,
    description: value.description,
    image_storage_path: image,
    banner_storage_path: banner,
    seo_title: seoTitle,
    seo_description: seoDescription,
    sort_position: value.sort_position,
  };
}

export function parseCategoryRows(rows: unknown[]): CategoryRow[] {
  const parsed: CategoryRow[] = [];
  for (const row of rows) {
    const category = parseCategoryRow(row);
    if (category) parsed.push(category);
  }
  return parsed;
}

/**
 * Published categories for the storefront. Empty on any failure, so the
 * caller falls back to the static config unchanged.
 */
export async function getPublishedCategories(): Promise<CategoryRow[]> {
  const rows = await readRows(
    "/rest/v1/categories?select=id,parent_id,name,slug,published,description,image_storage_path,banner_storage_path,seo_title,seo_description,sort_position&published=eq.true&order=sort_position.asc,created_at.asc",
  );
  return parseCategoryRows(rows).filter((row) => row.published);
}

/**
 * Display URL for a stored category image/banner, or null when the path
 * is not a valid catalog storage path. Served by /api/product-media,
 * which only releases objects the published-category media policy
 * allows — migration 20261119001000 (authored, NOT applied). Promoting
 * this wiring without applying that migration breaks category photos
 * for rows that have a stored image (the URL 404s); the static photo
 * is kept only for rows with no stored image.
 */
export function categoryMediaUrl(
  storagePath: string | null | undefined,
): string | null {
  if (!storagePath || !isCatalogStoragePath(storagePath)) return null;
  return `/api/product-media/${storagePath}`;
}

/**
 * Merge published DB categories over the static config.
 *
 * - Returns the static list unchanged (same reference) when no
 *   published row is given, so a failed or empty read renders exactly
 *   as before.
 * - A DB row matching a static slug overrides name, description, SEO
 *   and photo/banner — but NEVER the static `id`: product filtering
 *   and the size guide key off the static ids, and admin products keep
 *   their DB category UUID as categoryId, so swapping ids would break
 *   /category/* matching (see catalog-publication.ts).
 * - A DB row with a new slug is appended as a real category with the
 *   DB uuid as id, so products assigned to it can match it in filters.
 *   With no stored photo it uses the generic category illustration
 *   until a photo is added in admin.
 * - Description: the stored text wins when non-blank; otherwise the
 *   previous storefront wording is kept ("Individual thrift shirts…"
 *   for Shirts, "Coming soon." for everything else).
 * - Order is depth-first by parent (top-level rows by sort_position,
 *   each followed by its children); a row whose parent is not among
 *   the published rows is treated as top-level. Static categories
 *   with no DB row keep their relative order after the DB-driven
 *   ones. sortOrder is reassigned sequentially in final order.
 * - Unpublished rows are ignored here (and invisible to the anon
 *   read anyway): unpublishing a category that also exists in the
 *   static config does NOT remove it from the shop — that needs a
 *   follow-up read that can see unpublished rows.
 */
export function mergeDbCategories(
  staticCategories: Category[],
  dbRows: CategoryRow[],
): Category[] {
  // Re-validate: the merge must never trust an unparsed row (bad slugs,
  // missing names) even when called outside getPublishedCategories.
  const rows = dbRows.flatMap((value) => {
    const parsed = parseCategoryRow(value);
    return parsed && parsed.published ? [parsed] : [];
  });
  if (rows.length === 0) return staticCategories;
  const bySlug = new Map<string, CategoryRow>();
  const byId = new Map<string, CategoryRow>();
  for (const row of rows) {
    if (!bySlug.has(row.slug)) bySlug.set(row.slug, row);
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  const children = new Map<string, CategoryRow[]>();
  const roots: CategoryRow[] = [];
  for (const row of rows) {
    const parent =
      row.parent_id !== null ? byId.get(row.parent_id) : undefined;
    if (parent) {
      const list = children.get(parent.id) ?? [];
      list.push(row);
      children.set(parent.id, list);
    } else {
      roots.push(row);
    }
  }
  const byPosition = (a: CategoryRow, b: CategoryRow) =>
    a.sort_position - b.sort_position || a.name.localeCompare(b.name);
  roots.sort(byPosition);
  for (const list of children.values()) list.sort(byPosition);
  const ordered: CategoryRow[] = [];
  const visit = (row: CategoryRow) => {
    ordered.push(row);
    for (const child of children.get(row.id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);

  const merged: Category[] = [];
  const usedSlugs = new Set<string>();
  for (const row of ordered) {
    if (usedSlugs.has(row.slug)) continue;
    usedSlugs.add(row.slug);
    const base = staticCategories.find((c) => c.slug === row.slug);
    const description =
      nonBlankText(row.description) ??
      (row.slug === "shirts"
        ? "Individual thrift shirts, carefully selected."
        : "Coming soon.");
    const imageUrl = categoryMediaUrl(row.image_storage_path);
    const bannerUrl = categoryMediaUrl(row.banner_storage_path);
    const seoTitle = nonBlankText(row.seo_title);
    const seoDescription = nonBlankText(row.seo_description);
    if (base) {
      merged.push({
        ...base,
        name: row.name,
        description,
        ...(seoTitle ? { seoTitle } : { seoTitle: undefined }),
        ...(seoDescription ? { seoDescription } : { seoDescription: undefined }),
        ...(imageUrl
          ? {
              image: { src: imageUrl, alt: row.name },
              thumbnail: { src: imageUrl, alt: row.name },
            }
          : {}),
        ...(bannerUrl
          ? { banner: { src: bannerUrl, alt: row.name } }
          : { banner: undefined }),
        sortOrder: 0,
      });
    } else {
      merged.push({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description,
        ...(seoTitle ? { seoTitle } : {}),
        ...(seoDescription ? { seoDescription } : {}),
        image: imageUrl
          ? { src: imageUrl, alt: row.name }
          : { src: "/images/categories/shirts.svg", alt: row.name },
        thumbnail: imageUrl
          ? { src: imageUrl, alt: row.name }
          : { src: "/images/categories/shirts.svg", alt: row.name },
        ...(bannerUrl ? { banner: { src: bannerUrl, alt: row.name } } : {}),
        sortOrder: 0,
      });
    }
  }
  for (const base of staticCategories) {
    if (!usedSlugs.has(base.slug)) merged.push({ ...base, sortOrder: 0 });
  }
  return merged.map((category, index) => ({
    ...category,
    sortOrder: index + 1,
  }));
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
 * Footer override (wired in the root layout). Stored contact
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

// ---------------------------------------------------------------------------
// Marketing integrations + SEO metadata (Admin Panel v2, items 9 + 11)
// ---------------------------------------------------------------------------

export interface MarketingSettings {
  /** Numeric Meta Pixel ID, or null when unconfigured/invalid. */
  pixelId: string | null;
  /** Stored event toggles, or null when absent/malformed. */
  pixelEvents: PixelEventsConfig | null;
  /** GA4 measurement ID (G-…), or null when unconfigured/invalid. */
  gaMeasurementId: string | null;
  /** Owner-only custom header code, or null when empty/too long. */
  headCode: string | null;
  /** Owner-only custom footer code, or null when empty/too long. */
  bodyCode: string | null;
}

function parseCustomCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CUSTOM_CODE_LENGTH) return null;
  return trimmed;
}

/**
 * Parse the public-safe marketing settings for the storefront. Every
 * field validates independently: one bad value never disables the others,
 * and unconfigured fields are null so the layout renders zero third-party
 * code. SMS settings are deliberately absent — nothing on the storefront
 * reads them, and the SMS secret is never readable at all.
 */
export function parseMarketingSettings(
  settings: Record<string, unknown> | null | undefined,
): MarketingSettings {
  const pixelId = settingText(settings, "meta_pixel_id");
  const gaMeasurementId = settingText(settings, "ga_measurement_id");
  return {
    pixelId:
      pixelId !== null && META_PIXEL_ID_PATTERN.test(pixelId) ? pixelId : null,
    pixelEvents: parsePixelEvents(settings?.["meta_pixel_events"]),
    gaMeasurementId:
      gaMeasurementId !== null &&
      GA_MEASUREMENT_ID_PATTERN.test(gaMeasurementId)
        ? gaMeasurementId
        : null,
    headCode: parseCustomCode(settings?.["custom_head_code"]),
    bodyCode: parseCustomCode(settings?.["custom_body_code"]),
  };
}

export interface StaticSeoBase {
  siteName: string;
  siteUrl: string;
  description: string;
  logoBadge: string;
}

/**
 * Default document title, shared by the layout and the home page's
 * override branch: the stored `seo_default_title`, else
 * "<Site> — Thrift Shirts in Bangladesh".
 */
export function resolveSeoDefaultTitle(
  siteName: string,
  settings: Record<string, unknown> | null | undefined,
): string {
  return (
    settingText(settings, "seo_default_title") ??
    `${siteName} — Thrift Shirts in Bangladesh`
  );
}

/** Default document description: the stored `seo_default_description`, else the static base description. */
export function resolveSeoDefaultDescription(
  fallbackDescription: string,
  settings: Record<string, unknown> | null | undefined,
): string {
  return settingText(settings, "seo_default_description") ?? fallbackDescription;
}

/**
 * Resolve document metadata from the static base plus stored SEO settings.
 * Static fallbacks are unchanged when nothing is configured or a value is
 * invalid: same default title, same description, same noindex robots,
 * same OG image. Robots follow the shared indexing policy (see lib/seo):
 * Preview/dev is NEVER indexable regardless of the stored toggle, and
 * production follows the toggle, failing closed when it is unset or
 * malformed — search indexing is never enabled by accident. Per-page
 * overrides (seo_page_overrides) are NOT applied here: the root layout
 * has no page context; each page's generateMetadata applies them.
 * The `env` parameter exists for testability (pure given an env record,
 * mirroring customerAuthOrigin); production code uses process.env.
 */
export function resolveStorefrontMetadata(
  base: StaticSeoBase,
  settings: Record<string, unknown> | null | undefined,
  env: SeoEnv = process.env,
): Metadata {
  const defaultTitle = resolveSeoDefaultTitle(base.siteName, settings);
  const description = resolveSeoDefaultDescription(base.description, settings);
  const canonicalBase = resolveCanonicalBase(
    settingText(settings, "seo_canonical_base_url"),
    base.siteUrl,
  );
  const policy = resolveIndexingPolicy({
    isProduction: isProductionEnv(env),
    robots: parseSeoRobots(settings?.["seo_robots"]),
  });
  const keywords = resolveGlobalKeywords(settings);
  // Shared with every page (see lib/seo): a stored OG URL wins, else the
  // logo badge with measured dimensions. The private seo_social_image_path
  // is deliberately NOT used here: it is a private Storage path crawlers
  // cannot fetch (see forms copy).
  const defaultImage = resolveDefaultOgImage(settings, base.logoBadge, base.siteName);
  const twitterCard = settingText(settings, "seo_twitter_card");
  const googleVerification = parseGoogleVerification(
    settings?.["google_search_console_verification"],
  );
  return {
    metadataBase: new URL(canonicalBase),
    robots: { index: policy.metaRobots.index, follow: policy.metaRobots.follow },
    title: {
      default: defaultTitle,
      template: `%s | ${base.siteName}`,
    },
    description,
    alternates: { canonical: "/" },
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(googleVerification
      ? { verification: { google: googleVerification } }
      : {}),
    icons: { icon: "/brand/icon.png", apple: "/brand/apple-icon.png" },
    openGraph: {
      siteName: base.siteName,
      type: "website",
      title: settingText(settings, "seo_og_title") ?? defaultTitle,
      description: settingText(settings, "seo_og_description") ?? description,
      url: "/",
      locale: SEO_OG_LOCALE,
      images: [defaultImage],
    },
    ...(twitterCard === "summary" || twitterCard === "summary_large_image"
      ? {
          twitter: {
            card: twitterCard,
            title: settingText(settings, "seo_og_title") ?? defaultTitle,
            description:
              settingText(settings, "seo_og_description") ?? description,
            images: [defaultImage.url],
          },
        }
      : {}),
  };
}
