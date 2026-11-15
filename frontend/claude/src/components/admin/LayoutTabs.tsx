import Link from "next/link";

export type LayoutSection =
  | "homepage-sections"
  | "hero-slider"
  | "content-text"
  | "navigation"
  | "footer-links"
  | "error-pages"
  | "custom-code";

const SECTIONS: { key: LayoutSection; href: string; label: string }[] = [
  { key: "homepage-sections", href: "/admin/content/homepage", label: "Homepage Sections" },
  { key: "hero-slider", href: "/admin/content/banners", label: "Hero Slider" },
  { key: "content-text", href: "/admin/settings/store", label: "Content & Text" },
  { key: "navigation", href: "/admin/appearance#navigation", label: "Navigation" },
  { key: "footer-links", href: "/admin/appearance#footer-links", label: "Footer Links" },
  { key: "error-pages", href: "/admin/appearance#error-pages", label: "Error Pages" },
  { key: "custom-code", href: "/admin/marketing/promotions", label: "Custom Code" },
];

/**
 * Tabbed layout navigation across the existing content/appearance pages.
 * Each tab links to the page that already owns that surface — Homepage
 * Sections and Hero Slider are content pages, Content & Text is the
 * store settings page, Custom Code lives on Promotions, and Navigation,
 * Footer Links and Error Pages are sections of the Layout hub.
 */
export function LayoutTabs({ current }: { current: LayoutSection }) {
  return (
    <nav className="aa-tabs" aria-label="Layout sections">
      {SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={section.href}
          aria-current={section.key === current ? "page" : undefined}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
