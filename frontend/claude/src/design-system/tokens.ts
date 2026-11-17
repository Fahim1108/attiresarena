/**
 * Design tokens — the single place raw values live.
 *
 * TWO TOKEN SETS, deliberately separated. Never mix them:
 *
 * 1. STOREFRONT tokens (`storefrontTokens`): mirror `src/config/theme.ts`
 *    (primary #6B0202) and the `--aa-*` CSS variables generated from it by
 *    ThemeStyle. theme.ts is authoritative — this module only reads it.
 *    NEVER edit theme.ts from design-system work, and never change an
 *    existing Tailwind value.
 *
 * 2. ADMIN tokens (`adminTokens`): Fahim's admin-scoped palette for the
 *    Phase 2 admin redesign. These resolve to `--admin-*` CSS variables
 *    defined ONLY under the `.aa-admin-ds` scope selector in
 *    src/app/globals.css, so they can never leak into the storefront.
 *    Admin components MUST render inside an `.aa-admin-ds` ancestor
 *    (the AdminShell root carries it for workspace pages; each auth
 *    `<main>` carries it too).
 *
 * Components use tokens / Tailwind classes (`bg-admin-bg`,
 * `text-admin-text`, `rounded-admin-card`), never raw hex. The only hex
 * values in the design system live in this file (and the matching
 * `--admin-*` channel triplets in globals.css, which must stay in sync).
 *
 * Contrast (checked 2026-11-17, WCAG 4.5:1 minimum for normal text):
 * admin text #172033 on white 16.27:1; secondary #667085 on white 4.97:1
 * and on #F7F8FA 4.68:1; white on primary #650000 13.52:1 and on secondary
 * #8B1E24 9.09:1; success #1F7A3A 5.38:1, warning #9A6200 5.10:1, danger
 * #B42318 6.57:1, info #1D4ED8 6.70:1 — all on white. Badge text always
 * uses the dark tone colour on a light tint, never white on a tint.
 */

import { motion, motionEase } from "@/config/motion";
import { theme } from "@/config/theme";

/** Scope class that activates the `--admin-*` variables. */
export const ADMIN_SCOPE_CLASS = "aa-admin-ds";

/* ------------------------------------------------------------------ */
/* 1. Storefront tokens (theme.ts is authoritative; read-only here)    */
/* ------------------------------------------------------------------ */

/** Hex values mirrored from theme.ts — do not edit here, edit theme.ts. */
export const storefrontTokens = {
  colors: { ...theme.colors },
  radius: { ...theme.radius },
  typography: { ...theme.typography },
  /** Usable CSS colours: `--aa-*` vars hold RGB channels, not hex. */
  css: {
    primary: "rgb(var(--aa-primary))",
    primaryDark: "rgb(var(--aa-primary-dark))",
    background: "rgb(var(--aa-background))",
    surface: "rgb(var(--aa-surface))",
    text: "rgb(var(--aa-text))",
    textMuted: "rgb(var(--aa-text-muted))",
    border: "rgb(var(--aa-border))",
    selected: "rgb(var(--aa-selected))",
  },
  /** Tailwind classes that resolve to the storefront variables. */
  classes: {
    primaryBg: "bg-primary",
    surfaceBg: "bg-surface",
    pageBg: "bg-page",
    text: "text-ink",
    textMuted: "text-ink-muted",
    border: "border-line",
    selectedBg: "bg-selected",
    radiusCard: "rounded-card",
    radiusControl: "rounded-control",
  },
} as const;

/* ------------------------------------------------------------------ */
/* 2. Admin tokens (Fahim's palette, admin-scoped, Phase 2)            */
/* ------------------------------------------------------------------ */

export const adminTokens = {
  colors: {
    /** Primary #650000 — admin primary actions and emphasis. */
    primary: "#650000",
    /** Secondary #8B1E24 — secondary emphasis, chart series 2. */
    secondary: "#8B1E24",
    /** Soft background #F8EEEE — tinted surfaces, hover fills. */
    softBackground: "#F8EEEE",
    /** Main background #F7F8FA — admin page background. */
    background: "#F7F8FA",
    /** Cards #FFFFFF. */
    card: "#FFFFFF",
    /** Primary text #172033. */
    text: "#172033",
    /** Secondary text #667085. */
    textSecondary: "#667085",
    /** Borders #E6E9EF. */
    border: "#E6E9EF",
    /* Status tones. Success/warning/danger match the existing Tailwind
       values so admin badges agree with the rest of the app; info is the
       only new tone. All pass 4.5:1 as text on white. */
    success: "#1F7A3A",
    warning: "#9A6200",
    danger: "#B42318",
    info: "#1D4ED8",
  },
  /** RGB channel triplets — must match globals.css `.aa-admin-ds`. */
  channels: {
    primary: "101 0 0",
    secondary: "139 30 36",
    softBackground: "248 238 238",
    background: "247 248 250",
    card: "255 255 255",
    text: "23 32 51",
    textSecondary: "102 112 133",
    border: "230 233 239",
    success: "31 122 58",
    warning: "154 98 0",
    danger: "180 35 24",
    info: "29 78 216",
  },
  /** Usable CSS colours resolving to the scoped `--admin-*` variables. */
  css: {
    primary: "rgb(var(--admin-primary))",
    secondary: "rgb(var(--admin-secondary))",
    softBackground: "rgb(var(--admin-soft-bg))",
    background: "rgb(var(--admin-bg))",
    card: "rgb(var(--admin-card))",
    text: "rgb(var(--admin-text))",
    textSecondary: "rgb(var(--admin-text-secondary))",
    border: "rgb(var(--admin-border))",
    success: "rgb(var(--admin-success))",
    warning: "rgb(var(--admin-warning))",
    danger: "rgb(var(--admin-danger))",
    info: "rgb(var(--admin-info))",
  },
  /** Tailwind classes (see tailwind.config.ts `admin` namespace). */
  classes: {
    primaryBg: "bg-admin-primary",
    secondaryBg: "bg-admin-secondary",
    softBg: "bg-admin-soft-bg",
    pageBg: "bg-admin-bg",
    cardBg: "bg-admin-card",
    text: "text-admin-text",
    textSecondary: "text-admin-text-secondary",
    border: "border-admin-border",
    radiusCard: "rounded-admin-card",
    radiusControl: "rounded-admin-control",
    shadowCard: "shadow-admin-card",
    shadowLift: "shadow-admin-lift",
    fontSans: "font-admin-sans",
    numeric: "admin-ds-numeric",
  },
  /** Admin-only radii. Storefront radii (6px) are untouched. */
  radius: {
    card: "12px",
    control: "8px",
    badge: "9999px",
  },
  shadow: {
    card: "0 1px 2px rgba(23, 32, 51, 0.05), 0 4px 16px -8px rgba(23, 32, 51, 0.10)",
    lift: "0 12px 32px -12px rgba(101, 0, 0, 0.25)",
  },
  font: {
    /** Inter (already installed via @fontsource-variable/inter). */
    sans: "var(--font-inter), Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  /**
   * Categorical chart colours for Recharts fills. SVG presentation
   * attributes cannot resolve CSS var() reliably, so charts use these
   * hex values from tokens — never hex written in a component. Ordered
   * so the first two series are the admin maroons.
   */
  chart: {
    palette: [
      "#650000",
      "#8B1E24",
      "#1D4ED8",
      "#1F7A3A",
      "#9A6200",
      "#7C3AED",
      "#0E7490",
      "#B42318",
    ],
    grid: "#E6E9EF",
    axisText: "#667085",
    tooltipBg: "#FFFFFF",
    tooltipBorder: "#E6E9EF",
    tooltipText: "#172033",
    /** Comparison (previous-period) series: muted grey-blue. */
    comparison: "#94A3B8",
  },
} as const;

/* ------------------------------------------------------------------ */
/* Shared: spacing, motion, typography                                 */
/* ------------------------------------------------------------------ */

/**
 * Spacing scale. Components use Tailwind spacing utilities (p-4, gap-6);
 * this table documents the dashboard rhythm in rem so non-Tailwind code
 * (charts, inline styles) stays on the same scale. Dashboard density:
 * card padding 16–24px, section gaps 24px, page padding 16/24/32px.
 */
export const spacingTokens = {
  xs: "0.25rem", // 4px  — Tailwind 1
  sm: "0.5rem", // 8px  — Tailwind 2
  md: "1rem", // 16px — Tailwind 4
  lg: "1.5rem", // 24px — Tailwind 6
  xl: "2rem", // 32px — Tailwind 8
  "2xl": "3rem", // 48px — Tailwind 12
  cardPadding: "1rem", // 16px, 24px at sm+ via responsive classes
  sectionGap: "1.5rem", // 24px
} as const;

/**
 * Motion tokens, sourced from src/config/motion (no timing token delays
 * data or navigation). Durations in ms; components use Tailwind
 * duration-150/200/300 or these values for JS-driven animation.
 */
export const motionTokens = {
  fast: motion.fast,
  normal: motion.normal,
  slow: motion.slow,
  panel: motion.panel,
  ease: motionEase,
  css: {
    fast: `${motion.fast}ms`,
    normal: `${motion.normal}ms`,
    slow: `${motion.slow}ms`,
    panel: `${motion.panel}ms`,
    ease: motionEase,
  },
} as const;

/**
 * Admin typography scale (Inter throughout the admin). Components use
 * Tailwind text/size/weight/leading utilities; this table is the
 * reference for what each level means. Body text never drops below 12px
 * for labels; data values use tabular numbers (`.admin-ds-numeric`).
 */
export const typographyTokens = {
  fontSans: adminTokens.font.sans,
  pageTitle: { size: "1.5rem", lineHeight: "2rem", weight: 600 },
  sectionTitle: { size: "1.125rem", lineHeight: "1.75rem", weight: 600 },
  cardTitle: { size: "0.875rem", lineHeight: "1.25rem", weight: 600 },
  body: { size: "0.875rem", lineHeight: "1.5rem", weight: 400 },
  small: { size: "0.8125rem", lineHeight: "1.25rem", weight: 400 },
  label: { size: "0.75rem", lineHeight: "1rem", weight: 500 },
  kpiValue: { size: "1.875rem", lineHeight: "2.25rem", weight: 600 },
} as const;
