import Link from "next/link";
import { notFound } from "next/navigation";
import {
  readCatalogProduct,
  readCategoryOptions,
  updateCatalogProduct,
} from "@/lib/admin/catalog-products";
import { readProductMedia } from "@/lib/admin/catalog-media";
import { Notice, PageHeading } from "@/components/admin/ui";
import { ImageUploader } from "@/components/admin/catalog/image-uploader";
import { ProductForm } from "@/components/admin/catalog/product-form";

export const metadata = { title: "Edit product" };

export default async function EditCatalogProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const detail = await readCatalogProduct(id);
  if (!detail) notFound();
  const [categories, media] = await Promise.all([
    readCategoryOptions(),
    readProductMedia(id),
  ]);
  const { product, variants, canManage } = detail;
  const saved = typeof query.saved === "string" ? query.saved : "";
  const isLegacyDraft = product.status === "draft";

  // The Pricing section only feeds the default variant when no variants
  // exist; with exactly one variant, pre-fill it from that variant so the
  // form shows the real numbers instead of blanks.
  const single = variants.length === 1 ? variants[0] : undefined;

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Catalog / Products"
        title={product.name}
        description={`${product.slug}${detail.categoryName ? ` · ${detail.categoryName}` : ""}`}
        actions={
          <Link href="/admin/catalog/products" className="aa-secondary">
            Back to products
          </Link>
        }
      />
      {saved === "updated" ? (
        <Notice kind="success">Product saved.</Notice>
      ) : null}
      {saved === "created" ? (
        <Notice kind="success">
          Product created. Add images below, or adjust stock in Inventory.
        </Notice>
      ) : null}
      {saved === "duplicated" ? (
        <Notice kind="success">
          Product duplicated as Inactive, with no stock and no images. Set
          stock in Inventory and add images below.
        </Notice>
      ) : null}
      {isLegacyDraft ? (
        <Notice kind="warning">
          This product is in Draft status from an older workflow. This panel
          only offers Active and Inactive: saving here will set one of those
          two. Draft is not available in this panel.
        </Notice>
      ) : null}
      <ProductForm
        mode="edit"
        action={updateCatalogProduct}
        productId={product.id}
        updatedAt={product.updated_at}
        initial={{
          name: product.name,
          slug: product.slug,
          description: product.description,
          status: product.status === "published" ? "published" : "archived",
          categoryId: product.category_id,
          brand: product.brand,
          highlights: product.highlights,
          tags: product.tags,
          badges: product.badges,
          seoTitle: product.seo_title,
          seoDescription: product.seo_description,
          metaKeywords: product.meta_keywords,
          basePriceMinor: single?.price_minor ?? null,
          baseSaleMinor: single?.sale_price_minor ?? null,
          baseCostMinor: single?.cost_price_minor ?? null,
          baseStock: single?.inventory?.on_hand ?? 1,
        }}
        variants={variants.map((variant) => ({
          id: variant.id,
          size: variant.size,
          color: variant.color,
          price_minor: variant.price_minor,
          sale_price_minor: variant.sale_price_minor,
          cost_price_minor: variant.cost_price_minor,
          stock: variant.inventory?.on_hand ?? 1,
          active: variant.active,
          onHand: variant.inventory?.on_hand ?? null,
          available: variant.inventory?.available ?? null,
        }))}
        categories={categories}
        canManage={canManage}
        imageCount={media.length}
        imagesPanel={
          <ImageUploader
            productId={product.id}
            images={media}
            canManage={canManage}
          />
        }
      />
    </main>
  );
}
