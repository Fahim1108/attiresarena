import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Edit-page-fix regressions (diagnosed live 2026-11-16):
 * After creating a product, the edit page /admin/catalog/products/<id>
 * threw the admin error boundary on every load, even though the save
 * had persisted. Root cause: readCatalogProduct embedded categories(name)
 * in its product select, but products has TWO foreign keys to categories
 * (category_id + secondary_category_id since migration 009), so
 * PostgREST rejected the ambiguous embed on BOTH the primary and the
 * fallback select — and the loader threw. The same throw class
 * (whole-value Zod .parse, throwing gallery/category reads) existed in
 * the sibling loaders. These tests pin the non-throwing contracts:
 * failures are reported, malformed rows are skipped, and no loader
 * ever issues an ambiguous relation embed.
 */

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

const mocks = vi.hoisted(() => ({
  handler: null as
    | null
    | ((table: string, columns: string) => QueryResult | Error),
  signingFails: false,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/services/adapters/published-thrift", () => ({
  readPublishedFeed: async () => {
    throw new Error("feed reads are out of scope for edit-page-fix tests");
  },
}));
vi.mock("@/lib/admin/supabase", () => {
  function resolveQuery(table: string, columns: string): QueryResult {
    const handler = mocks.handler;
    if (!handler) throw new Error("No query handler set for this test");
    const result = handler(table, columns);
    if (result instanceof Error) throw result;
    return result;
  }
  function makeBuilder(table: string) {
    let columns = "";
    const builder = {
      select: (selected: string) => {
        columns = selected;
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      eq: () => builder,
      or: () => builder,
      in: () => builder,
      maybeSingle: async () => {
        const result = resolveQuery(table, columns);
        const first = Array.isArray(result.data)
          ? (result.data[0] ?? null)
          : result.data;
        return { data: first, error: result.error };
      },
      single: async () => {
        const result = resolveQuery(table, columns);
        const first = Array.isArray(result.data)
          ? (result.data[0] ?? null)
          : result.data;
        return { data: first, error: result.error };
      },
      then: (
        onFulfilled?: (value: QueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => {
        let promise: Promise<QueryResult>;
        try {
          promise = Promise.resolve(resolveQuery(table, columns));
        } catch (error) {
          promise = Promise.reject(error);
        }
        return promise.then(onFulfilled, onRejected);
      },
    };
    return builder;
  }
  return {
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
      from: (table: string) => makeBuilder(table),
      rpc: async () => ({
        data: null,
        error: { message: "RPC unavailable in edit-page-fix tests" },
      }),
      storage: {
        from: () => ({
          createSignedUrl: async () => {
            if (mocks.signingFails) {
              throw new Error("signing service unavailable");
            }
            return {
              data: { signedUrl: "https://signed.example/thumb" },
              error: null,
            };
          },
          remove: async () => ({ data: null, error: null }),
          upload: async () => ({
            data: { path: "owner-1/staged.jpg" },
            error: null,
          }),
        }),
      },
    }),
    adminConfiguration: () => null,
  };
});

import {
  readCatalogProduct,
  readCategoryOptions,
  readCategoryOptionsWithStatus,
} from "../src/lib/admin/catalog-products";
import {
  readProductMedia,
  reorderCatalogMedia,
  replaceCatalogImage,
} from "../src/lib/admin/catalog-media";
import {
  readInventory,
  readMovementHistory,
  readVariantOptions,
} from "../src/lib/admin/catalog-inventory";

const OWNER_ROLE = [{ user_id: "owner-1", role: "owner" }];
const AT = "2026-11-15T10:00:00+00:00";
const uuid = (tail: string) => `11111111-1111-4111-8111-1111111111${tail}`;

const PRODUCT_ID = uuid("a1");
const CATEGORY_ID = uuid("c3");
const SECONDARY_ID = uuid("c4");
const VARIANT_ID = uuid("d4");
const VARIANT_2_ID = uuid("d5");
const MEDIA_ID = uuid("e6");

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: "Gulistan Shirt",
    slug: "gulistan-shirt",
    description: "A shirt.",
    status: "published",
    category_id: CATEGORY_ID,
    secondary_category_id: SECONDARY_ID,
    is_published: true,
    published_at: AT,
    brand: null,
    highlights: [],
    tags: [],
    badges: [],
    seo_title: null,
    seo_description: null,
    meta_keywords: null,
    youtube_video_id: null,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

/** Pre-migration shape: no publication/hierarchy/video columns. */
function productBaseRow(overrides: Record<string, unknown> = {}) {
  const row = productRow(overrides);
  delete (row as Record<string, unknown>).secondary_category_id;
  delete (row as Record<string, unknown>).is_published;
  delete (row as Record<string, unknown>).published_at;
  delete (row as Record<string, unknown>).youtube_video_id;
  return row;
}

function variantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VARIANT_ID,
    size: "One Size",
    color: "Standard",
    price_minor: 150000,
    sale_price_minor: null,
    cost_price_minor: 90000,
    active: true,
    created_at: AT,
    ...overrides,
  };
}

function inventoryRow(overrides: Record<string, unknown> = {}) {
  return {
    variant_id: VARIANT_ID,
    on_hand: 5,
    reserved: 0,
    available: 5,
    low_stock_threshold: 2,
    ...overrides,
  };
}

function mediaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MEDIA_ID,
    storage_path: "owner-1/abc.jpg",
    alt_text: "Front",
    position: 0,
    ...overrides,
  };
}

function categoryOptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CATEGORY_ID,
    name: "Shirts",
    slug: "shirts",
    parent_id: null,
    published: true,
    sort_position: 0,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.signingFails = false;
  mocks.handler = (table) => {
    if (table === "user_roles") return { data: OWNER_ROLE, error: null };
    return { data: [], error: null };
  };
});

/** PostgREST's ambiguous-embed rejection, as the live database returns it. */
const AMBIGUOUS_EMBED_ERROR = {
  message:
    "Could not embed because more than one relationship was found for 'products' and 'categories'",
};

describe("readCatalogProduct: ambiguous embed regression", () => {
  it("never embeds categories() and loads a freshly saved product", async () => {
    const seen: string[] = [];
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      seen.push(`${table}:${columns}`);
      if (columns.includes("categories(")) {
        return { data: null, error: AMBIGUOUS_EMBED_ERROR };
      }
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") {
        return { data: [variantRow()], error: null };
      }
      if (table === "inventory") return { data: [inventoryRow()], error: null };
      if (table === "categories") return { data: { name: "Shirts" }, error: null };
      return { data: [], error: null };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(read.detail.product.name).toBe("Gulistan Shirt");
    expect(read.detail.variants).toHaveLength(1);
    expect(read.detail.variants[0]?.inventory?.on_hand).toBe(5);
    expect(read.detail.categoryName).toBe("Shirts");
    expect(read.detail.canManage).toBe(true);
    expect(read.detail.canViewCosts).toBe(true);
    expect(read.detail.variantsUnavailable).toBe(false);
    expect(read.detail.inventoryUnavailable).toBe(false);
    expect(seen.every((q) => !q.includes("categories("))).toBe(true);
  });

  it("reports unavailable when both product selects error, without throwing", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products") {
        return { data: null, error: { message: "boom" } };
      }
      return { data: [], error: null };
    };
    await expect(readCatalogProduct(PRODUCT_ID)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("reports not-found for a missing product", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products") return { data: null, error: null };
      return { data: [], error: null };
    };
    await expect(readCatalogProduct(PRODUCT_ID)).resolves.toEqual({
      status: "not-found",
    });
  });

  it("reports not-found for a non-UUID id without querying product tables", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      throw new Error("must not query product tables for a bad id");
    };
    await expect(readCatalogProduct("not-a-uuid")).resolves.toEqual({
      status: "not-found",
    });
  });

  it("reports unavailable for a malformed product row, without throwing", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products") {
        return { data: productRow({ name: null }), error: null };
      }
      return { data: [], error: null };
    };
    await expect(readCatalogProduct(PRODUCT_ID)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("reads the product via the pre-migration fallback when new columns are missing", async () => {
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products" && columns.includes("youtube_video_id")) {
        return { data: null, error: { message: "column does not exist" } };
      }
      if (table === "products") return { data: productBaseRow(), error: null };
      return { data: [], error: null };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(read.detail.product.is_published).toBe(false);
    expect(read.detail.product.secondary_category_id).toBeNull();
    expect(read.detail.product.youtube_video_id).toBeNull();
  });

  it("falls back when the primary product query rejects", async () => {
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products" && columns.includes("youtube_video_id")) {
        return new Error("connection reset");
      }
      if (table === "products") return { data: productBaseRow(), error: null };
      return { data: [], error: null };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
  });

  it("degrades when the variants query fails", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") {
        return { data: null, error: { message: "offline" } };
      }
      return { data: [], error: null };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(read.detail.variants).toEqual([]);
    expect(read.detail.variantsUnavailable).toBe(true);
  });

  it("skips a malformed variant row and keeps the good ones", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") {
        return {
          data: [
            variantRow(),
            variantRow({ id: VARIANT_2_ID, price_minor: -5 }),
          ],
          error: null,
        };
      }
      if (table === "inventory") return { data: [inventoryRow()], error: null };
      return { data: [], error: null };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(read.detail.variants).toHaveLength(1);
    expect(read.detail.variantsSkipped).toBe(1);
    expect(read.detail.variantsUnavailable).toBe(false);
  });

  it("degrades when the inventory query fails", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") {
        return { data: [variantRow()], error: null };
      }
      if (table === "inventory") {
        return { data: null, error: { message: "offline" } };
      }
      return { data: [], error: null };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(read.detail.variants[0]?.inventory).toBeNull();
    expect(read.detail.inventoryUnavailable).toBe(true);
  });

  it("skips a malformed inventory row and keeps the good ones", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") {
        return {
          data: [
            variantRow(),
            variantRow({ id: VARIANT_2_ID, size: "L" }),
          ],
          error: null,
        };
      }
      if (table === "inventory") {
        return {
          data: [
            inventoryRow(),
            inventoryRow({ variant_id: VARIANT_2_ID, on_hand: -1 }),
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(read.detail.inventorySkipped).toBe(1);
    expect(read.detail.variants[0]?.inventory?.on_hand).toBe(5);
    expect(read.detail.variants[1]?.inventory).toBeNull();
  });

  it("survives rejecting variants and inventory queries", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants" || table === "inventory") {
        return new Error("connection reset");
      }
      return { data: [], error: null };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(read.detail.variantsUnavailable).toBe(true);
  });

  it("reads primary and secondary category names separately", async () => {
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products") return { data: productRow(), error: null };
      if (table === "categories" && columns === "name") {
        // The mock builder drops eq() args, so both name lookups land
        // here; returning one name still proves the separate-read path
        // (no embed) resolves a name for the detail.
        return { data: { name: "Shirts" }, error: null };
      }
      return { data: [], error: null };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(read.detail.categoryName).toBe("Shirts");
    expect(read.detail.secondaryCategoryName).toBe("Shirts");
  });
});

describe("post-save render path: the edit page's loader sequence", () => {
  it("loads detail, category options and gallery for a fresh product", async () => {
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (columns.includes("categories(")) {
        return { data: null, error: AMBIGUOUS_EMBED_ERROR };
      }
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") {
        return { data: [variantRow()], error: null };
      }
      if (table === "inventory") return { data: [inventoryRow()], error: null };
      if (table === "categories" && columns === "name") {
        return { data: { name: "Shirts" }, error: null };
      }
      if (table === "categories") {
        return { data: [categoryOptionRow()], error: null };
      }
      if (table === "product_media") return { data: [], error: null };
      return { data: [], error: null };
    };
    // Same order as the edit page: detail first, then options + gallery.
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    const [options, media] = await Promise.all([
      readCategoryOptionsWithStatus(),
      readProductMedia(PRODUCT_ID),
    ]);
    expect(options.unavailable).toBe(false);
    expect(options.options).toHaveLength(1);
    expect(media.unavailable).toBe(false);
    expect(media.items).toEqual([]);
  });
});

describe("readProductMedia: non-throwing gallery read", () => {
  it("reports unavailable when the gallery query errors", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "product_media") {
        return { data: null, error: { message: "offline" } };
      }
      return { data: [], error: null };
    };
    await expect(readProductMedia(PRODUCT_ID)).resolves.toEqual({
      items: [],
      unavailable: true,
      skipped: 0,
    });
  });

  it("reports unavailable when the gallery query rejects", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "product_media") return new Error("connection reset");
      return { data: [], error: null };
    };
    const media = await readProductMedia(PRODUCT_ID);
    expect(media.unavailable).toBe(true);
    expect(media.items).toEqual([]);
  });

  it("skips a malformed gallery row and keeps the good ones", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "product_media") {
        return {
          data: [mediaRow(), mediaRow({ id: uuid("e7"), position: 99 })],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    const media = await readProductMedia(PRODUCT_ID);
    expect(media.items).toHaveLength(1);
    expect(media.items[0]?.url).toBe("https://signed.example/thumb");
    expect(media.skipped).toBe(1);
    expect(media.unavailable).toBe(false);
  });

  it("leaves the preview URL null when signing rejects", async () => {
    mocks.signingFails = true;
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "product_media") return { data: [mediaRow()], error: null };
      return { data: [], error: null };
    };
    const media = await readProductMedia(PRODUCT_ID);
    expect(media.items).toHaveLength(1);
    expect(media.items[0]?.url).toBeNull();
    expect(media.unavailable).toBe(false);
  });

  it("returns empty for a non-UUID product id", async () => {
    await expect(readProductMedia("not-a-uuid")).resolves.toEqual({
      items: [],
      unavailable: false,
      skipped: 0,
    });
  });
});

describe("readCategoryOptionsWithStatus: non-throwing option read", () => {
  it("reports unavailable when both queries error", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      return { data: null, error: { message: "offline" } };
    };
    await expect(readCategoryOptionsWithStatus()).resolves.toEqual({
      options: [],
      unavailable: true,
      skipped: 0,
    });
  });

  it("falls back to the pre-migration select", async () => {
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "categories" && columns.includes("sort_position")) {
        return { data: null, error: { message: "column does not exist" } };
      }
      if (table === "categories") {
        const row = categoryOptionRow();
        delete (row as Record<string, unknown>).sort_position;
        return { data: [row], error: null };
      }
      return { data: [], error: null };
    };
    const read = await readCategoryOptionsWithStatus();
    expect(read.unavailable).toBe(false);
    expect(read.options).toHaveLength(1);
    expect(read.options[0]?.sort_position).toBe(0);
  });

  it("counts skipped malformed options", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "categories") {
        return {
          data: [
            categoryOptionRow(),
            categoryOptionRow({ id: uuid("c5"), name: null }),
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    const read = await readCategoryOptionsWithStatus();
    expect(read.options).toHaveLength(1);
    expect(read.skipped).toBe(1);
    expect(read.unavailable).toBe(false);
  });

  it("readCategoryOptions wrapper keeps its throw/empty contract", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      return { data: null, error: { message: "offline" } };
    };
    await expect(readCategoryOptions()).rejects.toThrow(
      "Categories could not be read.",
    );
    await expect(
      readCategoryOptions({ onUnavailable: "empty" }),
    ).resolves.toEqual([]);
  });
});

describe("catalog-media actions: malformed rows return action errors", () => {
  it("replaceCatalogImage returns an action error for a malformed existing row", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "product_media") {
        return { data: mediaRow({ position: 99 }), error: null };
      }
      return { data: [], error: null };
    };
    const form = new FormData();
    form.set("product_id", PRODUCT_ID);
    form.set("media_id", MEDIA_ID);
    form.set(
      "image",
      new File([new Uint8Array([255, 216, 255, 0])], "new.jpg", {
        type: "image/jpeg",
      }),
    );
    const result = await replaceCatalogImage(form);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/could not be read/i);
  });

  it("reorderCatalogMedia returns an action error for malformed existing ids", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "product_media") {
        return { data: [{ id: "not-a-uuid" }], error: null };
      }
      return { data: [], error: null };
    };
    const result = await reorderCatalogMedia(PRODUCT_ID, [MEDIA_ID]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/could not be checked/i);
  });
});

describe("inventory loaders: malformed rows never crash the page", () => {
  function inventoryVariantRow(overrides: Record<string, unknown> = {}) {
    return {
      id: VARIANT_ID,
      product_id: PRODUCT_ID,
      size: "M",
      color: "Blue",
      price_minor: 150000,
      sale_price_minor: null,
      active: true,
      products: { name: "Gulistan Shirt", slug: "gulistan-shirt", status: "published" },
      inventory: {
        on_hand: 5,
        reserved: 0,
        available: 5,
        low_stock_threshold: 2,
      },
      ...overrides,
    };
  }

  it("readInventory skips a malformed variant row and counts it", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "product_variants") {
        return {
          data: [
            inventoryVariantRow(),
            inventoryVariantRow({ id: VARIANT_2_ID, price_minor: -5 }),
          ],
          error: null,
          count: 2,
        };
      }
      return { data: [], error: null };
    };
    const result = await readInventory({
      q: "",
      stock: "",
      page: 1,
    });
    expect(result).not.toBeNull();
    expect(result?.rows).toHaveLength(1);
    expect(result?.skippedRows).toBe(1);
    expect(result?.overview.variantCount).toBe(1);
  });

  it("readVariantOptions skips a malformed option row", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "product_variants") {
        return {
          data: [
            {
              id: VARIANT_ID,
              size: "M",
              color: "Blue",
              products: { name: "Gulistan Shirt" },
              inventory: { on_hand: 5, available: 5 },
            },
            {
              id: VARIANT_2_ID,
              size: "L",
              color: "Blue",
              products: { name: "Gulistan Shirt" },
              inventory: { on_hand: -1, available: -1 },
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    const options = await readVariantOptions();
    expect(options).toHaveLength(1);
    expect(options?.[0]?.variantId).toBe(VARIANT_ID);
  });

  it("readMovementHistory skips a malformed movement row", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "inventory_movements") {
        return {
          data: [
            {
              id: uuid("f1"),
              variant_id: VARIANT_ID,
              actor_id: null,
              delta: 5,
              on_hand_after: 5,
              reason: "Initial stock",
              created_at: AT,
            },
            {
              id: uuid("f2"),
              variant_id: VARIANT_ID,
              actor_id: null,
              delta: 1,
              on_hand_after: -1,
              reason: "Bad row",
              created_at: AT,
            },
          ],
          error: null,
          count: 2,
        };
      }
      if (table === "product_variants") {
        return {
          data: [
            {
              id: VARIANT_ID,
              size: "M",
              color: "Blue",
              products: { name: "Gulistan Shirt" },
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    const history = await readMovementHistory(1);
    expect(history).not.toBeNull();
    expect(history?.rows).toHaveLength(1);
    expect(history?.rows[0]?.variantLabel).toContain("Gulistan Shirt");
  });
});
