import type { Metadata } from "next";
import { logo, site } from "@/config";
import { CategoryCard } from "@/components/category/CategoryCard";
import { buildPageMetadata, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";
import { getStorefrontContent } from "@/lib/store-settings";
import { Breadcrumbs, ButtonLink, EmptyState } from "@/components/ui";
import { getCategories, getProducts } from "@/services";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getStorefrontContent();
  return buildPageMetadata({ siteName: site.name, path: "/categories", title: "Categories", description: "Everything you need for a complete, considered wardrobe.", defaultImage: resolveDefaultOgImage(content?.settings, logo.badge, site.name), twitterCard: resolveTwitterCard(content?.settings) ?? "summary_large_image" });
}

export default async function CategoriesPage() {
  const [categories, all] = await Promise.all([getCategories(), getProducts({ pageSize: 1 })]);
  const counts = Object.fromEntries(all.facets.categories.map((c) => [c.slug, c.count]));
  return (
    <div className="container py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Categories" }]} />
      <h1 className="mt-4 text-balance font-serif text-4xl text-ink sm:text-5xl">Shop by Category</h1>
      <p className="mt-2 text-sm text-ink-muted">Everything you need for a complete, considered wardrobe.</p>
      {categories.length ? (
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3">
          {categories.map((c) => (
            <li key={c.id}>
              <CategoryCard category={c} variant="feature" productCount={counts[c.slug] ?? 0} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No categories available"
          description="Categories will appear here once the collection is ready."
          action={<ButtonLink href="/shop">Browse products</ButtonLink>}
        />
      )}
    </div>
  );
}
