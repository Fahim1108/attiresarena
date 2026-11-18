import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { projectPublishedAdminProduct } from "../src/lib/catalog-publication";
import { queryProducts, parseProductQuery } from "../src/lib/catalog-query";
import {
  availableApparelSizes,
  canonicalSize,
} from "../src/lib/catalogue-dimensions";
import { findVariant, isSizeAvailable, toCartLine } from "../src/lib/product";
import { reconcileCartLines } from "../src/lib/cart-catalogue";
import {
  MAIN_SIZES_DEFAULT_COLOR,
  mergeMainSizes,
  validateVariantList,
  variantInputSchema,
  type VariantInput,
} from "../src/lib/admin/catalog-variants";
import { ShopBySize } from "../src/components/home/ShopBySize";
import { MainSizesEditor } from "../src/components/admin/catalog/main-sizes-editor";
import { ProductPurchasePanel } from "../src/components/product/ProductPurchasePanel";
import { SizeSelector } from "../src/components/product/VariantSelector";
import { CartProvider } from "../src/context/CartContext";
import { WishlistProvider } from "../src/context/WishlistContext";
import { ToastProvider } from "../src/context/ToastContext";
import { checkoutOrdersEnabled } from "../src/lib/checkout/config";
import { ownerCatalogue } from "../src/services/adapters/owner-catalogue";
import { updateCatalogProduct } from "../src/lib/admin/catalog-products";
import projects from "../src/config/supabase-projects.json";
import type { Product } from "../src/types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Staff-session harness for the S3 server-action tests only, in the
 *  categories-fix style: an owner session whose RPC handler each test
 *  sets. No other test in this file touches the admin client. */
const staffMocks = vi.hoisted(() => ({
  rpcHandler: null as
    | null
    | ((fn: string, args: unknown) => {
        data: unknown;
        error: { message: string; code?: string } | null;
      }),
}));

vi.mock("@/lib/admin/supabase", () => ({
  adminClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "owner-1", is_anonymous: false } },
        error: null,
      }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: "aal2" },
          error: null,
        }),
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          Promise.resolve(
            table === "user_roles"
              ? {
                  data: [{ user_id: "owner-1", role: "owner" }],
                  error: null,
                }
              : { data: [], error: null },
          ),
      }),
    }),
    rpc: async (fn: string, args: unknown) => {
      const handler = staffMocks.rpcHandler;
      if (!handler) throw new Error("No RPC handler set for this test");
      return handler(fn, args);
    },
  }),
  adminConfiguration: () => null,
}));

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";
const MEDIA_PATH =
  "55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666.jpg";

function variant(
  id: string,
  size: string,
  color: string,
  available: number,
  priceMinor = 250000,
) {
  return {
    id,
    size,
    color,
    price_minor: priceMinor,
    sale_price_minor: null,
    available,
  };
}

function feedRow(
  variants: ReturnType<typeof variant>[],
  overrides: Record<string, unknown> = {},
) {
  return {
    id: PRODUCT_ID,
    slug: "main-sizes-shirt",
    name: "Main Sizes Shirt",
    description: "A shirt whose sizes live at the main place.",
    category_id: CATEGORY_ID,
    highlights: [],
    tags: [],
    badges: [],
    created_at: "2026-11-15T00:00:00.000Z",
    published_at: "2026-11-15T01:00:00.000Z",
    variants,
    media: [{ path: MEDIA_PATH, alt: "Front view" }],
    ...overrides,
  };
}

/** A published product whose first feed variant is "One Size" but which
 *  also carries real apparel sizes — the shape a product gets when its
 *  default variant sorts before its main-level sizes (feed order is
 *  ORDER BY color, size). */
function oneSizeFirstProduct(): Product {
  const product = projectPublishedAdminProduct(
    feedRow([
      variant("22222222-2222-4222-8222-222222222222", "One Size", "A-Color", 1),
      variant("33333333-3333-4333-8333-333333333333", "M", "Standard", 1),
      variant("66666666-6666-4666-8666-666666666666", "L", "Standard", 0),
    ]),
  );
  if (!product) throw new Error("fixture row should project");
  return product;
}

describe("projector apparelSizing (sizes build)", () => {
  it("is true when a later variant carries an apparel size, even when the first size is One Size", () => {
    const product = oneSizeFirstProduct();
    expect(product.sizes).toEqual(["One Size", "M", "L"]);
    expect(product.apparelSizing).toBe(true);
    expect(product.sizeGuideId).toBe("tops");
  });

  it("is false when no variant size is an apparel size", () => {
    const product = projectPublishedAdminProduct(
      feedRow([
        variant("22222222-2222-4222-8222-222222222222", "One Size", "Black", 2),
        variant("33333333-3333-4333-8333-333333333333", "40", "Black", 1),
      ]),
    );
    expect(product?.apparelSizing).toBe(false);
    expect(product?.sizeGuideId).toBe(undefined);
  });

  it("treats canonical aliases as apparel sizes wherever they appear", () => {
    const product = projectPublishedAdminProduct(
      feedRow([
        variant("22222222-2222-4222-8222-222222222222", "One Size", "Black", 1),
        variant("33333333-3333-4333-8333-333333333333", "XXL", "Black", 1),
      ]),
    );
    expect(canonicalSize("XXL")).toBe("2XL");
    expect(product?.apparelSizing).toBe(true);
    expect(availableApparelSizes(product!)).toEqual(["2XL"]);
  });

  it("keeps a single One Size product non-apparel", () => {
    const product = projectPublishedAdminProduct(
      feedRow([
        variant("22222222-2222-4222-8222-222222222222", "One Size", "Black", 1),
      ]),
    );
    expect(product?.apparelSizing).toBe(false);
  });
});

describe("shop-by-size end-to-end path (feed row to /shop filter)", () => {
  it("finds a published product with main size M at /shop?sizes=M&available=1 and not at sizes=XL", () => {
    const product = oneSizeFirstProduct();
    const mQuery = parseProductQuery({ sizes: "M", available: "1" });
    const xlQuery = parseProductQuery({ sizes: "XL", available: "1" });
    expect(queryProducts([product], [], [], mQuery).total).toBe(1);
    expect(queryProducts([product], [], [], mQuery).items[0]?.id).toBe(
      product.id,
    );
    expect(queryProducts([product], [], [], xlQuery).total).toBe(0);
  });

  it("matches canonical equivalents (XXL in the URL matches a 2XL variant)", () => {
    const product = projectPublishedAdminProduct(
      feedRow([
        variant("22222222-2222-4222-8222-222222222222", "2XL", "Standard", 1),
      ]),
    )!;
    expect(
      queryProducts([product], [], [], parseProductQuery({ sizes: "XXL" }))
        .total,
    ).toBe(1);
    expect(
      queryProducts([product], [], [], parseProductQuery({ sizes: "2XL" }))
        .total,
    ).toBe(1);
    expect(
      queryProducts([product], [], [], parseProductQuery({ sizes: "3XL" }))
        .total,
    ).toBe(0);
  });

  it("does not match a size whose only variant is out of stock", () => {
    const product = oneSizeFirstProduct();
    // L exists but has 0 stock; M is in stock.
    expect(
      queryProducts([product], [], [], parseProductQuery({ sizes: "L" })).total,
    ).toBe(0);
    expect(
      queryProducts([product], [], [], parseProductQuery({ sizes: "M" })).total,
    ).toBe(1);
  });

  it("keeps size facets verified-only: review fixtures never contribute sizes", () => {
    const verified = oneSizeFirstProduct();
    const reviewOnly: Product = {
      ...verified,
      id: "77777777-7777-4777-8777-777777777777",
      slug: "review-shirt",
      reviewOnly: true,
      sizes: ["XL"],
      variants: verified.variants.map((v) => ({ ...v, size: "XL", stock: 5 })),
    };
    // The adapter recomputes size facets over verified products only;
    // mirror that call shape here: facets over the verified set exclude
    // the review-only XL, while the unfiltered facet set would include it.
    const verifiedFacets = queryProducts(
      [verified],
      [],
      [],
      parseProductQuery({}),
    ).facets.sizes;
    expect(verifiedFacets).toContain("M");
    expect(verifiedFacets).not.toContain("XL");
    const mixedFacets = queryProducts(
      [verified, reviewOnly],
      [],
      [],
      parseProductQuery({}),
    ).facets.sizes;
    expect(mixedFacets).toContain("XL");
    // And a size-filtered query over the verified set (the adapter's
    // requiresVerified path) never returns the review fixture.
    expect(
      queryProducts([verified], [], [], parseProductQuery({ sizes: "XL" }))
        .total,
    ).toBe(0);
  });

  it("routes size queries through the adapter's verified-only path: review fixtures never appear in results or size facets", async () => {
    // The verified product carries L (and a leading One Size) but no
    // M; every review fixture carries M. A size-M query through the
    // real adapter must therefore return nothing at all — if the
    // adapter passed the unfiltered pool to queryProducts, the 18
    // in-stock review shirts would match. The feed reads are mocked
    // with the production-catalogue fetch pattern; the adapter,
    // projectors, and queryProducts under test are all real.
    const row = feedRow([
      variant("22222222-2222-4222-8222-222222222222", "One Size", "A-Color", 1),
      variant("33333333-3333-4333-8333-333333333333", "L", "Standard", 1),
    ]);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("CLAUDE_DESIGN_PREVIEW", "1");
    vi.stubEnv("SUPABASE_URL", `https://${projects.staging}.supabase.co`);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_unit_fixture");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("/rpc/published_admin_catalogue") ? [row] : [],
          ),
          { status: 200 },
        ),
      ),
    );
    try {
      const all = await ownerCatalogue.getProducts({ pageSize: 100 });
      expect(all.items).toHaveLength(19);
      expect(all.items.filter((p) => p.reviewOnly)).toHaveLength(18);
      const m = await ownerCatalogue.getProducts({ sizes: ["M"] });
      expect(m.total).toBe(0);
      expect(m.items).toEqual([]);
      expect(m.facets.sizes).not.toContain("M");
      const l = await ownerCatalogue.getProducts({ sizes: ["L"] });
      expect(l.items.map((p) => p.id)).toEqual([PRODUCT_ID]);
      expect(l.items.every((p) => !p.reviewOnly)).toBe(true);
      expect(l.facets.sizes).toContain("L");
      expect(l.facets.sizes).not.toContain("M");
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("lights up only in-stock apparel sizes in Shop-by-Size, as links to /shop", () => {
    const html = renderToStaticMarkup(
      createElement(ShopBySize, { products: [oneSizeFirstProduct()] }),
    );
    expect(html).toContain('href="/shop?sizes=M&amp;available=1"');
    expect(html).toContain(">M</a>");
    // L is out of stock and XL does not exist: disabled spans, not links.
    expect(html).not.toContain("sizes=L");
    expect(html).not.toContain("sizes=XL");
    expect(html).toContain("L, no confirmed sizes in stock");
  });

  it("keeps Shop-by-Size dark for review-only and out-of-stock products", () => {
    const verified = oneSizeFirstProduct();
    const reviewOnly: Product = { ...verified, reviewOnly: true };
    const soldOut: Product = {
      ...verified,
      id: "77777777-7777-4777-8777-777777777777",
      slug: "sold-out-shirt",
      variants: verified.variants.map((v) => ({ ...v, stock: 0 })),
    };
    for (const products of [[reviewOnly], [soldOut]]) {
      const html = renderToStaticMarkup(
        createElement(ShopBySize, { products }),
      );
      expect(html).not.toContain("/shop?sizes=");
      expect(html).toContain("no confirmed sizes in stock");
    }
  });
});

/** A verified published product whose sizes were entered at the main
 *  place: one main color, one materialized variant per size, each with
 *  its own stock counter. */
function mainSizesProduct(overrides: Partial<Product> = {}): Product {
  const variants = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      sku: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      colorId: "standard",
      size: "S",
      price: 2500,
      stock: 2,
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      sku: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      colorId: "standard",
      size: "M",
      price: 2500,
      stock: 1,
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      sku: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      colorId: "standard",
      size: "L",
      price: 2500,
      stock: 0,
    },
  ];
  return {
    id: PRODUCT_ID,
    slug: "main-sizes-shirt",
    name: "Main Sizes Shirt",
    shortDescription: "A shirt with main-level sizes.",
    description: "A shirt with main-level sizes.",
    categoryId: CATEGORY_ID,
    brandId: "",
    price: 2500,
    colors: [{ id: "standard", name: "Standard", hex: "#6B0202" }],
    sizes: ["S", "M", "L"],
    variants,
    imagesByColor: {},
    defaultImages: [{ src: "/x.jpg", alt: "Main Sizes Shirt" }],
    details: [],
    badges: [],
    isNewArrival: false,
    isFeatured: false,
    isBestSeller: false,
    rating: { average: 0, count: 0 },
    createdAt: "2026-11-15T00:00:00.000Z",
    tags: [],
    apparelSizing: true,
    ...overrides,
  };
}

/* eslint-disable react/no-children-prop -- React 19 types require children in the props object for createElement with these providers, and .check.ts files cannot use JSX. */
function renderPanel(product: Product): string {
  return renderToStaticMarkup(
    createElement(ToastProvider, {
      children: createElement(WishlistProvider, {
        approvedProductIds: [product.id],
        children: createElement(CartProvider, {
          approvedProducts: [product],
          approvedVariantIds: product.variants
            .filter((v) => v.stock > 0)
            .map((v) => v.id),
          initialItems: [],
          children: createElement(ProductPurchasePanel, {
            product,
            colorId: "standard",
            onColorChange: () => {},
          }),
        }),
      }),
    }),
  );
}

/* eslint-enable react/no-children-prop */

/** The rendered <button> tag carrying the given aria-label, or null. */
function buttonTag(html: string, ariaLabel: string): string | null {
  const match = html.match(
    new RegExp(`<button[^>]*aria-label="${ariaLabel}"[^>]*>`),
  );
  return match ? match[0] : null;
}

describe("size selector unlock (sizes build)", () => {
  it("unlocks in-stock sizes on a verified product and keeps out-of-stock sizes disabled", () => {
    const html = renderPanel(mainSizesProduct());
    const s = buttonTag(html, "Size S");
    const m = buttonTag(html, "Size M");
    expect(s).not.toBe(null);
    expect(m).not.toBe(null);
    expect(s).not.toContain("disabled");
    expect(m).not.toContain("disabled");
    // L is out of stock: disabled, announced as sold out (not locked).
    const l = buttonTag(html, "Size L, sold out");
    expect(l).not.toBe(null);
    expect(l).toContain("disabled");
  });

  it("stays locked for review-only products: every size disabled", () => {
    const html = renderPanel(mainSizesProduct({ reviewOnly: true }));
    // Locked buttons stay disabled even when the size is in stock; the
    // "not available for this item" label only replaces the sold-out
    // label on sizes that are unavailable.
    for (const label of ["Size S", "Size M"]) {
      const tag = buttonTag(html, label);
      expect(tag).not.toBe(null);
      expect(tag).toContain("disabled");
    }
    const l = buttonTag(html, "Size L, not available for this item");
    expect(l).not.toBe(null);
    expect(l).toContain("disabled");
  });

  it("keeps the locked SizeSelector rendering sold-out sizes without the locked styling once unlocked", () => {
    const unlocked = renderToStaticMarkup(
      createElement(SizeSelector, {
        sizes: ["S", "M"],
        locked: false,
        value: undefined,
        onChange: () => {},
        isAvailable: (s: string) => s === "S",
      }),
    );
    expect(buttonTag(unlocked, "Size S")).not.toContain("disabled");
    expect(buttonTag(unlocked, "Size M, sold out")).toContain("disabled");
    const locked = renderToStaticMarkup(
      createElement(SizeSelector, {
        sizes: ["S", "M"],
        locked: true,
        value: undefined,
        onChange: () => {},
        isAvailable: () => true,
      }),
    );
    // Locked + in-stock keeps the plain label but stays disabled.
    expect(buttonTag(locked, "Size S")).toContain("disabled");
    expect(buttonTag(locked, "Size M")).toContain("disabled");
  });

  it("resolves a selected size to its materialized variant id before the cart", () => {
    const product = mainSizesProduct();
    expect(isSizeAvailable(product, "standard", "M")).toBe(true);
    expect(isSizeAvailable(product, "standard", "L")).toBe(false);
    const variant = findVariant(product, "standard", "M");
    expect(variant?.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2");
    // Stored cart identity stays productId:variantId; the size is a
    // display snapshot copied from the resolved variant.
    const line = toCartLine(product, variant!);
    expect(line.id).toBe(
      `${PRODUCT_ID}:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2`,
    );
    expect(line.variantId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2");
    expect(line.size).toBe("M");
    // And the reconciler keeps exactly that line (variant-keyed, as before).
    const reconciled = reconcileCartLines(
      [{ variantId: variant!.id, quantity: 1 }],
      [product],
    );
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      id: line.id,
      variantId: variant!.id,
      size: "M",
      quantity: 1,
    });
    // A size-only stored line (no variant id) still cannot enter the cart.
    expect(
      reconcileCartLines([{ size: "M", quantity: 1 }], [product]),
    ).toHaveLength(0);
  });
});

function explicitVariant(overrides: Partial<VariantInput> = {}): VariantInput {
  return {
    size: "M",
    color: "Standard",
    price_minor: 250000,
    sale_price_minor: null,
    cost_price_minor: null,
    stock: 1,
    active: true,
    ...overrides,
  };
}

const EXISTING_ID = "88888888-8888-4888-8888-888888888888";

function merge(
  overrides: Partial<Parameters<typeof mergeMainSizes>[0]> = {},
) {
  return mergeMainSizes({
    explicitVariants: [],
    rows: [{ size: "M", stock: 1 }],
    mainColor: "Standard",
    basePriceMinor: 250000,
    baseSalePriceMinor: null,
    baseCostPriceMinor: null,
    ...overrides,
  });
}

describe("main-level size expansion and merge (sizes build)", () => {
  it("expands sizes into ordinary variant rows priced from the base fields, with no id", () => {
    const result = merge({
      rows: [
        { size: "S", stock: 1 },
        { size: "M", stock: 3 },
      ],
      baseSalePriceMinor: 200000,
      baseCostPriceMinor: 100000,
    });
    expect(result.fieldError).toBe(null);
    expect(result.variants).toHaveLength(2);
    expect(result.variants[0]).toEqual({
      size: "S",
      color: "Standard",
      price_minor: 250000,
      sale_price_minor: 200000,
      cost_price_minor: 100000,
      stock: 1,
      active: true,
    });
    expect(result.variants[1]).toMatchObject({ size: "M", stock: 3 });
    // Generated rows carry NO id on create or on update: the update RPC
    // treats id-less rows as inserts with initial stock honoured.
    expect(result.variants[0]).not.toHaveProperty("id");
    expect(result.variants[1]).not.toHaveProperty("id");
    // Every generated row satisfies the variant schema itself.
    for (const v of result.variants) {
      expect(variantInputSchema.safeParse(v).success).toBe(true);
    }
    expect(validateVariantList(result.variants)).toBe(null);
  });

  it("keeps each size on its own stock counter", () => {
    const result = merge({
      rows: [
        { size: "S", stock: 0 },
        { size: "M", stock: 5 },
      ],
    });
    expect(result.fieldError).toBe(null);
    expect(result.variants.map((v) => [v.size, v.stock])).toEqual([
      ["S", 0],
      ["M", 5],
    ]);
  });

  it("merges explicit rows first and appends generated rows", () => {
    const result = merge({
      explicitVariants: [explicitVariant({ size: "XL", color: "Maroon" })],
      rows: [{ size: "M", stock: 1 }],
    });
    expect(result.fieldError).toBe(null);
    expect(result.variants.map((v) => v.size)).toEqual(["XL", "M"]);
  });

  it("lets an explicit new row win on (size, color) collision, dropping the generated row", () => {
    const result = merge({
      explicitVariants: [
        explicitVariant({ size: "M", color: "Standard", price_minor: 99900 }),
      ],
      rows: [{ size: "M", stock: 1 }],
    });
    expect(result.fieldError).toBe(null);
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]?.price_minor).toBe(99900);
  });

  it("keeps a generated row when only the size matches but the color differs", () => {
    const result = merge({
      explicitVariants: [explicitVariant({ size: "M", color: "Maroon" })],
      rows: [{ size: "M", stock: 1 }],
      mainColor: "Standard",
    });
    expect(result.fieldError).toBe(null);
    expect(result.variants).toHaveLength(2);
  });

  it("reports an edit-mode collision with an existing variant as a field error naming the size", () => {
    const result = merge({
      explicitVariants: [
        explicitVariant({ id: EXISTING_ID, size: "M", color: "Standard" }),
      ],
      rows: [{ size: "M", stock: 1 }],
    });
    expect(result.fieldError).toEqual({
      field: "main_sizes",
      message: "Size M already exists — edit it in Variants.",
    });
  });

  it("rejects duplicate main-size rows", () => {
    const result = merge({
      rows: [
        { size: "M", stock: 1 },
        { size: "M", stock: 2 },
      ],
    });
    expect(result.fieldError?.field).toBe("main_sizes");
    expect(result.fieldError?.message).toContain('size "M"');
  });

  it("enforces variant size validation parity, with errors naming the sizes field", () => {
    for (const size of ["", "N/A", "NA", "UNKNOWN", "n/a", "x".repeat(41)]) {
      const result = merge({ rows: [{ size, stock: 1 }] });
      expect(result.fieldError?.field).toBe("main_sizes");
      expect(result.fieldError?.message).toMatch(/^Sizes: /);
    }
    expect(merge({ rows: [{ size: "M", stock: 1 }] }).fieldError).toBe(null);
    expect(
      merge({ rows: [{ size: "  M  ", stock: 1 }] }).variants[0]?.size,
    ).toBe("M");
  });

  it("rejects non-integer, negative and oversized stock", () => {
    for (const stock of [-1, 1.5, 1_000_000_000, Number.NaN]) {
      const result = merge({ rows: [{ size: "M", stock }] });
      expect(result.fieldError?.field).toBe("main_sizes");
      expect(result.fieldError?.message).toContain("stock");
    }
    expect(merge({ rows: [{ size: "M", stock: 0 }] }).fieldError).toBe(null);
  });

  it("rejects malformed rows and non-array payloads", () => {
    expect(merge({ rows: "M" }).fieldError?.field).toBe("main_sizes");
    expect(merge({ rows: null }).fieldError?.field).toBe("main_sizes");
    expect(merge({ rows: [null] }).fieldError?.field).toBe("main_sizes");
    expect(merge({ rows: [{ size: "M" }] }).fieldError?.field).toBe(
      "main_sizes",
    );
    expect(merge({ rows: [{ stock: 1 }] }).fieldError?.field).toBe(
      "main_sizes",
    );
  });

  it("requires the main color iff sizes exist, trims it, and caps it at 80 chars", () => {
    expect(MAIN_SIZES_DEFAULT_COLOR).toBe("Standard");
    const missing = merge({ rows: [{ size: "M", stock: 1 }], mainColor: "  " });
    expect(missing.fieldError).toEqual({
      field: "main_color",
      message: "Enter a main color for the sizes.",
    });
    const tooLong = merge({
      rows: [{ size: "M", stock: 1 }],
      mainColor: "x".repeat(81),
    });
    expect(tooLong.fieldError?.field).toBe("main_color");
    // No sizes: the color is ignored entirely, even when blank.
    expect(merge({ rows: [], mainColor: "" }).fieldError).toBe(null);
    expect(merge({ rows: [], mainColor: "" }).variants).toEqual([]);
    const trimmed = merge({
      rows: [{ size: "M", stock: 1 }],
      mainColor: "  Maroon  ",
    });
    expect(trimmed.variants[0]?.color).toBe("Maroon");
  });

  it("requires a base price above zero when sizes exist", () => {
    const result = merge({ basePriceMinor: 0 });
    expect(result.fieldError?.field).toBe("main_sizes");
    expect(result.fieldError?.message).toContain("above ৳0.00");
    // No sizes and a zero price is the form's own no-variant check, not
    // the merge's: the merge passes the explicit rows through.
    expect(merge({ rows: [], basePriceMinor: 0 }).fieldError).toBe(null);
  });

  it("enforces the 100-row total cap across explicit and generated rows", () => {
    const many = Array.from({ length: 99 }, (_, i) =>
      explicitVariant({ size: `Size-${i}`, color: "Standard" }),
    );
    expect(
      merge({
        explicitVariants: many,
        rows: [
          { size: "M", stock: 1 },
          { size: "L", stock: 1 },
        ],
      }).fieldError,
    ).toEqual({
      field: "main_sizes",
      message: "A product may have at most 100 variants, including main sizes.",
    });
    expect(
      merge({
        explicitVariants: many,
        rows: [{ size: "M", stock: 1 }],
      }).fieldError,
    ).toBe(null);
  });

  it("leaves explicit variants untouched when no size rows exist", () => {
    const explicit = [explicitVariant({ size: "XL" })];
    const result = merge({ explicitVariants: explicit, rows: [] });
    expect(result.fieldError).toBe(null);
    expect(result.variants).toEqual(explicit);
  });
});

describe("main sizes editor rendering (sizes build)", () => {
  it("starts empty with the default main color and no pre-filled sizes", () => {
    const html = renderToStaticMarkup(createElement(MainSizesEditor, {}));
    expect(html).toContain('name="main_color"');
    expect(html).toContain('value="Standard"');
    expect(html).toContain('name="main_sizes_json"');
    expect(html).toContain("No sizes yet");
    expect(html).toContain("Add size");
    expect(html).toContain("Each size carries its own stock");
    // No SKU field, no Draft option, no Missing Information section.
    expect(html).not.toContain("SKU");
    expect(html).not.toContain("Draft");
    expect(html).not.toContain("Missing Information");
  });

  it("surfaces field errors next to the sizes and the main color", () => {
    const html = renderToStaticMarkup(
      createElement(MainSizesEditor, {
        fieldError: "Size M already exists — edit it in Variants.",
        colorError: "Enter a main color for the sizes.",
      }),
    );
    expect(html).toContain("Size M already exists — edit it in Variants.");
    expect(html).toContain("Enter a main color for the sizes.");
    expect(html).toContain('aria-invalid="true"');
    // Both errors share the notice/alert treatment (S5); the color
    // error carries no inline hex.
    expect(html.match(/role="alert"/g)).toHaveLength(2);
    expect(html).not.toContain("#7a1010");
  });
});

describe("skipped-variant collision localization (sizes build)", () => {
  function editForm(fields: Record<string, string>): FormData {
    const form = new FormData();
    form.set("id", PRODUCT_ID);
    form.set("updated_at", "2026-11-15T10:00:00+00:00");
    form.set("name", "Test Shirt");
    form.set("slug", "test-shirt");
    form.set("description", "A test shirt.");
    form.set("status", "published");
    form.set("category_id", CATEGORY_ID);
    form.set("secondary_category_id", "");
    form.set("base_price", "999");
    form.set("base_stock", "1");
    form.set("main_color", "Standard");
    form.set("main_sizes_json", "[]");
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  }

  it("maps an RPC duplicate rejection to the main_sizes field when main sizes were submitted", async () => {
    staffMocks.rpcHandler = () => ({
      data: null,
      error: { message: "Duplicate size and color combination", code: "22023" },
    });
    const state = await updateCatalogProduct(
      { ok: false },
      editForm({
        main_sizes_json: JSON.stringify([{ size: "M", stock: 1 }]),
      }),
    );
    expect(state.ok).toBe(false);
    expect(state.error).toContain("Duplicate size and color combination");
    expect(state.fieldErrors?.main_sizes).toBe(
      "A size you added already exists — edit it in Variants.",
    );
  });

  it("keeps the duplicate rejection form-level only when no main sizes were submitted", async () => {
    staffMocks.rpcHandler = () => ({
      data: null,
      error: { message: "Duplicate size and color combination", code: "22023" },
    });
    const state = await updateCatalogProduct({ ok: false }, editForm({}));
    expect(state.ok).toBe(false);
    expect(state.error).toContain("Duplicate size and color combination");
    expect(state.fieldErrors?.main_sizes).toBeUndefined();
  });

  it("does not localize unrelated RPC errors to the main_sizes field", async () => {
    staffMocks.rpcHandler = () => ({
      data: null,
      error: { message: "Something else failed", code: "XX000" },
    });
    const state = await updateCatalogProduct(
      { ok: false },
      editForm({
        main_sizes_json: JSON.stringify([{ size: "M", stock: 1 }]),
      }),
    );
    expect(state.ok).toBe(false);
    expect(state.fieldErrors?.main_sizes).toBeUndefined();
  });
});

describe("ordering banner condition (sizes build)", () => {
  // The root layout renders the "Ordering is not yet available" banner
  // only when checkoutOrdersEnabled() is false. These tests pin the
  // condition itself: production can never enable ordering (the banner
  // stays), and staging enables it only with every gate satisfied.
  const SERVICE_KEY = "service-role-fixture-key-long-enough";
  beforeEach(() => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_unit_fixture");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stagingEnv() {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("STAGING_CHECKOUT_ORDERS", "1");
    vi.stubEnv("SUPABASE_URL", `https://${projects.staging}.supabase.co`);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  }

  it("renders no ordering banner in the layout: the notice was removed", () => {
    const layout = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "src",
        "app",
        "layout.tsx",
      ),
      "utf8",
    );
    // The ordering-off notice was removed from the layout entirely (banner +
    // strikethrough polish). Checkout stays blocked by the checkout-page gate
    // (CheckoutForm orderingEnabled), not by this banner. Nothing in the
    // layout may render the notice text or its aside element.
    expect(layout).not.toContain("Ordering is not yet available.");
    expect(layout).not.toContain("design-preview-notice");
    expect(layout).not.toContain("<aside");
    expect(layout).not.toContain("checkoutOrdersEnabled");
  });

  it("enables ordering only when every staging gate holds", () => {
    stagingEnv();
    expect(checkoutOrdersEnabled()).toBe(true);
  });

  it("keeps ordering disabled without the explicit staging flag", () => {
    stagingEnv();
    vi.stubEnv("STAGING_CHECKOUT_ORDERS", "");
    expect(checkoutOrdersEnabled()).toBe(false);
  });

  it("keeps ordering disabled on the wrong Supabase project", () => {
    stagingEnv();
    vi.stubEnv(
      "SUPABASE_URL",
      `https://${projects.production}.supabase.co`,
    );
    expect(checkoutOrdersEnabled()).toBe(false);
  });

  it("keeps ordering disabled without a usable service key", () => {
    stagingEnv();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "short");
    expect(checkoutOrdersEnabled()).toBe(false);
    vi.stubEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      "sb_publishable_unit_fixture",
    );
    expect(checkoutOrdersEnabled()).toBe(false);
  });

  it("never enables ordering on a production storefront, even with every flag set", () => {
    stagingEnv();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(checkoutOrdersEnabled()).toBe(false);
  });
});

describe("orderable_variant migration (authored-only SQL pins)", () => {
  const migrationPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "supabase",
    "migrations",
    "20261116000600_orderable_variant_non_thrift.sql",
  );
  const sql = readFileSync(migrationPath, "utf8");
  // Comment-stripped body: header comments may NAME forbidden things
  // ("no orders_enabled flip") without doing them; only the body counts.
  const body = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("replaces only private.orderable_variant with the unchanged signature and attributes", () => {
    expect(
      body.match(/create or replace function/gi),
    ).toHaveLength(1);
    expect(body).toContain(
      "create or replace function private.orderable_variant(target_variant uuid)",
    );
    expect(body).toContain(
      "returns table(product_id uuid, product_name text, sku text, size text, color text,",
    );
    expect(body).toContain(
      "regular_price_minor bigint, unit_price_minor bigint, is_thrift boolean, orderable boolean)",
    );
    expect(body).toContain(
      "language sql stable security definer set search_path = ''",
    );
    expect(body).toContain(
      "revoke all on function private.orderable_variant(uuid) from public, anon, authenticated;",
    );
  });

  it("left-joins intake, inner-joins inventory, and requires availability in both branches", () => {
    expect(body).toContain(
      "left join public.thrift_intake i on i.product_id = p.id",
    );
    expect(body).toContain(
      "join public.inventory s on s.variant_id = v.id",
    );
    expect(body).not.toContain("left join public.inventory");
    expect(body).toContain("s.available > 0");
  });

  it("keeps the thrift branch identical to v2 and computes is_thrift", () => {
    for (const clause of [
      "i.size_verified and i.details_verified",
      "i.actual_size is not null and i.actual_color is not null",
      "v.size = i.actual_size and v.color = i.actual_color",
      "i.price_minor > 0 and i.stock_quantity > 0",
    ]) {
      expect(body).toContain(clause);
    }
    expect(body).toContain("i.product_id is not null,");
    expect(body).not.toContain("i.price_minor, i.price_minor, true,");
  });

  it("prices the non-thrift branch from the variant with price-above-zero checks", () => {
    expect(body).toContain(
      "else coalesce(v.sale_price_minor, v.price_minor) end",
    );
    expect(body).toContain(
      "else p.is_published and v.price_minor > 0 and coalesce(v.sale_price_minor, v.price_minor) > 0 end",
    );
  });

  it("requires p.is_published only in the non-thrift branch, never in the thrift branch", () => {
    // The orderable CASE is the last CASE in the body (after the two
    // price CASEs). Split it at its ELSE: the THEN (thrift) part must
    // not mention is_published — thrift products publish through
    // intake verification, not admin_publish_product — while the
    // ELSE (non-thrift) part must require it for feed parity.
    const cases = body.split("case when i.product_id is not null");
    const orderableCase = cases[cases.length - 1] ?? "";
    const [thriftPart, nonThriftPart] = orderableCase.split("else");
    expect(thriftPart).not.toContain("is_published");
    expect(nonThriftPart).toContain("p.is_published");
    // Exactly one occurrence in the whole body: the shared
    // conjunction must not carry it, or thrift ordering breaks.
    expect(body.match(/p\.is_published/g)).toHaveLength(1);
  });

  it("contains no other change: no flag flip, columns, tables, RLS, permissions, or seeds", () => {
    for (const forbidden of [
      "orders_enabled",
      "create table",
      "alter table",
      "create policy",
      "has_permission",
      "insert into",
      "update public.",
      "set_checkout_items",
      "place_checkout_order",
      "admin_transition_order",
    ]) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("states the authored-only, drift-check, apply-order, and pre-apply terms in its header", () => {
    for (const term of [
      "AUTHORED ONLY",
      "NEVER APPLIED BY THIS BUILD",
      "SCHEMA-DRIFT-CHECK PRECONDITION",
      "APPLY ORDER",
      "PRE-APPLY BEHAVIOR",
      "CK001",
      "p.is_published",
      "ACCEPTED RESIDUAL",
      "PARSE-CHECK REQUIREMENT",
    ]) {
      expect(sql).toContain(term);
    }
  });
});
