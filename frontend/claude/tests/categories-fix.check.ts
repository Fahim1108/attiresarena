import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Categories-fix regressions (diagnosed live 2026-11-16):
 * 1. /admin/catalog/categories threw the admin error boundary on every
 *    load (first load AND Retry) even after the catalogue fix had made
 *    listCategories validate rows one by one. The remaining throw class
 *    on the page's load path was UNGUARDED QUERY REJECTIONS: neither
 *    listCategories nor getLayoutSettings caught a rejecting query
 *    (timeout, abort, transport failure), so any rejection threw into
 *    the boundary — while the sibling loader readCategoryOptionsWithStatus
 *    already caught rejections and degraded. These tests pin the
 *    non-throwing contracts: a rejecting read degrades (null / action
 *    error), never throws.
 * 2. Every product edit save showed "Product saved, but the category
 *    assignment could not be saved" (categories=failed) even though the
 *    category demonstrably persisted: updateCatalogProduct treated a
 *    failed admin_assign_product_categories RPC as proof the assignment
 *    was lost, but the save RPC already persists category_id and the
 *    assign RPC rejects pairs the save RPC accepts (e.g. a non-top-level
 *    primary). The save path now VERIFIES against the stored row: only
 *    a read-back mismatch reports failure; an unreadable read-back
 *    reports "unverified", never a false failure.
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
  rpcHandler: null as
    | null
    | ((fn: string, args: unknown) => QueryResult | Error),
  signingFails: false,
  removeFails: false,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/services/adapters/published-thrift", () => ({
  readPublishedFeed: async () => {
    throw new Error("feed reads are out of scope for categories-fix tests");
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
      rpc: async (fn: string, args: unknown) => {
        const handler = mocks.rpcHandler;
        if (!handler) {
          return {
            data: null,
            error: { message: "RPC unavailable in categories-fix tests" },
          };
        }
        const result = handler(fn, args);
        if (result instanceof Error) throw result;
        return result;
      },
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
          remove: async () => {
            if (mocks.removeFails) {
              throw new Error("storage removal unavailable");
            }
            return { data: null, error: null };
          },
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
  deleteCategory,
  listCategories,
  normalizeCategoryOrder,
  reorderCategories,
  saveCategory,
} from "../src/lib/admin/catalog-categories";
import { getLayoutSettings } from "../src/lib/admin/layout-settings";
import {
  createCatalogProduct,
  updateCatalogProduct,
} from "../src/lib/admin/catalog-products";
import {
  buildCategoryTree,
  flattenCategoryOptions,
} from "../src/lib/admin/catalog-variants";

const OWNER_ROLE = [{ user_id: "owner-1", role: "owner" }];
const AT = "2026-11-15T10:00:00+00:00";
const uuid = (tail: string) => `22222222-2222-4222-8222-2222222222${tail}`;

const PRODUCT_ID = uuid("a1");
const CATEGORY_ID = uuid("c3");
const SECONDARY_ID = uuid("c4");
const OTHER_CATEGORY_ID = uuid("c5");

function categoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CATEGORY_ID,
    parent_id: null,
    name: "Shirts",
    slug: "shirts",
    published: true,
    description: "",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    seo_description: null,
    sort_position: 0,
    updated_at: AT,
    ...overrides,
  };
}

function categoryBaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CATEGORY_ID,
    parent_id: null,
    name: "Shirts",
    slug: "shirts",
    published: true,
    updated_at: AT,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.signingFails = false;
  mocks.removeFails = false;
  mocks.rpcHandler = null;
  mocks.handler = (table) => {
    if (table === "user_roles") return { data: OWNER_ROLE, error: null };
    return { data: [], error: null };
  };
});

describe("listCategories never throws on rejecting reads", () => {
  it("primary query rejects, fallback succeeds: returns fallback rows", async () => {
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "categories" && columns.includes("sort_position")) {
        throw new Error("query timed out");
      }
      return { data: [categoryBaseRow()], error: null };
    };
    const live = await listCategories();
    expect(live).not.toBeNull();
    expect(live?.categories).toHaveLength(1);
    expect(live?.categories[0]?.name).toBe("Shirts");
    expect(live?.categories[0]?.sort_position).toBe(0);
  });

  it("primary errors, fallback rejects: returns null (samples render)", async () => {
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "categories" && columns.includes("sort_position")) {
        return { data: null, error: { message: "column missing" } };
      }
      throw new Error("fallback timed out");
    };
    await expect(listCategories()).resolves.toBeNull();
  });

  it("both queries reject: returns null, never throws", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      throw new Error("transport failure");
    };
    await expect(listCategories()).resolves.toBeNull();
  });

  it("signing rejects for every row: rows render with null URLs", async () => {
    mocks.signingFails = true;
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      return {
        data: [
          categoryRow({ image_storage_path: "owner-1/abc.jpg" }),
        ],
        error: null,
      };
    };
    const live = await listCategories();
    expect(live?.categories).toHaveLength(1);
    expect(live?.categories[0]?.imageUrl).toBeNull();
  });
});

describe("getLayoutSettings never throws on rejecting reads", () => {
  it("query rejects: returns null", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      throw new Error("query timed out");
    };
    await expect(getLayoutSettings()).resolves.toBeNull();
  });

  it("null and non-object rows are skipped, valid rows parse", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      return {
        data: [
          null,
          "not-a-row",
          { key: "featured_categories_count", value: 6 },
          { key: "nope", value: 1 },
          { key: "redirect_auto", value: "not-a-boolean" },
          { key: "redirect_auto", value: true },
        ],
        error: null,
      };
    };
    const settings = await getLayoutSettings();
    expect(settings).toEqual({
      featured_categories_count: 6,
      redirect_auto: true,
    });
  });
});

function categoryForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  form.set("name", "New Category");
  form.set("slug", "new-category");
  form.set("category_level", "primary");
  form.set("parent_id", "");
  form.set("published", "on");
  form.set("description", "");
  form.set("image_storage_path", "");
  form.set("banner_storage_path", "");
  form.set("seo_title", "");
  form.set("seo_description", "");
  form.set("sort_position", "0");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

describe("category actions never throw on rejecting calls", () => {
  it("saveCategory: hierarchy read rejects -> honest error state", async () => {
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "categories" && columns === "id,parent_id") {
        throw new Error("hierarchy read timed out");
      }
      return { data: [], error: null };
    };
    const state = await saveCategory({ ok: false }, categoryForm({}));
    expect(state.ok).toBe(false);
    expect(state.error).toMatch(/could not be checked/);
  });

  it("saveCategory: RPC rejects -> error state, never throws", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      return { data: [{ id: CATEGORY_ID, parent_id: null }], error: null };
    };
    mocks.rpcHandler = () => {
      throw new Error("rpc timed out");
    };
    const state = await saveCategory({ ok: false }, categoryForm({}));
    expect(state.ok).toBe(false);
    expect(state.error).toMatch(/could not be saved/);
  });

  it("saveCategory: stale-image cleanup rejects -> save still succeeds", async () => {
    mocks.removeFails = true;
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      return { data: [{ id: CATEGORY_ID, parent_id: null }], error: null };
    };
    mocks.rpcHandler = () => ({ data: null, error: null });
    const state = await saveCategory(
      { ok: false },
      categoryForm({
        id: CATEGORY_ID,
        updated_at: AT,
        image_storage_path: `${uuid("f1")}/${uuid("f2")}.jpg`,
        old_image_storage_path: `${uuid("f3")}/${uuid("f4")}.jpg`,
      }),
    );
    expect(state.ok).toBe(true);
  });

  it("deleteCategory: RPC rejects -> action error, never throws", async () => {
    mocks.rpcHandler = () => {
      throw new Error("rpc timed out");
    };
    const result = await deleteCategory(CATEGORY_ID);
    expect(result.ok).toBe(false);
  });

  it("deleteCategory: existing-read rejects -> delete still proceeds", async () => {
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (columns.includes("image_storage_path")) {
        throw new Error("read timed out");
      }
      return { data: [], error: null };
    };
    mocks.rpcHandler = () => ({ data: null, error: null });
    const result = await deleteCategory(CATEGORY_ID);
    expect(result.ok).toBe(true);
  });

  it("reorderCategories: RPC rejects -> action error, never throws", async () => {
    mocks.rpcHandler = () => {
      throw new Error("rpc timed out");
    };
    const result = await reorderCategories([CATEGORY_ID, OTHER_CATEGORY_ID]);
    expect(result.ok).toBe(false);
  });

  it("normalizeCategoryOrder: query rejects -> action error", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      throw new Error("read timed out");
    };
    const result = await normalizeCategoryOrder();
    expect(result.ok).toBe(false);
  });

  it("normalizeCategoryOrder: reorder RPC rejects mid-run -> action error", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      return {
        data: [
          { id: CATEGORY_ID, parent_id: null, sort_position: 5 },
          { id: OTHER_CATEGORY_ID, parent_id: null, sort_position: 6 },
        ],
        error: null,
      };
    };
    mocks.rpcHandler = () => {
      throw new Error("rpc timed out");
    };
    const result = await normalizeCategoryOrder();
    expect(result.ok).toBe(false);
  });
});

function productForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  form.set("name", "Test Shirt");
  form.set("slug", "test-shirt");
  form.set("description", "A test shirt.");
  form.set("status", "published");
  form.set("category_id", CATEGORY_ID);
  form.set("secondary_category_id", "");
  form.set("base_price", "999");
  form.set("base_stock", "1");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

async function redirectTarget(
  run: () => Promise<unknown>,
): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = (error as Error).message;
    expect(message.startsWith("REDIRECT:")).toBe(true);
    return message.slice("REDIRECT:".length);
  }
  throw new Error("expected a redirect");
}

function mockProductReads(pair: {
  categoryId: string | null;
  secondaryCategoryId: string | null;
} | Error) {
  mocks.handler = (table, columns) => {
    if (table === "user_roles") return { data: OWNER_ROLE, error: null };
    if (table === "products" && columns === "updated_at,slug") {
      return { data: { updated_at: AT, slug: "test-shirt" }, error: null };
    }
    if (table === "products" && columns === "category_id,secondary_category_id") {
      if (pair instanceof Error) throw pair;
      return {
        data: {
          category_id: pair.categoryId,
          secondary_category_id: pair.secondaryCategoryId,
        },
        error: null,
      };
    }
    return { data: [], error: null };
  };
}

describe("category assignment is verified before reporting failure", () => {
  it("UPDATE: assign RPC fails but the stored pair matches -> NO categories flag (live symptom)", async () => {
    mockProductReads({ categoryId: CATEGORY_ID, secondaryCategoryId: null });
    mocks.rpcHandler = (fn) => {
      if (fn === "admin_update_product") return { data: null, error: null };
      if (fn === "admin_assign_product_categories") {
        return {
          data: null,
          error: { message: "The primary category must be a top-level category" },
        };
      }
      return { data: null, error: { message: "unexpected RPC" } };
    };
    const target = await redirectTarget(() =>
      updateCatalogProduct(
        { ok: false },
        productForm({ id: PRODUCT_ID, updated_at: AT }),
      ),
    );
    expect(target).toBe(
      `/admin/catalog/products/${PRODUCT_ID}?saved=updated`,
    );
  });

  it("UPDATE: assign RPC fails and the stored pair differs -> categories=failed", async () => {
    mockProductReads({
      categoryId: CATEGORY_ID,
      secondaryCategoryId: SECONDARY_ID,
    });
    mocks.rpcHandler = (fn) => {
      if (fn === "admin_update_product") return { data: null, error: null };
      return { data: null, error: { message: "assign rejected" } };
    };
    const target = await redirectTarget(() =>
      updateCatalogProduct(
        { ok: false },
        productForm({
          id: PRODUCT_ID,
          updated_at: AT,
          secondary_category_id: "",
        }),
      ),
    );
    // Submitted (primary, null) but the stored row still carries the old
    // secondary: the assignment genuinely did not save.
    expect(target).toContain("categories=failed");
  });

  it("UPDATE: assign RPC fails and the read-back rejects -> categories=unverified", async () => {
    mockProductReads(new Error("read-back timed out"));
    mocks.rpcHandler = (fn) => {
      if (fn === "admin_update_product") return { data: null, error: null };
      return { data: null, error: { message: "assign rejected" } };
    };
    const target = await redirectTarget(() =>
      updateCatalogProduct(
        { ok: false },
        productForm({ id: PRODUCT_ID, updated_at: AT }),
      ),
    );
    expect(target).toContain("categories=unverified");
    expect(target).not.toContain("categories=failed");
  });

  it("UPDATE: assign RPC succeeds -> no flag, no read-back needed", async () => {
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products" && columns === "updated_at,slug") {
        return { data: { updated_at: AT, slug: "test-shirt" }, error: null };
      }
      if (table === "products") {
        throw new Error("read-back must not run after a successful assign");
      }
      return { data: [], error: null };
    };
    mocks.rpcHandler = () => ({ data: AT, error: null });
    const target = await redirectTarget(() =>
      updateCatalogProduct(
        { ok: false },
        productForm({ id: PRODUCT_ID, updated_at: AT }),
      ),
    );
    expect(target).toBe(
      `/admin/catalog/products/${PRODUCT_ID}?saved=updated`,
    );
  });

  it("UPDATE: revision read rejects, stored pair matches -> no flag", async () => {
    mocks.handler = (table, columns) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products" && columns === "updated_at,slug") {
        throw new Error("revision read timed out");
      }
      if (table === "products" && columns === "category_id,secondary_category_id") {
        return {
          data: { category_id: CATEGORY_ID, secondary_category_id: null },
          error: null,
        };
      }
      return { data: [], error: null };
    };
    mocks.rpcHandler = (fn) => {
      if (fn === "admin_update_product") return { data: null, error: null };
      throw new Error("assign must not run without a revision");
    };
    const target = await redirectTarget(() =>
      updateCatalogProduct(
        { ok: false },
        productForm({ id: PRODUCT_ID, updated_at: AT }),
      ),
    );
    expect(target).toBe(
      `/admin/catalog/products/${PRODUCT_ID}?saved=updated`,
    );
  });

  it("UPDATE: assign RPC rejects, stored pair matches -> no flag", async () => {
    mockProductReads({ categoryId: CATEGORY_ID, secondaryCategoryId: null });
    mocks.rpcHandler = (fn) => {
      if (fn === "admin_update_product") return { data: null, error: null };
      throw new Error("assign rpc timed out");
    };
    const target = await redirectTarget(() =>
      updateCatalogProduct(
        { ok: false },
        productForm({ id: PRODUCT_ID, updated_at: AT }),
      ),
    );
    expect(target).toBe(
      `/admin/catalog/products/${PRODUCT_ID}?saved=updated`,
    );
  });

  it("UPDATE: null pair submitted and stored -> no flag when assign fails", async () => {
    mockProductReads({ categoryId: null, secondaryCategoryId: null });
    mocks.rpcHandler = (fn) => {
      if (fn === "admin_update_product") return { data: null, error: null };
      return { data: null, error: { message: "assign rejected" } };
    };
    const target = await redirectTarget(() =>
      updateCatalogProduct(
        { ok: false },
        productForm({
          id: PRODUCT_ID,
          updated_at: AT,
          category_id: "",
          secondary_category_id: "",
        }),
      ),
    );
    expect(target).toBe(
      `/admin/catalog/products/${PRODUCT_ID}?saved=updated`,
    );
  });

  it("CREATE with secondary: assign fails but stored pair matches -> no flag", async () => {
    mockProductReads({
      categoryId: CATEGORY_ID,
      secondaryCategoryId: SECONDARY_ID,
    });
    mocks.rpcHandler = (fn) => {
      if (fn === "admin_create_product") return { data: PRODUCT_ID, error: null };
      return { data: null, error: { message: "assign rejected" } };
    };
    const target = await redirectTarget(() =>
      createCatalogProduct(
        { ok: false },
        productForm({ secondary_category_id: SECONDARY_ID }),
      ),
    );
    expect(target).toBe(
      `/admin/catalog/products/${PRODUCT_ID}?saved=created`,
    );
  });

  it("CREATE with secondary: assign fails and stored pair differs -> categories=failed", async () => {
    mockProductReads({ categoryId: CATEGORY_ID, secondaryCategoryId: null });
    mocks.rpcHandler = (fn) => {
      if (fn === "admin_create_product") return { data: PRODUCT_ID, error: null };
      return { data: null, error: { message: "assign rejected" } };
    };
    const target = await redirectTarget(() =>
      createCatalogProduct(
        { ok: false },
        productForm({ secondary_category_id: SECONDARY_ID }),
      ),
    );
    expect(target).toContain("categories=failed");
  });
});

describe("flattenCategoryOptions lives in the server-safe module", () => {
  // REGRESSION: the categories page is a Server Component. When this helper
  // was exported from the "use client" category-list module, calling it
  // during the server render threw ("Attempted to call
  // flattenCategoryOptions() from the server") and crashed the whole page
  // into the admin error boundary on every load with a managing session —
  // the live 2026-11-16 symptom. It must stay importable from the shared
  // catalog-variants module, which has no client boundary.
  const flat = [
    { id: "a", parent_id: null, name: "Shirts", slug: "shirts", published: true, description: "", image_storage_path: null, banner_storage_path: null, seo_title: null, seo_description: null, sort_position: 0, updated_at: AT },
    { id: "b", parent_id: "a", name: "Formal", slug: "formal", published: true, description: "", image_storage_path: null, banner_storage_path: null, seo_title: null, seo_description: null, sort_position: 0, updated_at: AT },
    { id: "c", parent_id: null, name: "Archive", slug: "archive", published: false, description: "", image_storage_path: null, banner_storage_path: null, seo_title: null, seo_description: null, sort_position: 1, updated_at: AT },
  ];

  it("flattens the tree with depth-prefixed labels", () => {
    const tree = buildCategoryTree(flat);
    expect(flattenCategoryOptions(tree, new Set())).toEqual([
      { id: "a", label: "Shirts", depth: 1 },
      { id: "b", label: "— Formal", depth: 2 },
      { id: "c", label: "Archive", depth: 1 },
    ]);
  });

  it("skips excluded ids but still walks their children", () => {
    const tree = buildCategoryTree(flat);
    expect(flattenCategoryOptions(tree, new Set(["a"]))).toEqual([
      { id: "b", label: "— Formal", depth: 2 },
      { id: "c", label: "Archive", depth: 1 },
    ]);
  });

  it("terminates on a cyclic tree", () => {
    const cyclic = buildCategoryTree(flat);
    // Force a cycle the builder would never produce: child points back
    // at its parent. The visited guard must keep the walk finite.
    const root = cyclic[0];
    const child = root?.children[0];
    if (!root || !child) throw new Error("fixture tree shape changed");
    child.children.push(root);
    expect(() => flattenCategoryOptions(cyclic, new Set())).not.toThrow();
    expect(flattenCategoryOptions(cyclic, new Set())).toHaveLength(3);
  });
});
