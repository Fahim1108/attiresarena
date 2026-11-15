import { requireStaff } from "@/lib/admin/authorization";
import { areaRoles } from "@/lib/admin/constants";
import {
  createCatalogProduct,
  readCategoryOptions,
} from "@/lib/admin/catalog-products";
import { PageHeading, Panel } from "@/components/admin/ui";
import { ProductForm } from "@/components/admin/catalog/product-form";

export const metadata = { title: "Add product" };

export default async function NewCatalogProductPage() {
  await requireStaff(areaRoles("catalogue"));
  const categories = await readCategoryOptions();

  return (
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Catalog / Products"
        title="Add product"
        description="Create a product with pricing, variants, badges and SEO. Images are added after the product is saved."
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
        imageCount={0}
        imagesPanel={
          <Panel title="Images">
            <p>
              Save the product first, then add images on its edit page. Images
              are stored privately and shown with signed URLs.
            </p>
          </Panel>
        }
      />
    </main>
  );
}
