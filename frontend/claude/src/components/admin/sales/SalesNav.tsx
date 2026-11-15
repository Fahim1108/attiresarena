import Link from "next/link";

export type SalesSection = "orders" | "incomplete" | "customers" | "coupons";

const SECTIONS: { key: SalesSection; href: string; label: string }[] = [
  { key: "orders", href: "/admin/sales/orders", label: "Orders" },
  { key: "incomplete", href: "/admin/sales/incomplete", label: "Incomplete orders" },
  { key: "customers", href: "/admin/sales/customers", label: "Customers" },
  { key: "coupons", href: "/admin/sales/coupons", label: "Coupons" },
];

/** Section tabs for the sales area (the sidebar has no sales links yet). */
export function SalesNav({ current }: { current: SalesSection }) {
  return (
    <nav className="aa-tabs" aria-label="Sales sections">
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
