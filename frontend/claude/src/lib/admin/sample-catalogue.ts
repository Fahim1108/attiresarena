/**
 * Display-only sample catalogue data (Admin Panel v2, owner item 7).
 *
 * Shown ONLY when a live catalogue query is unavailable (loader returns
 * null) — see lib/admin/sample-data.ts for the full contract. Sample
 * rows are never persisted, never mutated, and never mixed into real
 * totals; every surface rendering them shows <SampleBadge />.
 *
 * SHIRTS ONLY (owner design intent): the sample catalogue reads as
 * shirts throughout — sample products are shirts, sample categories
 * are shirt categories. Other-category emptiness is never presented
 * as a defect. All names are prefixed "Sample" and all ids are fixed
 * deterministic UUIDs that exist nowhere in the database.
 *
 * `import type` ONLY for loader return types (the loaders live in
 * 'use server' modules). The one value import is publicationVisibility,
 * a pure client-safe helper, so sample visibility labels can never
 * drift from the live rule.
 */

import { publicationVisibility } from "./catalog-variants";
import type { CatalogListItem } from "./catalog-products";
import type { CategoryWithUrls } from "./catalog-categories";
import type { InventoryOverview, InventoryRow } from "./catalog-inventory";

const SAMPLE_CREATED = "2026-11-10T09:00:00.000Z";
const SAMPLE_UPDATED = "2026-11-14T09:00:00.000Z";
const SAMPLE_PUBLISHED = "2026-11-14T10:00:00.000Z";

export const SAMPLE_PRODUCT_IDS = {
  oxford: "11111111-1111-4111-8111-111111111111",
  linen: "22222222-2222-4222-8222-222222222222",
  flannel: "33333333-3333-4333-8333-333333333333",
  poplin: "44444444-4444-4444-8444-444444444444",
  denim: "55555555-5555-4555-8555-555555555555",
  cotton: "66666666-6666-4666-8666-666666666666",
} as const;

export const SAMPLE_CATEGORY_IDS = {
  shirts: "10111111-1111-4111-8111-111111111111",
  formal: "20222222-2222-4222-8222-222222222222",
  oxford: "30333333-3333-4333-8333-333333333333",
  linen: "40444444-4444-4444-8444-444444444444",
  slimFit: "50555555-5555-4555-8555-555555555555",
} as const;

function sampleProduct(
  item: Omit<CatalogListItem, "storefrontVisibility">,
): CatalogListItem {
  return {
    ...item,
    storefrontVisibility: publicationVisibility(item.status, item.isPublished),
  };
}

export const sampleCatalogProducts: CatalogListItem[] = [
  sampleProduct({
    id: SAMPLE_PRODUCT_IDS.oxford,
    name: "Sample Oxford Shirt",
    slug: "sample-oxford-shirt",
    status: "published",
    displayStatus: "active",
    isPublished: true,
    publishedAt: SAMPLE_PUBLISHED,
    categoryName: "Sample Shirts",
    badges: ["Best Seller", "New Arrival"],
    createdAt: SAMPLE_CREATED,
    updatedAt: SAMPLE_UPDATED,
    minPriceMinor: 249900,
    maxPriceMinor: 299900,
    available: 13,
    onHand: 16,
    variantCount: 2,
    stockFilter: "in-stock",
    thumbnailUrl: null,
    thumbnailAlt: "Sample Oxford Shirt",
  }),
  sampleProduct({
    id: SAMPLE_PRODUCT_IDS.linen,
    name: "Sample Linen Shirt",
    slug: "sample-linen-shirt",
    status: "published",
    displayStatus: "active",
    isPublished: false,
    publishedAt: null,
    categoryName: "Sample Shirts",
    badges: ["New Arrival"],
    createdAt: SAMPLE_CREATED,
    updatedAt: SAMPLE_UPDATED,
    minPriceMinor: 199900,
    maxPriceMinor: 199900,
    available: 8,
    onHand: 8,
    variantCount: 2,
    stockFilter: "in-stock",
    thumbnailUrl: null,
    thumbnailAlt: "Sample Linen Shirt",
  }),
  sampleProduct({
    id: SAMPLE_PRODUCT_IDS.flannel,
    name: "Sample Flannel Shirt",
    slug: "sample-flannel-shirt",
    status: "archived",
    displayStatus: "inactive",
    isPublished: true,
    publishedAt: SAMPLE_PUBLISHED,
    categoryName: "Sample Formal Shirts",
    badges: ["Premium Collection"],
    createdAt: SAMPLE_CREATED,
    updatedAt: SAMPLE_UPDATED,
    minPriceMinor: 179900,
    maxPriceMinor: 179900,
    available: 2,
    onHand: 2,
    variantCount: 2,
    stockFilter: "low-stock",
    thumbnailUrl: null,
    thumbnailAlt: "Sample Flannel Shirt",
  }),
  sampleProduct({
    id: SAMPLE_PRODUCT_IDS.poplin,
    name: "Sample Poplin Shirt",
    slug: "sample-poplin-shirt",
    status: "archived",
    displayStatus: "inactive",
    isPublished: false,
    publishedAt: null,
    categoryName: "Sample Formal Shirts",
    badges: [],
    createdAt: SAMPLE_CREATED,
    updatedAt: SAMPLE_UPDATED,
    minPriceMinor: 229900,
    maxPriceMinor: 229900,
    available: 0,
    onHand: 0,
    variantCount: 1,
    stockFilter: "out-of-stock",
    thumbnailUrl: null,
    thumbnailAlt: "Sample Poplin Shirt",
  }),
  sampleProduct({
    id: SAMPLE_PRODUCT_IDS.denim,
    name: "Sample Denim Shirt",
    slug: "sample-denim-shirt",
    status: "published",
    displayStatus: "out-of-stock",
    isPublished: false,
    publishedAt: null,
    categoryName: "Sample Shirts",
    badges: [],
    createdAt: SAMPLE_CREATED,
    updatedAt: SAMPLE_UPDATED,
    minPriceMinor: 279900,
    maxPriceMinor: 279900,
    available: 0,
    onHand: 0,
    variantCount: 3,
    stockFilter: "out-of-stock",
    thumbnailUrl: null,
    thumbnailAlt: "Sample Denim Shirt",
  }),
  sampleProduct({
    id: SAMPLE_PRODUCT_IDS.cotton,
    name: "Sample Cotton Shirt",
    slug: "sample-cotton-shirt",
    status: "published",
    displayStatus: "active",
    isPublished: true,
    publishedAt: SAMPLE_PUBLISHED,
    categoryName: "Sample Shirts",
    badges: ["Free Delivery"],
    createdAt: SAMPLE_CREATED,
    updatedAt: SAMPLE_UPDATED,
    minPriceMinor: 159900,
    maxPriceMinor: 189900,
    available: 25,
    onHand: 25,
    variantCount: 4,
    stockFilter: "in-stock",
    thumbnailUrl: null,
    thumbnailAlt: "Sample Cotton Shirt",
  }),
];

export const sampleCatalogCategories: CategoryWithUrls[] = [
  {
    id: SAMPLE_CATEGORY_IDS.shirts,
    parent_id: null,
    name: "Sample Shirts",
    slug: "sample-shirts",
    published: true,
    description: "Sample primary category for shirts.",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    seo_description: null,
    sort_position: 0,
    updated_at: SAMPLE_UPDATED,
    imageUrl: null,
    bannerUrl: null,
  },
  {
    id: SAMPLE_CATEGORY_IDS.formal,
    parent_id: null,
    name: "Sample Formal Shirts",
    slug: "sample-formal-shirts",
    published: true,
    description: "Sample primary category for formal shirts.",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    seo_description: null,
    sort_position: 1,
    updated_at: SAMPLE_UPDATED,
    imageUrl: null,
    bannerUrl: null,
  },
  {
    id: SAMPLE_CATEGORY_IDS.oxford,
    parent_id: SAMPLE_CATEGORY_IDS.shirts,
    name: "Sample Oxford Shirts",
    slug: "sample-oxford-shirts",
    published: true,
    description: "Sample secondary category under Sample Shirts.",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    seo_description: null,
    sort_position: 0,
    updated_at: SAMPLE_UPDATED,
    imageUrl: null,
    bannerUrl: null,
  },
  {
    id: SAMPLE_CATEGORY_IDS.linen,
    parent_id: SAMPLE_CATEGORY_IDS.shirts,
    name: "Sample Linen Shirts",
    slug: "sample-linen-shirts",
    published: false,
    description: "Sample secondary category, hidden from the storefront.",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    seo_description: null,
    sort_position: 1,
    updated_at: SAMPLE_UPDATED,
    imageUrl: null,
    bannerUrl: null,
  },
  {
    id: SAMPLE_CATEGORY_IDS.slimFit,
    parent_id: SAMPLE_CATEGORY_IDS.oxford,
    name: "Sample Slim-Fit Oxford",
    slug: "sample-slim-fit-oxford",
    published: true,
    description: "Sample sub-category (third level, legacy depth).",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    seo_description: null,
    sort_position: 0,
    updated_at: SAMPLE_UPDATED,
    imageUrl: null,
    bannerUrl: null,
  },
];

export const sampleInventoryRows: InventoryRow[] = [
  {
    variantId: "77777777-7777-4777-8777-777777777777",
    productId: SAMPLE_PRODUCT_IDS.oxford,
    productName: "Sample Oxford Shirt",
    productSlug: "sample-oxford-shirt",
    productStatus: "published",
    size: "M",
    color: "White",
    active: true,
    onHand: 12,
    reserved: 2,
    available: 10,
    lowStockThreshold: 3,
    stockState: "in-stock",
  },
  {
    variantId: "88888888-8888-4888-8888-888888888888",
    productId: SAMPLE_PRODUCT_IDS.oxford,
    productName: "Sample Oxford Shirt",
    productSlug: "sample-oxford-shirt",
    productStatus: "published",
    size: "L",
    color: "White",
    active: true,
    onHand: 4,
    reserved: 1,
    available: 3,
    lowStockThreshold: 3,
    stockState: "low-stock",
  },
  {
    variantId: "99999999-9999-4999-8999-999999999999",
    productId: SAMPLE_PRODUCT_IDS.linen,
    productName: "Sample Linen Shirt",
    productSlug: "sample-linen-shirt",
    productStatus: "published",
    size: "M",
    color: "Blue",
    active: true,
    onHand: 0,
    reserved: 0,
    available: 0,
    lowStockThreshold: 2,
    stockState: "out-of-stock",
  },
  {
    variantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    productId: SAMPLE_PRODUCT_IDS.linen,
    productName: "Sample Linen Shirt",
    productSlug: "sample-linen-shirt",
    productStatus: "published",
    size: "L",
    color: "Blue",
    active: true,
    onHand: 8,
    reserved: 0,
    available: 8,
    lowStockThreshold: 2,
    stockState: "in-stock",
  },
  {
    variantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    productId: SAMPLE_PRODUCT_IDS.flannel,
    productName: "Sample Flannel Shirt",
    productSlug: "sample-flannel-shirt",
    productStatus: "archived",
    size: "M",
    color: "Green",
    active: true,
    onHand: null,
    reserved: null,
    available: null,
    lowStockThreshold: null,
    stockState: "no-record",
  },
  {
    variantId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    productId: SAMPLE_PRODUCT_IDS.flannel,
    productName: "Sample Flannel Shirt",
    productSlug: "sample-flannel-shirt",
    productStatus: "archived",
    size: "L",
    color: "Green",
    active: true,
    onHand: 2,
    reserved: 0,
    available: 2,
    lowStockThreshold: 5,
    stockState: "low-stock",
  },
];

/** Overview derived from the sample rows, so the numbers reconcile. */
export const sampleInventoryOverview: InventoryOverview = (() => {
  const productIds = new Set(sampleInventoryRows.map((r) => r.productId));
  let totalAvailable = 0;
  let totalOnHand = 0;
  let totalReserved = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  for (const row of sampleInventoryRows) {
    totalAvailable += row.available ?? 0;
    totalOnHand += row.onHand ?? 0;
    totalReserved += row.reserved ?? 0;
    if (row.stockState === "low-stock") lowStockCount += 1;
    if (row.stockState === "out-of-stock") outOfStockCount += 1;
  }
  return {
    productCount: productIds.size,
    variantCount: sampleInventoryRows.length,
    totalAvailable,
    totalOnHand,
    totalReserved,
    lowStockCount,
    outOfStockCount,
    truncated: false,
  };
})();
