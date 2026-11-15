import {
  canViewProductCosts,
  requireStaff,
} from "@/lib/admin/authorization";
import { areaRoles } from "@/lib/admin/constants";
import {
  createCatalogProduct,
  readCategoryOptions,
} from "@/lib/admin/catalog-products";
import { PageHeading } from "@/components/admin/ui";
import { ProductForm } from "@/components/admin/catalog/product-form";
import { StagedImageUploader } from "@/components/admin/catalog/staged-image-uploader";

export const metadata = { title: "Add product" };

export default async function NewCatalogProductPage() {
  const session = await requireStaff(areaRoles("catalogue"));
  const categories = await readCategoryOptions();

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Catalog / Products"
        title="Add product"
        description="Create a product with pricing, variants, badges and SEO. Photos can be staged below and are attached when you save."
      />
      <ProductForm
        mode="create"
        action={createCatalogProduct}
        initial={{
          name: "",
          slug: "",
          description: "",
          status: "published",
          categoryId: null,
          secondaryCategoryId: null,
          brand: null,
          highlights: [],
          tags: [],
          badges: [],
          seoTitle: null,
          seoDescription: null,
          metaKeywords: null,
          basePriceMinor: null,
          baseSaleMinor: null,
          baseCostMinor: null,
          baseStock: 1,
        }}
        variants={[]}
        categories={categories}
        canManage
        canViewCosts={canViewProductCosts(session)}
        imageCount={0}
        imagesPanel={null}
        stagedPanel={<StagedImageUploader />}
      />
    </main>
  );
}
