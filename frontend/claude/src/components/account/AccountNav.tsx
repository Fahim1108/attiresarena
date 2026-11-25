"use client";

import { Heart, LogOut, MapPin, Package, Truck, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { signOutCustomer } from "@/lib/customer/actions";

const links = [
  { href: "/account", label: "Profile", Icon: User },
  { href: "/account/orders", label: "Orders", Icon: Package },
  { href: "/account/addresses", label: "Addresses", Icon: MapPin },
  { href: "/wishlist", label: "Wishlist", Icon: Heart },
  { href: "/track-order", label: "Track Order", Icon: Truck },
];

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account">
      <ul className="flex flex-col gap-1">
        {links.map(({ href, label, Icon }) => {
          const active = href === "/account" ? pathname === "/account" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex items-center gap-2.5 whitespace-nowrap rounded-control px-3.5 py-3 text-sm transition-colors", active ? "bg-selected text-primary" : "border border-line text-ink hover:bg-ink/5 lg:border-transparent")}
              >
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </Link>
            </li>
          );
        })}
        <li className="mt-3 border-t border-line pt-3">
          <form action={signOutCustomer}>
            <button type="submit" className="flex w-full cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-control border border-line px-3.5 py-3 text-sm text-ink-muted hover:text-primary lg:border-transparent">
              <LogOut className="h-4 w-4" aria-hidden /> Sign Out
            </button>
          </form>
        </li>
      </ul>
    </nav>
  );
}
