"use client";

import { Tag, Truck } from "lucide-react";
import { useStorefront } from "@/context/StorefrontContext";

/**
 * Desktop/tablet only — the approved mobile mockup has no announcement strip.
 * The delivery message is never truncated: below xl it is the only line,
 * centred, with room to fit; at xl the side messages join it in a
 * three-column bar. (2026-11-21: the old three-column `truncate` layout cut
 * the "…৳140 outside" end off at tablet/desktop widths.)
 */
export function AnnouncementBar() {
  const { header } = useStorefront();
  const { announcement: a } = header;
  if (!a.enabled) return null;
  return (
    <div className="hidden bg-primary text-white sm:block">
      <div className="container flex min-h-9 items-center justify-center gap-4 py-2 text-xs lg:grid lg:grid-cols-[1fr_auto_1fr] lg:py-0">
        <p className="flex min-w-0 items-center justify-center gap-2 lg:justify-start">
          {a.left && (
            <>
              <Truck className="h-4 w-4 shrink-0" strokeWidth={1.6} aria-hidden /> {a.left}
            </>
          )}
        </p>
        <p className="hidden min-w-0 text-center xl:block">
          {a.items.map((item, i) => (
            <span key={item}>
              {i > 0 && <span className="mx-3 opacity-50" aria-hidden>|</span>}
              {item}
            </span>
          ))}
        </p>
        <p className="hidden min-w-0 items-center justify-end gap-2 lg:flex">
          {a.promo && (
            <>
              <Tag className="h-4 w-4 shrink-0" strokeWidth={1.6} aria-hidden /> {a.promo}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
