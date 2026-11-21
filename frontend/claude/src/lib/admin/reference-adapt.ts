/**
 * Pure rules for the reference-adaptation pass (Admin Panel V2, builder 5).
 *
 * Client-safe: no `server-only` import, so admin forms, the storefront
 * countdown slot and tests can all share these rules. Storage shapes mirror
 * migration 20261115001300_admin_v2_reference_additions.sql; the SQL CHECK
 * constraints enforce the same enums and limits a second time.
 *
 * Nothing here copies the reference panel's theme, name or data: widget
 * themes use AttiresArena's own maroon palette, and every value is either a
 * fixed enum or staff-entered content.
 */
import { z } from "zod";
import {
  PERMISSION_GROUPS,
  type PermissionName,
} from "./constants";

/* ------------------------------------------------------------------ */
/* Shared value rules                                                  */
/* ------------------------------------------------------------------ */

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/**
 * A link the storefront may render: a site-relative path (never a
 * protocol-relative `//` URL) or an absolute http(s) URL. Rejects
 * javascript:, data:, credentials-in-URL and anything with whitespace.
 */
export function isSiteHref(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 500 || /\s/.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

const siteHrefField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(500)
    .refine(isSiteHref, `${label} must be a site path like /shop or a full http(s) URL.`);

/* ------------------------------------------------------------------ */
/* Homepage widgets (migration 013: public.homepage_widgets)           */
/* ------------------------------------------------------------------ */

export const WIDGET_TYPES = ["countdown", "announcement"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
export const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  countdown: "Countdown Timer",
  announcement: "Announcement",
};

export const WIDGET_PLACEMENTS = [
  "after-hero",
  "after-categories",
  "after-new-arrivals",
  "after-featured",
] as const;
export type WidgetPlacement = (typeof WIDGET_PLACEMENTS)[number];
export const WIDGET_PLACEMENT_LABELS: Record<WidgetPlacement, string> = {
  "after-hero": "Homepage → After Hero",
  "after-categories": "Homepage → After Categories",
  "after-new-arrivals": "Homepage → After New Arrivals",
  "after-featured": "Homepage → After Featured",
};
/** Homepage section type each placement follows. */
export const WIDGET_PLACEMENT_SECTIONS: Record<WidgetPlacement, string> = {
  "after-hero": "hero",
  "after-categories": "categories",
  "after-new-arrivals": "new-arrivals",
  "after-featured": "featured",
};

export const WIDGET_TITLE_ALIGNMENTS = ["left", "center"] as const;
export type WidgetTitleAlignment = (typeof WIDGET_TITLE_ALIGNMENTS)[number];
export const WIDGET_TITLE_SIZES = ["small", "medium", "large"] as const;
export type WidgetTitleSize = (typeof WIDGET_TITLE_SIZES)[number];

export const WIDGET_THEMES = ["default", "maroon", "light", "dark"] as const;
export type WidgetTheme = (typeof WIDGET_THEMES)[number];
export const WIDGET_THEME_LABELS: Record<WidgetTheme, string> = {
  default: "Default",
  maroon: "Maroon",
  light: "Light",
  dark: "Dark",
};
/** Section-style presets in the store's own palette (maroon #6B0202). */
export const WIDGET_THEME_COLORS: Record<
  WidgetTheme,
  { background: string; accent: string; title: string; content: string }
> = {
  default: {
    background: "#FFFFFF",
    accent: "#6B0202",
    title: "#1A1A1A",
    content: "#444444",
  },
  maroon: {
    background: "#6B0202",
    accent: "#FFFFFF",
    title: "#FFFFFF",
    content: "#F5E6E6",
  },
  light: {
    background: "#FAF6F2",
    accent: "#6B0202",
    title: "#1A1A1A",
    content: "#444444",
  },
  dark: {
    background: "#1A1A1A",
    accent: "#E8B4B4",
    title: "#FFFFFF",
    content: "#D9D9D9",
  },
};

const hexColorField = z
  .string()
  .trim()
  .max(7)
  .refine(
    (value) => value === "" || isHexColor(value),
    "Use a 6-digit hex color like #6B0202, or leave empty to use the theme color.",
  );

const WIDGET_BASE_SCHEMA = z.object({
  id: z.uuid().nullable(),
  title: z.string().trim().min(1, "Title is required.").max(120),
  type: z.enum(WIDGET_TYPES),
  placement: z.enum(WIDGET_PLACEMENTS),
  title_visible: z.boolean(),
  title_alignment: z.enum(WIDGET_TITLE_ALIGNMENTS),
  title_size: z.enum(WIDGET_TITLE_SIZES),
  subtitle: z.string().trim().max(200),
  ends_at: z.string().nullable(),
  offer_title: z.string().trim().max(120),
  discount_text: z.string().trim().max(120),
  style_theme: z.enum(WIDGET_THEMES),
  use_theme_color: z.boolean(),
  background_color: hexColorField,
  accent_color: hexColorField,
  title_color: hexColorField,
  content_color: hexColorField,
  sort_position: z.number().int().min(0).max(999),
  active: z.boolean(),
});

export const WIDGET_SCHEMA = WIDGET_BASE_SCHEMA.superRefine((value, ctx) => {
  if (value.type === "countdown" && !value.ends_at) {
    ctx.addIssue({
      code: "custom",
      path: ["ends_at"],
      message: "Countdown widgets need an end date and time.",
    });
  }
  if (value.ends_at && Number.isNaN(Date.parse(value.ends_at))) {
    ctx.addIssue({
      code: "custom",
      path: ["ends_at"],
      message: "End date and time is invalid.",
    });
  }
});

export type WidgetInput = z.infer<typeof WIDGET_SCHEMA>;

/**
 * Stored-row shape. No refinement: the migration CHECK constraints
 * enforce the same invariants (countdown ⇒ ends_at) in the database.
 * Split from WIDGET_SCHEMA because zod forbids .extend() on schemas
 * with refinements.
 */
export const WIDGET_ROW_SCHEMA = WIDGET_BASE_SCHEMA.extend({
  id: z.uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Widget = z.infer<typeof WIDGET_ROW_SCHEMA>;

function isWidgetEnum<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Parse one REST row into a Widget; malformed rows are skipped (null). */
export function parseWidgetRow(row: unknown): Widget | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.title !== "string" ||
    !isWidgetEnum(WIDGET_TYPES, r.type) ||
    !isWidgetEnum(WIDGET_PLACEMENTS, r.placement) ||
    typeof r.title_visible !== "boolean" ||
    !isWidgetEnum(WIDGET_TITLE_ALIGNMENTS, r.title_alignment) ||
    !isWidgetEnum(WIDGET_TITLE_SIZES, r.title_size) ||
    typeof r.subtitle !== "string" ||
    (r.ends_at !== null && typeof r.ends_at !== "string") ||
    typeof r.offer_title !== "string" ||
    typeof r.discount_text !== "string" ||
    !isWidgetEnum(WIDGET_THEMES, r.style_theme) ||
    typeof r.use_theme_color !== "boolean" ||
    typeof r.background_color !== "string" ||
    typeof r.accent_color !== "string" ||
    typeof r.title_color !== "string" ||
    typeof r.content_color !== "string" ||
    typeof r.sort_position !== "number" ||
    typeof r.active !== "boolean" ||
    typeof r.created_at !== "string" ||
    typeof r.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    placement: r.placement,
    title_visible: r.title_visible,
    title_alignment: r.title_alignment,
    title_size: r.title_size,
    subtitle: r.subtitle,
    ends_at: r.ends_at,
    offer_title: r.offer_title,
    discount_text: r.discount_text,
    style_theme: r.style_theme,
    use_theme_color: r.use_theme_color,
    background_color: r.background_color,
    accent_color: r.accent_color,
    title_color: r.title_color,
    content_color: r.content_color,
    sort_position: r.sort_position,
    active: r.active,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * Widgets that may render on the storefront: active, and for countdowns
 * not yet ended. Inactive, expired and unsaved widgets never render.
 * Sorted by display order, then creation order.
 */
export function activeWidgets(widgets: readonly Widget[], nowMs: number): Widget[] {
  return [...widgets]
    .filter((widget) => {
      if (!widget.active) return false;
      if (widget.type === "countdown") {
        if (!widget.ends_at) return false;
        return Date.parse(widget.ends_at) > nowMs;
      }
      return true;
    })
    .sort(
      (a, b) =>
        a.sort_position - b.sort_position ||
        a.created_at.localeCompare(b.created_at),
    );
}

/** Active widgets placed after one homepage section type. Empty when none. */
export function widgetsAfterSection(
  widgets: readonly Widget[],
  sectionType: string,
  nowMs: number,
): Widget[] {
  return activeWidgets(widgets, nowMs).filter(
    (widget) => WIDGET_PLACEMENT_SECTIONS[widget.placement] === sectionType,
  );
}

/**
 * Placement-only selection for widgets the storefront reader already
 * filtered (active + unexpired). HomepageView uses this so no clock read
 * happens during render; expiry between fetch and render is handled by
 * the countdown component, which renders nothing once ended.
 */
export function placedWidgets(
  widgets: readonly Widget[],
  sectionType: string,
): Widget[] {
  return widgets.filter(
    (widget) => WIDGET_PLACEMENT_SECTIONS[widget.placement] === sectionType,
  );
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

export function countdownParts(endsAt: string, nowMs: number): CountdownParts {
  const remainingMs = Date.parse(endsAt) - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor(totalSeconds / 3600) % 24,
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
    expired: false,
  };
}

/** Effective section colors: theme preset, overridden by valid custom colors. */
export function resolveWidgetStyle(widget: WidgetInput): {
  background: string;
  accent: string;
  title: string;
  content: string;
} {
  const theme = WIDGET_THEME_COLORS[widget.style_theme];
  if (widget.use_theme_color) return { ...theme };
  const pick = (custom: string, fallback: string) =>
    custom !== "" && isHexColor(custom) ? custom : fallback;
  return {
    background: pick(widget.background_color, theme.background),
    accent: pick(widget.accent_color, theme.accent),
    title: pick(widget.title_color, theme.title),
    content: pick(widget.content_color, theme.content),
  };
}

/* ------------------------------------------------------------------ */
/* Redirects (migration 013: public.url_redirects)                     */
/* ------------------------------------------------------------------ */

export const REDIRECT_CODES = [301, 302] as const;
export type RedirectCode = (typeof REDIRECT_CODES)[number];

/** A redirect source must be a site-relative path. Returns null when invalid. */
export function normalizeRedirectSource(value: string): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 500 ||
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    /\s/.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

/** A redirect target is a site path or an absolute http(s) URL. */
export function normalizeRedirectTarget(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return null;
  if (!isSiteHref(trimmed)) return null;
  return trimmed;
}

const REDIRECT_BASE_SCHEMA = z.object({
  id: z.uuid().nullable(),
  source_path: z.string().min(1).max(500),
  target_path: z.string().min(1).max(500),
  code: z.union([z.literal(301), z.literal(302)]),
  active: z.boolean(),
});

export const REDIRECT_SCHEMA = REDIRECT_BASE_SCHEMA.superRefine((value, ctx) => {
  if (normalizeRedirectSource(value.source_path) === null) {
    ctx.addIssue({
      code: "custom",
      path: ["source_path"],
      message: "Source must be a site path starting with /, like /old-page.",
    });
  }
  if (normalizeRedirectTarget(value.target_path) === null) {
    ctx.addIssue({
      code: "custom",
      path: ["target_path"],
      message: "Target must be a site path or a full http(s) URL.",
    });
  }
  if (
    value.source_path === value.target_path &&
    value.source_path.length > 0
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["target_path"],
      message: "Target must be different from the source.",
    });
  }
});

export type RedirectInput = z.infer<typeof REDIRECT_SCHEMA>;

/**
 * Stored-row shape. No refinement: the migration CHECK constraints
 * enforce the same invariants in the database. Split from
 * REDIRECT_SCHEMA because zod forbids .extend() on schemas with
 * refinements.
 */
export const REDIRECT_ROW_SCHEMA = REDIRECT_BASE_SCHEMA.extend({
  id: z.uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Redirect = z.infer<typeof REDIRECT_ROW_SCHEMA>;

/* ------------------------------------------------------------------ */
/* Layout settings (migration 013: public.layout_settings)             */
/* ------------------------------------------------------------------ */

export const LAYOUT_SETTING_KEYS = [
  "redirect_auto",
  "navigation_links",
  "footer_links",
  "error_404",
  "error_403",
  "customize_typography",
  "customize_buttons",
] as const;
export type LayoutSettingKey = (typeof LAYOUT_SETTING_KEYS)[number];

export function isLayoutSettingKey(value: unknown): value is LayoutSettingKey {
  return (
    typeof value === "string" &&
    (LAYOUT_SETTING_KEYS as readonly string[]).includes(value)
  );
}

/** Which staff area may save each key (mirrors the migration 013 RPC). */
export const LAYOUT_SETTING_AREAS: Record<LayoutSettingKey, "content" | "settings"> = {
  navigation_links: "content",
  footer_links: "content",
  error_404: "content",
  error_403: "content",
  redirect_auto: "settings",
  customize_typography: "settings",
  customize_buttons: "settings",
};

export const NAV_LINK_SCHEMA = z.object({
  label: z.string().trim().min(1, "Link label is required.").max(60),
  href: siteHrefField("Link address"),
  children: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Sub-link label is required.").max(60),
        href: siteHrefField("Sub-link address"),
      }),
    )
    .max(6, "At most 6 sub-links per link.")
    .default([]),
});
export const NAV_LINKS_SCHEMA = z
  .array(NAV_LINK_SCHEMA)
  .max(12, "At most 12 navigation links.");

export const FOOTER_LINK_GROUP_SCHEMA = z.object({
  title: z.string().trim().min(1, "Group title is required.").max(60),
  links: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Link label is required.").max(60),
        href: siteHrefField("Link address"),
      }),
    )
    .max(8, "At most 8 links per group."),
});
export const FOOTER_LINKS_SCHEMA = z
  .array(FOOTER_LINK_GROUP_SCHEMA)
  .max(4, "At most 4 footer link groups.");

export const ERROR_PAGE_SCHEMA = z.object({
  title: z.string().trim().min(1, "Title is required.").max(80),
  subtitle: z.string().trim().max(200),
  image_url: z
    .string()
    .trim()
    .max(500)
    .refine(
      (value) => value === "" || /^https?:\/\//.test(value),
      "Image must be a full http(s) URL, or empty.",
    ),
});
export type ErrorPageConfig = z.infer<typeof ERROR_PAGE_SCHEMA>;

/**
 * The storefront's current 404 copy, kept as the single default so the
 * error-page wiring renders byte-identically when nothing is stored.
 * Must match src/app/(store)/not-found.tsx.
 */
export const DEFAULT_ERROR_404: ErrorPageConfig = {
  title: "Page not found",
  subtitle: "The page you're looking for has moved or no longer exists.",
  image_url: "",
};

/** Fallback copy for the 403 editor (no 403 page exists yet — stored only). */
export const DEFAULT_ERROR_403: ErrorPageConfig = {
  title: "Access denied",
  subtitle: "You do not have access to this page.",
  image_url: "",
};

/** Stored 404 config, or the built-in default (same reference) when absent. */
export function resolveErrorPage(stored: unknown): ErrorPageConfig {
  const parsed = ERROR_PAGE_SCHEMA.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_ERROR_404;
}

/* Customize: typography + buttons. Wired to the storefront through
 * applyCustomizeOverride (lib/store-settings): heading/body fonts and
 * button shape/radius apply; button style (solid/outline) is stored
 * but not applied — the storefront has no single button style hook. */

export const FONT_OPTIONS = [
  {
    id: "cormorant",
    label: "Cormorant Garamond (serif)",
    stack: "var(--font-cormorant), 'Cormorant Garamond', Georgia, serif",
  },
  {
    id: "playfair",
    label: "Playfair Display (serif)",
    stack: "var(--font-display), 'Playfair Display', Georgia, serif",
  },
  {
    id: "inter",
    label: "Inter (sans)",
    stack: "var(--font-inter), Inter, system-ui, sans-serif",
  },
  {
    id: "allura",
    label: "Allura (script)",
    stack: "var(--font-script), 'Allura', cursive",
  },
] as const;
export type FontOptionId = (typeof FONT_OPTIONS)[number]["id"];

export const FONT_STACKS: Record<FontOptionId, string> = Object.fromEntries(
  FONT_OPTIONS.map((option) => [option.id, option.stack]),
) as Record<FontOptionId, string>;

export const HEADING_FONT_IDS = ["cormorant", "playfair", "inter", "allura"] as const;
export const BODY_FONT_IDS = ["inter", "cormorant"] as const;

export const CUSTOMIZE_TYPOGRAPHY_SCHEMA = z.object({
  heading_font: z.enum(HEADING_FONT_IDS),
  body_font: z.enum(BODY_FONT_IDS),
});
export type CustomizeTypography = z.infer<typeof CUSTOMIZE_TYPOGRAPHY_SCHEMA>;
export const DEFAULT_CUSTOMIZE_TYPOGRAPHY: CustomizeTypography = {
  heading_font: "cormorant",
  body_font: "inter",
};

export const BUTTON_STYLES = ["solid", "outline"] as const;
export const BUTTON_SHAPES = ["square", "rounded", "pill"] as const;

export const CUSTOMIZE_BUTTONS_SCHEMA = z.object({
  style: z.enum(BUTTON_STYLES),
  shape: z.enum(BUTTON_SHAPES),
  radius_px: z.number().int().min(0).max(24),
});
export type CustomizeButtons = z.infer<typeof CUSTOMIZE_BUTTONS_SCHEMA>;
/** Current storefront button look: solid, 6px radius (theme radius). */
export const DEFAULT_CUSTOMIZE_BUTTONS: CustomizeButtons = {
  style: "solid",
  shape: "rounded",
  radius_px: 6,
};

/** Parse one stored layout-settings value; null when absent or malformed. */
export function parseLayoutSetting(
  key: LayoutSettingKey,
  value: unknown,
): unknown | null {
  if (value === null || value === undefined) return null;
  switch (key) {
    case "redirect_auto": {
      const parsed = z.boolean().safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "navigation_links": {
      const parsed = NAV_LINKS_SCHEMA.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "footer_links": {
      const parsed = FOOTER_LINKS_SCHEMA.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "error_404":
    case "error_403": {
      const parsed = ERROR_PAGE_SCHEMA.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "customize_typography": {
      const parsed = CUSTOMIZE_TYPOGRAPHY_SCHEMA.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "customize_buttons": {
      const parsed = CUSTOMIZE_BUTTONS_SCHEMA.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Role access matrix (role_permissions, migration 010 + 013 RPC)     */
/* ------------------------------------------------------------------ */

export const MATRIX_ROLES = ["moderator", "editor", "admin"] as const;
export type MatrixRole = (typeof MATRIX_ROLES)[number];

export function isMatrixRole(value: unknown): value is MatrixRole {
  return (
    typeof value === "string" &&
    (MATRIX_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Permission sections editable for one role in the matrix. "Settings and
 * users" is never editable here (owner-only invariants), and "Costs" is
 * editable only for Admin — moderators and editors must never see costs.
 * Sections cover only areas that exist in this project.
 */
export function matrixSectionsForRole(role: MatrixRole): {
  section: string;
  permissions: readonly PermissionName[];
}[] {
  return PERMISSION_GROUPS.filter(
    (group) =>
      group.section !== "Settings and users" &&
      (role === "admin" || group.section !== "Costs"),
  );
}

/** Whether a permission may be granted to a role through the matrix. */
export function isMatrixGrantAllowed(
  role: MatrixRole,
  permission: PermissionName,
): boolean {
  if (permission === "settings.manage" || permission === "users.manage") {
    return false;
  }
  if (permission === "costs.read" && role !== "admin") return false;
  return true;
}

/** Permissions in a proposed grant set that the matrix must refuse. */
export function matrixGrantViolations(
  role: MatrixRole,
  permissions: readonly PermissionName[],
): PermissionName[] {
  return permissions.filter(
    (permission) => !isMatrixGrantAllowed(role, permission),
  );
}

/* ------------------------------------------------------------------ */
/* Robots & sitemap preview (existing seo_robots toggles)              */
/* ------------------------------------------------------------------ */

/**
 * Read-only preview derived from the saved robots toggles. The meta
 * directive combines index/follow; robots.txt only expresses crawling
 * (index), since "follow" is a page-level directive, not a robots rule.
 * Preview only: the live robots.txt is generated by src/app/robots.ts
 * (which also disallows private paths and links the sitemap).
 */
export function robotsPreview(robots: {
  index: boolean;
  follow: boolean;
}): { metaRobots: string; robotsTxt: string } {
  return {
    metaRobots: `${robots.index ? "index" : "noindex"}, ${robots.follow ? "follow" : "nofollow"}`,
    robotsTxt: robots.index
      ? "User-agent: *\nAllow: /"
      : "User-agent: *\nDisallow: /",
  };
}
