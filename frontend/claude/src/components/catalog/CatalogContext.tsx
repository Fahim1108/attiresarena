"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState, useTransition, type ReactNode } from "react";
import { ProductGridSkeleton } from "@/components/ui/LoadingSkeleton";
import type { ProductQueryInput } from "@/services";
import { applyCatalogPatch, catalogHref, EMPTY_CATALOG_QUERY, type CatalogLocked, type CatalogPatch } from "./catalog-url";

interface CatalogContextValue {
  query: ProductQueryInput;
  /** Filters fixed by the page (e.g. category on a category page). Not shown as removable. */
  locked: CatalogLocked;
  pending: boolean;
  update: (patch: CatalogPatch) => void;
  reset: () => void;
}

const Ctx = createContext<CatalogContextValue | null>(null);

/** URL is the single source of truth for catalogue filters — easy for a backend to read. */
export function CatalogProvider({ query, locked = {}, children }: { query: ProductQueryInput; locked?: CatalogContextValue["locked"]; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // Latest intended query, updated synchronously on every interaction. The
  // server-rendered `query` prop only refreshes when a navigation commits, so
  // merging onto it drops any change made while a navigation is still pending
  // (filter controls stay interactive during the pending skeleton). Merging
  // onto the intended state keeps filter + sort + search composed in the URL.
  const [intended, setIntended] = useState(query);
  const [prevQuery, setPrevQuery] = useState(query);
  // Once navigation settles, the server query is the truth again: it also picks
  // up back/forward and external links. Never sync while pending — the
  // committed prop may still reflect an older navigation than the latest intent.
  if (query !== prevQuery && !pending) {
    setPrevQuery(query);
    setIntended(query);
  }

  const navigate = useCallback(
    (q: ProductQueryInput) => {
      setIntended(q);
      const href = catalogHref(pathname, q, { category: locked.category, brand: locked.brand });
      startTransition(() => router.push(href, { scroll: false }));
    },
    [router, pathname, locked.category, locked.brand],
  );

  const update = useCallback((patch: CatalogPatch) => navigate(applyCatalogPatch(intended, patch)), [navigate, intended]);
  // Clear all resets everything: filters, sort and search. Locked slugs are
  // path-derived, so the page restores them without any URL param.
  const reset = useCallback(() => navigate(EMPTY_CATALOG_QUERY), [navigate]);

  return <Ctx.Provider value={{ query: intended, locked, pending, update, reset }}>{children}</Ctx.Provider>;
}

export function useCatalog() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCatalog must be used inside <CatalogProvider>");
  return c;
}

export function CatalogResults({ children }: { children: ReactNode }) {
  const { pending } = useCatalog();
  return (
    <div aria-busy={pending} className="aa-content-pending">
      {pending && <ProductGridSkeleton/>}
      <div data-results-content className={pending ? "hidden" : undefined}>{children}</div>
    </div>
  );
}
