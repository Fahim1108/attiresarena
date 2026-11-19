import Link from "next/link";
import { Hourglass, Receipt, Tag, Users } from "lucide-react";
import { LinkPendingHint } from "@/components/admin/LinkPendingHint";

export type SalesSection = "orders" | "incomplete" | "customers" | "coupons";

const SECTIONS: {
  key: SalesSection;
  href: string;
  label: string;
  Icon: typeof Receipt;
}[] = [
  { key: "orders", href: "/admin/sales/orders", label: "Orders", Icon: Receipt },
  { key: "incomplete", href: "/admin/sales/incomplete", label: "Incomplete orders", Icon: Hourglass },
  { key: "customers", href: "/admin/sales/customers", label: "Customers", Icon: Users },
  { key: "coupons", href: "/admin/sales/coupons", label: "Coupons", Icon: Tag },
];

/** Section tabs for the sales area, mirroring the sidebar sales links. */
export function SalesNav({ current }: { current: SalesSection }) {
  return (
    <nav className="aa-tabs" aria-label="Sales sections">
      {SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={section.href}
          aria-current={section.key === current ? "page" : undefined}
        >
          <section.Icon size={16} strokeWidth={1.6} aria-hidden="true" />
          {section.label}
          <LinkPendingHint />
        </Link>
      ))}
    </nav>
  );
}
