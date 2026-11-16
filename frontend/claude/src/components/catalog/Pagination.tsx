"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useCatalog } from "./CatalogContext";
import { applyCatalogPatch, catalogHref } from "./catalog-url";

function pages(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1), end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}

export function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  const { query, locked } = useCatalog();
  const pathname = usePathname();
  if (totalPages <= 1) return null;
  // Crawlable links: the hrefs reuse the exact URL builder the filter
  // navigation already uses (same query merge, locked slugs stripped), so
  // a pagination link lands on the same URL the button navigation wrote.
  // No rel="prev"/"next": Google deprecated it; the clean canonical on the
  // listing page is the dedupe signal.
  const hrefFor = (p: number) => catalogHref(pathname, applyCatalogPatch(query, { page: p }), locked);
  const scrollTop = () => {
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const btn = "flex h-11 min-w-11 items-center justify-center rounded-control border px-3 text-sm transition-colors";
  return (
    <nav aria-label="Pagination" className="mt-12 flex flex-wrap items-center justify-center gap-1.5">
      {page <= 1 ? (
        <span className={cn(btn, "cursor-not-allowed border-[#8f8985] opacity-70")} aria-disabled="true">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </span>
      ) : (
        <Link href={hrefFor(page - 1)} scroll={false} onClick={scrollTop} className={cn(btn, "border-[#8f8985]")} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
      )}
      {pages(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-ink-muted">…</span>
        ) : p === page ? (
          <span key={p} aria-current="page" className={cn(btn, "border-primary bg-primary text-white")}>
            {p}
          </span>
        ) : (
          <Link key={p} href={hrefFor(p)} scroll={false} onClick={scrollTop} className={cn(btn, "border-[#8f8985] text-ink hover:border-primary")}>
            {p}
          </Link>
        ),
      )}
      {page >= totalPages ? (
        <span className={cn(btn, "cursor-not-allowed border-[#8f8985] opacity-70")} aria-disabled="true">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </span>
      ) : (
        <Link href={hrefFor(page + 1)} scroll={false} onClick={scrollTop} className={cn(btn, "border-[#8f8985]")} aria-label="Next page">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </nav>
  );
}
