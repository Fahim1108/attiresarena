"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import {
  LayoutDashboard,
  BarChart3,
  Package,
  Plus,
  Tags,
  Star,
  Boxes,
  ShoppingBag,
  Hourglass,
  Users,
  TicketPercent,
  LayoutTemplate,
  Megaphone,
  FileText,
  Palette,
  Store,
  Search,
  ShieldCheck,
  Settings,
  KeyRound,
  Bell,
  Menu,
  Mail,
  ArrowUpRight,
  ImageIcon,
  Blocks,
  PanelsTopLeft,
  ArrowLeftRight,
} from "lucide-react";
import { signOutStaff } from "@/lib/admin/actions";
import { areaRoles } from "@/lib/admin/constants";

/**
 * Admin sidebar. Navigation groups follow the admin-panel spec with
 * business-friendly labels (never "Taxonomy" in the UI). Groups are gated
 * by role through AREA_ROLES; the owner sees everything because every area
 * includes "owner".
 *
 * Admin Panel v2 (owner item 13): the "Intake & Review" group is removed —
 * Garment intake (/admin/products), the products library
 * (/admin/products/library) and the Activity log (/admin/audit) have no
 * sidebar entries. The routes themselves still exist and stay reachable by
 * direct URL. The two remaining staging-gated tools, Private media
 * (/admin/media) and Categories & Collections (/admin/catalogue), keep
 * their exact previous conditions under the "Staging tools" group.
 * Note: /admin/catalogue was observed rendering the public "Page not
 * found" page on the live Preview (2026-11-15); the link is kept because
 * the tool is gated, not intake — the 404 needs a separate look. (The
 * /admin/catalogue route itself stays; only the intake/audit entries
 * were removed, and the intake routes now redirect to /admin.)
 * The staging global search form now targets /admin/catalog/products
 * (same "q" parameter the products page filters on) instead of the
 * removed products library.
 *
 * Area mapping notes:
 * - Promotions uses the coupons area (owner, marketing_manager) and SEO
 *   Settings uses the content area (owner, marketing_manager): AREA_ROLES
 *   has no separate marketing area.
 * - Change Password is shown to every staff member (it is self-service),
 *   not only to the settings area (owner-only).
 * - The old "/admin/products/new" sidebar link is superseded by the new
 *   "Add Product" link; the old route now redirects to the dashboard
 *   (owner item 13: garments intake removed).
 *
 * Reference-adaptation pass (admin v2, builder 5): groups follow the
 * reference panel's shape using EXISTING routes only, with role gating
 * and staging-tools conditions unchanged. Coupons moved from Sales to
 * Catalog; Notifications moved from a standalone link into System;
 * Widgets (/admin/content/widgets, content area), Layout
 * (/admin/appearance, content area) and Redirects (/admin/system/redirects,
 * settings area) were added. "Theme Settings" is labelled "Theme &
 * Customize" because the page now also hosts the customize panels. Media
 * stays under Staging tools with its existing conditions — it is not a
 * Content entry.
 */

type NavIcon = typeof LayoutDashboard;
type NavLink = { href: string; label: string; Icon: NavIcon };

export function AdminShell({
  children,
  roles,
  stagingTools = false,
  taxonomyTools = false,
}: {
  children: React.ReactNode;
  roles: string[];
  stagingTools?: boolean;
  taxonomyTools?: boolean;
}) {
  const path = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const staffKnown = roles.length > 0;
  const hasArea = (area: string) =>
    roles.some((role) =>
      (areaRoles(area) as readonly string[]).includes(role),
    );
  // Existing patterns, kept for the Staging tools group conditions.
  const canRead = roles.some((r) =>
    ["owner", "product_manager", "order_manager", "analyst"].includes(r),
  );
  const canManage = roles.some((r) => r === "owner" || r === "product_manager");

  const groups: { title: string; links: NavLink[] }[] = [
    {
      title: "Main",
      links: [
        ...(staffKnown
          ? [{ href: "/admin", label: "Dashboard", Icon: LayoutDashboard }]
          : []),
        ...(hasArea("analytics")
          ? [{ href: "/admin/analytics", label: "Analytics", Icon: BarChart3 }]
          : []),
      ],
    },
    {
      title: "Catalog",
      links: [
        ...(hasArea("catalogue")
          ? [
              { href: "/admin/catalog/products", label: "All Products", Icon: Package },
              { href: "/admin/catalog/products/new", label: "Add Product", Icon: Plus },
              { href: "/admin/catalog/categories", label: "Categories", Icon: Tags },
              { href: "/admin/catalog/reviews", label: "Reviews", Icon: Star },
            ]
          : []),
        ...(hasArea("inventory")
          ? [{ href: "/admin/catalog/inventory", label: "Inventory", Icon: Boxes }]
          : []),
        ...(hasArea("coupons")
          ? [{ href: "/admin/sales/coupons", label: "Coupons", Icon: TicketPercent }]
          : []),
      ],
    },
    {
      title: "Sales",
      links: [
        ...(hasArea("orders")
          ? [{ href: "/admin/sales/orders", label: "All Orders", Icon: ShoppingBag }]
          : []),
        ...(hasArea("recovery")
          ? [{ href: "/admin/sales/incomplete", label: "Incomplete Orders", Icon: Hourglass }]
          : []),
        ...(hasArea("customers")
          ? [{ href: "/admin/sales/customers", label: "Customers", Icon: Users }]
          : []),
      ],
    },
    {
      title: "Content",
      links: hasArea("content")
        ? [
            { href: "/admin/content/homepage", label: "Homepage Content", Icon: LayoutTemplate },
            { href: "/admin/content/banners", label: "Banners", Icon: Megaphone },
            { href: "/admin/content/pages", label: "Pages", Icon: FileText },
            { href: "/admin/content/widgets", label: "Widgets", Icon: Blocks },
          ]
        : [],
    },
    {
      title: "Appearance",
      links: [
        ...(hasArea("content")
          ? [{ href: "/admin/appearance", label: "Layout", Icon: PanelsTopLeft }]
          : []),
        ...(hasArea("settings")
          ? [
              { href: "/admin/settings/theme", label: "Theme & Customize", Icon: Palette },
              { href: "/admin/settings/store", label: "Store Settings", Icon: Store },
            ]
          : []),
      ],
    },
    {
      title: "Marketing",
      links: [
        ...(hasArea("coupons")
          ? [{ href: "/admin/marketing/promotions", label: "Promotions", Icon: Megaphone }]
          : []),
        ...(hasArea("content")
          ? [{ href: "/admin/marketing/seo", label: "SEO Settings", Icon: Search }]
          : []),
      ],
    },
    {
      title: "System",
      links: [
        ...(hasArea("users")
          ? [{ href: "/admin/system/users", label: "User role", Icon: ShieldCheck }]
          : []),
        ...(staffKnown
          ? [{ href: "/admin/system/notifications", label: "Notifications", Icon: Bell }]
          : []),
        ...(hasArea("settings")
          ? [{ href: "/admin/settings/general", label: "General Settings", Icon: Settings }]
          : []),
        ...(hasArea("settings")
          ? [{ href: "/admin/system/redirects", label: "Redirects", Icon: ArrowLeftRight }]
          : []),
        ...(hasArea("settings")
          ? [{ href: "/admin/system/smtp", label: "Email (SMTP)", Icon: Mail }]
          : []),
        ...(staffKnown
          ? [{ href: "/admin/settings/password", label: "Change Password", Icon: KeyRound }]
          : []),
      ],
    },
    {
      title: "Staging tools",
      links: [
        ...(canRead && stagingTools && taxonomyTools
          ? [{ href: "/admin/catalogue", label: "Categories & Collections", Icon: Tags }]
          : []),
        ...(canManage && stagingTools
          ? [{ href: "/admin/media", label: "Private media", Icon: ImageIcon }]
          : []),
      ],
    },
  ].filter((group) => group.links.length > 0);

  const allHrefs = groups.flatMap((group) => group.links.map((link) => link.href));
  const current = (href: string) => {
    if (href === "/admin") return path === "/admin";
    if (path === href) return true;
    if (!path.startsWith(`${href}/`)) return false;
    // Longest-prefix wins: /admin/catalog/products/new beats /admin/catalog/products.
    return !allHrefs.some(
      (other) =>
        other !== href &&
        other.startsWith(`${href}/`) &&
        (path === other || path.startsWith(`${other}/`)),
    );
  };

  const navigation = (
    <>
      <nav aria-label="Admin navigation">
        {groups.map((group) => (
          <details className="aa-nav-group" key={group.title} open>
            <summary>{group.title}</summary>
            {group.links.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={current(href) ? "page" : undefined}
                onClick={() => drawer.current?.close()}
              >
                <Icon size={16} strokeWidth={1.6} aria-hidden="true" />
                {label}
              </Link>
            ))}
          </details>
        ))}
      </nav>
      <details className="aa-unavailable">
        <summary>Service availability</summary>
        <p>
          Orders, reporting, products, customers and coupons are connected
          through this panel. Payment verification and online payment are not
          connected yet. Abandoned-checkout marking runs only from scheduled
          SQL, not automatically.
        </p>
      </details>
      <Link className="aa-visit-store" href="/">
        Visit store <ArrowUpRight size={15} aria-hidden="true" />
      </Link>
      {staffKnown ? (
        <>
          <p className="aa-role">
            {roles.map((r) => r.replaceAll("_", " ")).join(", ")} · MFA verified
          </p>
          <form action={signOutStaff}>
            <button className="aa-secondary">Sign out</button>
          </form>
        </>
      ) : null}
    </>
  );
  return (
    <div className="aa-shell">
      <aside className="aa-sidebar">
        <Link href="/admin" aria-label="Attires Arena administration">
          <Image
            src={stagingTools ? "/brand/logo-white.png" : "/brand/logo-maroon.png"}
            alt="Attires Arena"
            width={90}
            height={86}
            style={{ objectFit: "contain" }}
          />
        </Link>
        <p className="aa-eyebrow">Administration</p>
        {navigation}
      </aside>
      <div className="aa-content">
        <header className="aa-top">
          <button
            type="button"
            className="aa-mobile-toggle aa-secondary"
            onClick={() => drawer.current?.showModal()}
            aria-haspopup="dialog"
          >
            Menu
          </button>
          <Image
            className="aa-mobile-brand"
            src={stagingTools ? "/brand/logo-white.png" : "/brand/logo-maroon.png"}
            alt="Attires Arena"
            width={46}
            height={44}
          />
          {canRead && stagingTools ? (
            <form className="aa-global-search" action="/admin/catalog/products">
              <Search size={16} strokeWidth={1.6} aria-hidden="true" />
              <input
                name="q"
                type="search"
                aria-label="Search products"
                placeholder="Search products…"
                maxLength={120}
              />
            </form>
          ) : (
            <span className="aa-admin-title">Administration</span>
          )}
          <span className="aa-environment">
            <ShieldCheck size={14} aria-hidden="true" />
            {stagingTools ? "Staging workspace" : "Store management"}
          </span>
        </header>
        <dialog ref={drawer} className="aa-drawer" aria-label="Administration menu">
          <button type="button" className="aa-secondary" onClick={() => drawer.current?.close()}>
            Close menu
          </button>
          {navigation}
        </dialog>
        {children}
        {stagingTools && (
          <nav className="aa-admin-bottom" aria-label="Mobile admin navigation">
            <Link href="/admin" aria-current={path === "/admin" ? "page" : undefined}>
              <LayoutDashboard size={20} aria-hidden="true" />
              Home
            </Link>
            {canRead && taxonomyTools && (
              <Link
                href="/admin/catalogue"
                aria-current={path === "/admin/catalogue" ? "page" : undefined}
              >
                <Tags size={20} aria-hidden="true" />
                Categories
              </Link>
            )}
            <button type="button" onClick={() => drawer.current?.showModal()} aria-haspopup="dialog">
              <Menu size={20} aria-hidden="true" />
              More
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
