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
import {
  CUSTOMIZE_BUTTONS_SCHEMA,
  CUSTOMIZE_TYPOGRAPHY_SCHEMA,
  DEFAULT_ERROR_404,
  FONT_STACKS,
  FOOTER_LINKS_SCHEMA,
  NAV_LINKS_SCHEMA,
  activeWidgets,
  parseLayoutSetting,
  parseWidgetRow,
  resolveErrorPage,
  type ErrorPageConfig,
  type LayoutSettingKey,
  type Widget,
} from "./admin/reference-adapt";
import type {
  Banner,
  FooterSettings,
  HeaderSettings,
  HeroSettings,
  LogoSettings,
  ThemeSettings,
} from "@/types";
import { publicSupabaseConfiguration } from "./supabase-public";
import { brandMediaUrl } from "./brand-media-delivery";

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
 * to the storefront settings. The layout reader also returns the
 * public-safe layout settings (navigation links, footer link groups,
 * customize choices — see parseLayoutSettings; the anonymous policy
 * must allowlist them, migration 20261119000900), and the root layout
 * applies those overrides too. The announcement bar and hero slides
 * still flow through the services adapter, which this module must not
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
  /**
   * Parsed public-safe layout settings (navigation_links, footer_links,
   * customize_typography, customize_buttons). Empty when the table is
   * unreadable or the anonymous policy does not allowlist a key yet —
   * every override below then keeps the static config.
   */
  layout: Partial<Record<LayoutSettingKey, unknown>>;
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

/**
 * Public-safe layout settings only. Rows for any other key (notably
 * error_404, which getErrorPage404 reads separately, and the
 * staff-only redirect_auto / featured_categories_count) are ignored
 * here even if the policy ever returns them, so a policy change alone
 * can never leak an operational setting into the storefront. Malformed
 * rows are dropped by parseLayoutSetting, never trusted.
 */
function parseLayoutSettings(
  rows: unknown[],
): Partial<Record<LayoutSettingKey, unknown>> {
  const layout: Partial<Record<LayoutSettingKey, unknown>> = {};
  const keys: LayoutSettingKey[] = [
    "navigation_links",
    "footer_links",
    "customize_typography",
    "customize_buttons",
  ];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (typeof row.key !== "string" || !("value" in row)) continue;
    const key = row.key as LayoutSettingKey;
    if (!keys.includes(key)) continue;
    const parsed = parseLayoutSetting(key, row.value);
    if (parsed !== null) layout[key] = parsed;
  }
  return layout;
}

export async function getStorefrontContent(): Promise<StorefrontContent | null> {
  if (!publicSupabaseConfiguration()) return null;
  const [settingRows, blockRows, bannerRows, layoutRows] = await Promise.all([
    readRows("/rest/v1/store_settings?select=key,value"),
    readRows(
      "/rest/v1/content_blocks?select=slug,title,body,image_storage_path,sort_position,visible,updated_at&visible=eq.true&order=sort_position.asc",
    ),
    readRows(
      "/rest/v1/banners?select=id,title,subtitle,image_storage_path,link_url,sort_position,visible,placement&visible=eq.true&order=sort_position.asc",
    ),
    readRows("/rest/v1/layout_settings?select=key,value"),
  ]);
  return {
    settings: parseSettings(settingRows),
    blocks: parseBlocks(blockRows),
    banners: parseBanners(bannerRows),
    layout: parseLayoutSettings(layoutRows),
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
 * Store-name override (wired in the root layout). The saved store_name
 * replaces the static site name; blank or absent keeps it. Returns the
 * static name unchanged when nothing applies.
 */
export function applySiteNameOverride(
  siteName: string,
  settings: Record<string, unknown> | null | undefined,
): string {
  return settingText(settings, "store_name") ?? siteName;
}

/**
 * Logo override (wired in the root layout). A saved logo_storage_path
 * replaces the header logo with the brand-media route URL; the path is
 * validated by brandMediaUrl, so a malformed or non-brand path keeps
 * the static logo. The inverse (dark-background) logo is deliberately
 * NOT replaced: one upload cannot serve both light and dark
 * backgrounds, so the footer keeps the static white logo. The square
 * badge is also untouched (it feeds the OG image). The alt text follows
 * the resolved site name.
 */
export function applyBrandOverride(
  logo: LogoSettings,
  settings: Record<string, unknown> | null | undefined,
  siteName: string,
): LogoSettings {
  const url = brandMediaUrl(settingText(settings, "logo_storage_path"));
  if (!url) return logo;
  return { ...logo, primary: url, alt: siteName };
}

/** Button corner radius from the stored shape + radius choice. */
function customizeButtonRadius(buttons: {
  shape: "square" | "rounded" | "pill";
  radius_px: number;
}): string {
  if (buttons.shape === "square") return "0px";
  if (buttons.shape === "pill") return "9999px";
  return `${buttons.radius_px}px`;
}

/**
 * Theme-customize override (wired in the root layout through
 * ThemeStyle). Saved heading/body fonts replace the theme font stacks,
 * and the saved button shape/radius replaces the control radius
 * (--aa-radius-control, used by every rounded-control button). The
 * card radius and all colors stay static. The button *style*
 * (solid/outline) is deliberately NOT applied here: the storefront has
 * no single primary-button style hook — primary buttons are ad-hoc
 * `bg-primary` classes in many components plus the shared Button —
 * so a global flip would restyle only some of them. Returns the static
 * theme unchanged when nothing valid is stored.
 */
export function applyCustomizeOverride(
  theme: ThemeSettings,
  layout: Partial<Record<LayoutSettingKey, unknown>> | null | undefined,
): ThemeSettings {
  // Re-validated here (not just trusted from the reader) so the
  // override is safe for any caller, including tests.
  const typography = CUSTOMIZE_TYPOGRAPHY_SCHEMA.safeParse(
    layout?.["customize_typography"],
  );
  const buttons = CUSTOMIZE_BUTTONS_SCHEMA.safeParse(
    layout?.["customize_buttons"],
  );
  const serif = typography.success
    ? FONT_STACKS[typography.data.heading_font]
    : null;
  const sans = typography.success
    ? FONT_STACKS[typography.data.body_font]
    : null;
  const controlRadius = buttons.success
    ? customizeButtonRadius(buttons.data)
    : null;
  if (serif === null && sans === null && controlRadius === null) return theme;
  return {
    ...theme,
    typography: {
      ...theme.typography,
      serif: serif ?? theme.typography.serif,
      sans: sans ?? theme.typography.sans,
    },
    radius: {
      ...theme.radius,
      control: controlRadius ?? theme.radius.control,
    },
  };
}

/**
 * Navigation override (wired in the root layout). A saved, non-empty
 * navigation_links list replaces the header navigation wholesale
 * (label/href/children map 1:1 onto NavItem, already validated by
 * parseLayoutSetting). An empty or malformed list keeps the static
 * navigation — an empty nav would strand visitors. Note this replaces
 * the services adapter's live Men→Shirts rewrite too: saving links is
 * the owner's explicit choice of navigation.
 */
export function applyNavigationOverride(
  header: HeaderSettings,
  layout: Partial<Record<LayoutSettingKey, unknown>> | null | undefined,
): HeaderSettings {
  // Re-validated here (not just trusted from the reader) so the
  // override is safe for any caller, including tests.
  const parsed = NAV_LINKS_SCHEMA.safeParse(layout?.["navigation_links"]);
  if (!parsed.success || parsed.data.length === 0) return header;
  return {
    ...header,
    navigation: parsed.data.map((link) => ({
      label: link.label,
      href: link.href,
      ...(link.children.length > 0
        ? {
            children: link.children.map((child) => ({
              label: child.label,
              href: child.href,
            })),
          }
        : {}),
    })),
  };
}

/**
 * Footer-links override (wired in the root layout). A saved, non-empty
 * footer_links list replaces the footer link columns wholesale
 * (title/links map 1:1 onto FooterColumn, already validated by
 * parseLayoutSetting). An empty or malformed list keeps the static
 * columns. Only the link columns change here — the tagline and contact
 * block are owned by applyFooterOverride / the Footer component and
 * are untouched.
 */
export function applyFooterLinksOverride(
  footer: FooterSettings,
  layout: Partial<Record<LayoutSettingKey, unknown>> | null | undefined,
): FooterSettings {
  // Re-validated here (not just trusted from the reader) so the
  // override is safe for any caller, including tests.
  const parsed = FOOTER_LINKS_SCHEMA.safeParse(layout?.["footer_links"]);
  if (!parsed.success || parsed.data.length === 0) return footer;
  return {
    ...footer,
    columns: parsed.data.map((group) => ({
      title: group.title,
      links: group.links.map((link) => ({
        label: link.label,
        href: link.href,
      })),
    })),
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
  /** Same-origin brand-media URL for a saved favicon, when one is stored. */
  faviconUrl?: string;
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
    icons: {
      icon: base.faviconUrl ?? "/brand/icon.png",
      apple: "/brand/apple-icon.png",
    },
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
