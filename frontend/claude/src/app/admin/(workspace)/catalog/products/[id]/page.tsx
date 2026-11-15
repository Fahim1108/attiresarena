import Link from "next/link";
import { notFound } from "next/navigation";
import {
  readCatalogProduct,
  readCategoryOptionsWithStatus,
  updateCatalogProduct,
} from "@/lib/admin/catalog-products";
import { readProductMedia } from "@/lib/admin/catalog-media";
import { publicationVisibility } from "@/lib/admin/catalog-variants";
import { Notice, PageHeading, Panel } from "@/components/admin/ui";
import { ImageUploader } from "@/components/admin/catalog/image-uploader";
import { ProductForm } from "@/components/admin/catalog/product-form";
import { PublicationActions } from "@/components/admin/catalog/publication-actions";

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
  const read = await readCatalogProduct(id);
  if (read.status === "not-found") notFound();
  if (read.status === "unavailable") {
    // Honest error state inside the admin layout — never the generic
    // boundary, and never a claim about whether a save went through.
    return (
      <main id="main" tabIndex={-1} className="aa-main">
        <PageHeading
          eyebrow="Catalog / Products"
          title="Product could not be read"
          description="This product could not be loaded."
          actions={
            <Link href="/admin/catalog/products" className="aa-secondary">
              Back to products
            </Link>
          }
        />
        <Panel title="The product details are unavailable">
          <p className="aa-muted">
            This product could not be loaded. It may have been deleted or
            changed, or the database could not be reached. If you just
            saved this product, check the products list before saving
            again — the save may have gone through even though this page
            did not load.
          </p>
          <p>
            <Link
              href={`/admin/catalog/products/${id}`}
              className="aa-secondary"
            >
              Retry
            </Link>{" "}
            <Link href="/admin/catalog/products" className="aa-secondary">
              Back to products
            </Link>
          </p>
        </Panel>
      </main>
    );
  }
  const detail = read.detail;
  const [categoryRead, mediaRead] = await Promise.all([
    readCategoryOptionsWithStatus(),
    readProductMedia(id),
  ]);
  const categories = categoryRead.options;
  const media = mediaRead.items;
  const { product, variants, canManage, canViewCosts } = detail;
  const saved = typeof query.saved === "string" ? query.saved : "";
  const categoriesFailed = query.categories === "failed";
  const imagesFailed = Number.parseInt(
    typeof query.images_failed === "string" ? query.images_failed : "0",
    10,
  );
  const visibility = publicationVisibility(
    product.status,
    product.is_published,
  );
  const isLegacyDraft = product.status === "draft";

  // The Pricing section only feeds the default variant when no variants
  // exist; with exactly one variant, pre-fill it from that variant so the
  // form shows the real numbers instead of blanks.
  const single = variants.length === 1 ? variants[0] : undefined;

  // The form is editable only when every section it can overwrite was
  // read completely. A missing category option could silently unassign
  // the product's category on save, and missing variants would hide
  // real data the owner expects to edit. Stock and gallery failures
  // only affect displayed figures, so they degrade with notices while
  // the form stays editable; the gallery stays usable because adding
  // images is append-only and never overwrites existing rows.
  const formReadOnly =
    categoryRead.unavailable ||
    categoryRead.skipped > 0 ||
    detail.variantsUnavailable;
  const formCanManage = canManage && !formReadOnly;

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
      {categoriesFailed ? (
        <Notice kind="warning">
          Product saved, but the category assignment could not be saved.
          Check the categories below and save again.
        </Notice>
      ) : null}
      {query.images === "partial" && imagesFailed > 0 ? (
        <Notice kind="warning">
          {imagesFailed} staged image{imagesFailed === 1 ? "" : "s"} could
          not be attached. Add the missing image{imagesFailed === 1 ? "" : "s"}{" "}
          below.
        </Notice>
      ) : null}
      {categoryRead.unavailable ? (
        <Notice kind="warning">
          Category options could not be read, so this form is read-only.
          Reload to try again — saving without the full category list
          could remove this product&apos;s category assignment.
        </Notice>
      ) : null}
      {!categoryRead.unavailable && categoryRead.skipped > 0 ? (
        <Notice kind="warning">
          {categoryRead.skipped} categor
          {categoryRead.skipped === 1 ? "y option" : "y options"} could not
          be read, so this form is read-only. Reload to try again — the
          missing options could include this product&apos;s category.
        </Notice>
      ) : null}
      {detail.variantsUnavailable ? (
        <Notice kind="warning">
          Product variants could not be read, so this form is read-only.
          Reload to try again.
        </Notice>
      ) : null}
      {!detail.variantsUnavailable && detail.variantsSkipped > 0 ? (
        <Notice kind="warning">
          {detail.variantsSkipped} variant
          {detail.variantsSkipped === 1 ? "" : "s"} could not be read and{" "}
          {detail.variantsSkipped === 1 ? "is" : "are"} not shown below.{" "}
          {detail.variantsSkipped === 1 ? "It was" : "They were"} not changed.
        </Notice>
      ) : null}
      {detail.inventoryUnavailable ? (
        <Notice kind="warning">
          Stock figures could not be read, so stock fields below show
          defaults. Check Inventory for the real stock.
        </Notice>
      ) : null}
      {!detail.inventoryUnavailable && detail.inventorySkipped > 0 ? (
        <Notice kind="warning">
          Stock figures for {detail.inventorySkipped} variant
          {detail.inventorySkipped === 1 ? "" : "s"} could not be read, so{" "}
          {detail.inventorySkipped === 1 ? "its" : "those"} stock field
          {detail.inventorySkipped === 1 ? "" : "s"} show
          {detail.inventorySkipped === 1 ? "s" : ""} a default. Check
          Inventory for the real stock.
        </Notice>
      ) : null}
      {mediaRead.unavailable ? (
        <Notice kind="warning">
          Product images could not be read. You can still add new images
          below, or reload to try again.
        </Notice>
      ) : null}
      {!mediaRead.unavailable && mediaRead.skipped > 0 ? (
        <Notice kind="warning">
          {mediaRead.skipped} image{mediaRead.skipped === 1 ? "" : "s"}{" "}
          could not be read and {mediaRead.skipped === 1 ? "is" : "are"}{" "}
          not shown below. {mediaRead.skipped === 1 ? "It was" : "They were"}{" "}
          not changed.
        </Notice>
      ) : null}
      <Panel title="Storefront publication">
        <p className="aa-muted">
          Publishing shows this product on the public storefront. Published
          products are visible but cannot be ordered yet. Unpublishing
          removes it from the storefront at once.
          {product.published_at
            ? ` Last published ${new Date(product.published_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.`
            : ""}
        </p>
        <p className="aa-muted">
          To publish, a product needs a name, a description, a visible
          category, at least one image, and an active variant with a price
          and stock.
        </p>
        <PublicationActions
          productId={product.id}
          productName={product.name}
          visibility={visibility}
          canManage={canManage}
        />
      </Panel>
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
          secondaryCategoryId: product.secondary_category_id,
          brand: product.brand,
          highlights: product.highlights,
          tags: product.tags,
          badges: product.badges,
          seoTitle: product.seo_title,
          seoDescription: product.seo_description,
          metaKeywords: product.meta_keywords,
          youtubeVideoId: product.youtube_video_id,
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
        canManage={formCanManage}
        canViewCosts={canViewCosts}
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
