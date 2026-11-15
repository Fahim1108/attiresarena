"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCatalog } from "./CatalogContext";

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
  const { update } = useCatalog();
  if (totalPages <= 1) return null;
  const go = (p: number) => {
    update({ page: p });
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const btn = "flex h-11 min-w-11 items-center justify-center rounded-control border px-3 text-sm transition-colors";
  return (
    <nav aria-label="Pagination" className="mt-12 flex flex-wrap items-center justify-center gap-1.5">
      <button type="button" onClick={() => go(page - 1)} disabled={page <= 1} className={cn(btn, "border-[#8f8985] disabled:cursor-not-allowed disabled:opacity-70")} aria-label="Previous page">
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      {pages(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-ink-muted">…</span>
        ) : (
          <button key={p} type="button" onClick={() => go(p)} aria-current={p === page ? "page" : undefined} className={cn(btn, p === page ? "border-primary bg-primary text-white" : "border-[#8f8985] text-ink hover:border-primary")}>
            {p}
          </button>
        ),
      )}
      <button type="button" onClick={() => go(page + 1)} disabled={page >= totalPages} className={cn(btn, "border-[#8f8985] disabled:cursor-not-allowed disabled:opacity-70")} aria-label="Next page">
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </nav>
  );
}
