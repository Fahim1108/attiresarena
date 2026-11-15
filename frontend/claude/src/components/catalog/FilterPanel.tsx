"use client";

import { useState } from "react";
import { Accordion, Checkbox } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import type { CatalogFacets } from "@/types";
import { useCatalog } from "./CatalogContext";
import { parsePriceBounds } from "./catalog-url";

const toggle = (list: string[] | undefined, value: string) => {
  const cur = list ?? [];
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  return next.length ? next : undefined;
};

/**
 * Price range section. Uncontrolled inputs (default values from the URL
 * query) applied in one navigation via the same `update` path as every
 * other filter, so price composes with category/brand/size/sort and
 * Clear-all exactly like the verified filter behavior. The form remounts
 * when the URL price changes (back/forward, chip removal), so the inputs
 * always reflect the active range. Hidden when the facet range is empty.
 */
function PriceFilterSection({ facets }: { facets: CatalogFacets }) {
  const { query, update } = useCatalog();
  const [error, setError] = useState<string | null>(null);
  const hasPriceFilter = query.minPrice !== undefined || query.maxPrice !== undefined;
  const formKey = `${query.minPrice ?? ""}-${query.maxPrice ?? ""}`;
  return (
    <form
      key={formKey}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const minRaw = typeof data.get("minPrice") === "string" ? (data.get("minPrice") as string) : "";
        const maxRaw = typeof data.get("maxPrice") === "string" ? (data.get("maxPrice") as string) : "";
        const parsed = parsePriceBounds(minRaw, maxRaw);
        if (!parsed.ok) {
          setError(parsed.error);
          return;
        }
        setError(null);
        update({ minPrice: parsed.minPrice, maxPrice: parsed.maxPrice });
      }}
    >
      <p className="mb-3 text-xs text-ink-muted">
        {formatPrice(facets.priceRange.min)} – {formatPrice(facets.priceRange.max)} in this
        catalogue
      </p>
      <div className="flex items-end gap-2">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-ink-muted">Min (৳)</span>
          <input
            name="minPrice"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={query.minPrice ?? ""}
            placeholder={String(facets.priceRange.min)}
            aria-label="Minimum price in taka"
            className="h-11 w-full rounded-control border border-line bg-white px-2.5 text-sm text-ink"
          />
        </label>
        <span aria-hidden className="pb-3 text-ink-muted">–</span>
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-ink-muted">Max (৳)</span>
          <input
            name="maxPrice"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={query.maxPrice ?? ""}
            placeholder={String(facets.priceRange.max)}
            aria-label="Maximum price in taka"
            className="h-11 w-full rounded-control border border-line bg-white px-2.5 text-sm text-ink"
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          className="h-11 rounded-control bg-primary px-4 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary-dark"
        >
          Apply price
        </button>
        {hasPriceFilter ? (
          <button
            type="button"
            onClick={() => update({ minPrice: undefined, maxPrice: undefined })}
            className="h-11 rounded-control border border-line px-4 text-sm text-ink transition-colors duration-200 hover:border-ink/50"
          >
            Clear price
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function FilterPanel({ facets }: { facets: CatalogFacets }) {
  const { query, update, locked } = useCatalog();

  const items = [
    !locked.category &&
      facets.categories.length > 0 && {
        id: "category",
        title: "Category",
        content: (
          <ul className="space-y-2.5">
            {facets.categories.map((c) => (
              <li key={c.slug}>
                <Checkbox
                  label={
                    <span className="flex w-full justify-between gap-3">
                      {c.name} <span className="text-xs text-ink-muted">{c.count}</span>
                    </span>
                  }
                  checked={query.categorySlugs?.includes(c.slug) ?? false}
                  onChange={() => update((q) => ({ categorySlugs: toggle(q.categorySlugs, c.slug) }))}
                  className="[&>span]:flex-1"
                />
              </li>
            ))}
          </ul>
        ),
      },
    !locked.brand &&
      facets.brands.length > 0 && {
        id: "brand",
        title: "Brand",
        content: (
          <ul className="space-y-2.5">
            {facets.brands.map((b) => (
              <li key={b.slug}>
                <Checkbox
                  label={
                    <span className="flex w-full justify-between gap-3">
                      {b.name} <span className="text-xs text-ink-muted">{b.count}</span>
                    </span>
                  }
                  checked={query.brandSlugs?.includes(b.slug) ?? false}
                  onChange={() => update((q) => ({ brandSlugs: toggle(q.brandSlugs, b.slug) }))}
                  className="[&>span]:flex-1"
                />
              </li>
            ))}
          </ul>
        ),
      },
    facets.sizes.length > 0 && {
      id: "size",
      title: "Size",
      content: (
        <div className="flex flex-wrap gap-2">
          {facets.sizes.map((s) => {
            const active = query.sizes?.includes(s) ?? false;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => update((q) => ({ sizes: toggle(q.sizes, s) }))}
                className={cn("h-11 min-w-[44px] rounded-control border px-2.5 text-sm transition-colors duration-200", active ? "border-primary bg-primary text-white" : "border-line text-ink hover:border-ink/50")}
              >
                {facets.sizeLabels?.[s] ?? s}
              </button>
            );
          })}
        </div>
      ),
    },
    facets.priceRange.max > 0 && {
      id: "price",
      title: "Price",
      content: <PriceFilterSection facets={facets} />,
    },
    {id:'availability',title:'Availability',content:<Checkbox label="In stock" checked={query.inStock??false} onChange={()=>update((q)=>({inStock:q.inStock?undefined:true}))}/>},
  ].filter(Boolean) as { id: string; title: string; content: React.ReactNode }[];

  return <Accordion items={items} defaultOpen={items.map((i) => i.id)} className="border-t-0" />;
}
