import type { LogoSettings } from "@/types";

/** Official Attires Arena logo files (do not redraw — replace files in /public/brand). */
export const logo: LogoSettings = {
  primary: "/brand/logo-maroon.png",
  inverse: "/brand/logo-white.png",
  badge: "/brand/logo-badge.jpg",
  alt: "Attires Arena",
  heightDesktop: 78,
  heightMobile: 64,
  showWordmarkText: false,
};

export const site = {
  name: "Attires Arena",
  url: "https://attiresarena.com",
  // Owner-approved wording (Fahim, 2026-11-19 — target search phrases):
  // "Best thrift collection in Bangladesh", thrift at reasonable prices,
  // delivered across Bangladesh. This is the default meta/OG description
  // (layout fallback) — NOT visible body copy, so the "best" phrasing
  // targets the search intent without asserting it as editorial fact.
  description: "Best thrift collection in Bangladesh — individual thrift shirts at reasonable prices, delivered across Bangladesh.",
};
