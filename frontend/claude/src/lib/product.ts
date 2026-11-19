import type { Product, ProductImage, ProductVariant } from "@/types";
import { APPAREL_SIZES, canonicalSize } from "@/lib/catalogue-dimensions";

export function imagesForColor(product: Product, colorId?: string): ProductImage[] {
  if (colorId && product.imagesByColor[colorId]?.length) return product.imagesByColor[colorId]!;
  return product.defaultImages;
}

export function findVariant(product: Product, colorId: string, size: string): ProductVariant | undefined {
  return product.variants.find((v) => v.colorId === colorId && v.size === size);
}

export function variantPrice(product: Product, variant?: ProductVariant): number {
  return variant?.price ?? product.price;
}

export function isSizeAvailable(product: Product, colorId: string, size: string): boolean {
  return (findVariant(product, colorId, size)?.stock ?? 0) > 0;
}

export function totalStock(product: Product): number {
  return product.variants.reduce((sum, v) => sum + v.stock, 0);
}

/**
 * Sizes the shopper can actually select on the product page. With apparel
 * sizing the selector shows the fixed template list (a variant whose size
 * name is not a canonical apparel size never appears as a button), so
 * stock behind such a size must not count toward "in stock" anywhere:
 * the panel button, the status line, and the shop card all read this list.
 */
export function displayedSizes(product: Product): string[] {
  return product.apparelSizing && canonicalSize(product.sizes[0] ?? "")
    ? APPAREL_SIZES.map(
        (label) =>
          (product.sizeOptions ?? product.sizes).find(
            (s) => canonicalSize(s) === label,
          ) ?? label,
      )
    : (product.sizeOptions ?? product.sizes);
}

/**
 * Stock summed over displayed sizes only. With a colour given, only that
 * colour counts (product page); without one, every colour counts (shop
 * card, which shows the first colour but must not call a product sold out
 * while another colour still has a selectable size).
 */
export function selectableStock(product: Product, colorId?: string): number {
  const colors = colorId
    ? [colorId]
    : product.colors.map((c) => c.id);
  return colors.reduce(
    (sum, color) =>
      sum +
      displayedSizes(product).reduce(
        (sizeSum, size) =>
          sizeSum + (findVariant(product, color, size)?.stock ?? 0),
        0,
      ),
    0,
  );
}

export function firstAvailableSize(product: Product, colorId: string): string | undefined {
  return product.sizes.find((s) => isSizeAvailable(product, colorId, s));
}

/** Builds a cart line (without quantity) from a product + selected variant. */
export function toCartLine(product: Product, variant: ProductVariant, brandName = "") {
  return {
    id: `${product.id}:${variant.id}`,
    productId: product.id,
    productSlug: product.slug,
    variantId: variant.id,
    name: product.name,
    brandName,
    image: imagesForColor(product, variant.colorId)[0] ?? { src: "", alt: product.name },
    colorName: product.colors.find((c) => c.id === variant.colorId)?.name ?? variant.colorId,
    size: variant.size,
    unitPrice: variantPrice(product, variant),
    compareAtPrice: product.compareAtPrice,
    maxQuantity: variant.stock,
  };
}
