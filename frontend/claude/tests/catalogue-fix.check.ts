import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Catalogue-fix regressions (diagnosed live 2026-11-15):
 * 1. Categories page threw the admin error boundary on any malformed
 *    category row (whole-array Zod .parse) and could lose cyclic
 *    categories in the tree build.
 * 2. Products page fell back to samples when ANY embedded relation
 *    failed, because one PostgREST query embedded them all.
 * 3. Users page always showed role-permission defaults: no migration
 *    ever granted SELECT on role_permissions (migration 015 fixes the
 *    database side; the loader must keep degrading honestly).
 * 4. "Processing" leaked as a status label for packed orders.
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
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/services/adapters/published-thrift", () => ({
  readPublishedFeed: async () => {
    throw new Error("feed reads are out of scope for catalogue-fix tests");
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
        error: { message: "RPC unavailable in catalogue-fix tests" },
      }),
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: { signedUrl: "https://signed.example/thumb" },
            error: null,
          }),
          remove: async () => ({ data: null, error: null }),
        }),
      },
    }),
    adminConfiguration: () => null,
  };
});

import { listCategories } from "../src/lib/admin/catalog-categories";
import {
  listCatalogProducts,
  readCategoryOptions,
} from "../src/lib/admin/catalog-products";
import {
  getRolePermissionMatrix,
  getStaffMembers,
} from "../src/lib/admin/users";
import {
  buildCategoryTree,
  type CategoryFlat,
} from "../src/lib/admin/catalog-variants";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
} from "../src/lib/admin/constants";
import { OrderTimeline } from "../src/components/account/OrderTimeline";

const OWNER_ROLE = [{ user_id: "owner-1", role: "owner" }];
const AT = "2026-11-15T10:00:00+00:00";
const uuid = (tail: string) => `11111111-1111-4111-8111-1111111111${tail}`;

function categoryRow(overrides: Partial<CategoryFlat> = {}): CategoryFlat {
  return {
    id: uuid("01"),
    parent_id: null,
    name: "Shirts",
    slug: "shirts",
    published: true,
    description: "All shirts.",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    seo_description: null,
    sort_position: 0,
    updated_at: AT,
    ...overrides,
  };
}

function flatCategory(
  id: string,
  parentId: string | null,
  name: string,
): CategoryFlat {
  return categoryRow({ id, parent_id: parentId, name, slug: name });
}

type TreeLike = { id: string; children: readonly TreeLike[] };

/** Walk a tree without a visited set; fails if the walk cannot finish. */
function flattenTreeIds(nodes: readonly TreeLike[]): string[] {
  const ids: string[] = [];
  let steps = 0;
  const walk = (list: readonly TreeLike[]) => {
    for (const node of list) {
      steps += 1;
      if (steps > 100) throw new Error("Tree walk did not terminate: cycle?");
      ids.push(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

const PRODUCT_A = uuid("a1");
const PRODUCT_B = uuid("b2");
const CATEGORY_ID = uuid("c3");
const VARIANT_A = uuid("d4");

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_A,
    name: "Thrift Shirt A",
    slug: "thrift-shirt-a",
    description: "A shirt.",
    status: "published",
    category_id: CATEGORY_ID,
    is_published: true,
    published_at: AT,
    created_at: AT,
    updated_at: AT,
    badges: [],
    ...overrides,
  };
}

const DEFAULT_FILTERS = {
  q: "",
  categoryId: "",
  stock: "" as const,
  minPriceMinor: null,
  maxPriceMinor: null,
  sort: "newest" as const,
  page: 1,
  pageSize: 25,
};

beforeEach(() => {
  mocks.handler = (table) => {
    if (table === "user_roles") return { data: OWNER_ROLE, error: null };
    return { data: [], error: null };
  };
});

describe("categories loader: malformed rows never crash the page", () => {
  it("skips a malformed row, counts it, and returns the good rows", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "categories") {
        return {
          data: [
            categoryRow(),
            // description must be a string; null failed the old .parse().
            { ...categoryRow({ id: uuid("02"), name: "Bad", slug: "bad" }), description: null },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    const live = await listCategories();
    expect(live).not.toBeNull();
    expect(live?.categories.map((c) => c.name)).toEqual(["Shirts"]);
    expect(live?.malformedRows).toBe(1);
    expect(live?.canManage).toBe(true);
  });

  it("returns null when the categories query itself is unavailable", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      return { data: null, error: { message: "relation does not exist" } };
    };
    await expect(listCategories()).resolves.toBeNull();
  });

  it("survives a rejecting categories query in the options reader", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      return { data: null, error: { message: "offline" } };
    };
    await expect(
      readCategoryOptions({ onUnavailable: "empty" }),
    ).resolves.toEqual([]);
  });
});

describe("buildCategoryTree: cycles, dangling parents, order", () => {
  it("renders every category exactly once when parents form a cycle", () => {
    const flat = [
      flatCategory("a", "b", "A"),
      flatCategory("b", "a", "B"),
      flatCategory("c", "a", "C"),
      flatCategory("root", null, "Root"),
    ];
    const tree = buildCategoryTree(flat);
    expect(flattenTreeIds(tree).sort()).toEqual(["a", "b", "c", "root"]);
    // Cycle members become roots (depth 1) instead of vanishing.
    expect(tree.map((n) => n.id).sort()).toEqual(["a", "b", "c", "root"]);
  });

  it("renders a self-parent and a dangling parent as roots", () => {
    const flat = [
      flatCategory("self", "self", "Self"),
      flatCategory("orphan", "missing", "Orphan"),
      flatCategory("root", null, "Root"),
    ];
    const tree = buildCategoryTree(flat);
    expect(flattenTreeIds(tree).sort()).toEqual(["orphan", "root", "self"]);
    expect(tree.map((n) => n.depth)).toEqual([1, 1, 1]);
  });

  it("derives depth from the chain even when children precede parents", () => {
    const flat = [
      flatCategory("grand", "child", "Grand"),
      flatCategory("child", "root", "Child"),
      flatCategory("root", null, "Root"),
    ];
    const tree = buildCategoryTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.depth).toBe(1);
    expect(tree[0]?.children[0]?.depth).toBe(2);
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(3);
    expect(flattenTreeIds(tree)).toEqual(["root", "child", "grand"]);
  });

  it("keeps the first row for a duplicated id", () => {
    const flat = [
      flatCategory("dup", null, "First"),
      flatCategory("dup", null, "Second"),
    ];
    const tree = buildCategoryTree(flat);
    expect(flattenTreeIds(tree)).toEqual(["dup"]);
    expect(tree[0]?.name).toBe("First");
  });
});

describe("products loader: decoupled relations degrade independently", () => {
  function productsHandler(
    overrides: Partial<Record<string, QueryResult | Error>> = {},
  ) {
    return (table: string, columns: string): QueryResult | Error => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "products" && columns.includes("is_published")) {
        return (
          (overrides.products as QueryResult | undefined) ?? {
            data: [
              productRow(),
              productRow({
                id: PRODUCT_B,
                name: "Thrift Shirt B",
                slug: "thrift-shirt-b",
              }),
            ],
            error: null,
            count: 2,
          }
        );
      }
      if (table === "products") {
        return (
          (overrides.productsFallback as QueryResult | undefined) ?? {
            data: [],
            error: null,
            count: 0,
          }
        );
      }
      if (table === "categories") {
        return (
          (overrides.categories as QueryResult | undefined) ?? {
            data: [{ id: CATEGORY_ID, name: "Shirts" }],
            error: null,
          }
        );
      }
      if (table === "product_variants") {
        return (
          (overrides.variants as QueryResult | undefined) ?? {
            data: [
              {
                id: VARIANT_A,
                product_id: PRODUCT_A,
                price_minor: 150000,
                sale_price_minor: null,
                active: true,
              },
            ],
            error: null,
          }
        );
      }
      if (table === "inventory") {
        return (
          (overrides.inventory as QueryResult | undefined) ?? {
            data: [
              {
                variant_id: VARIANT_A,
                on_hand: 3,
                reserved: 1,
                available: 2,
                low_stock_threshold: 5,
              },
            ],
            error: null,
          }
        );
      }
      if (table === "product_media") {
        return (
          (overrides.media as QueryResult | undefined) ?? {
            data: [
              {
                product_id: PRODUCT_A,
                storage_path: `${"owner-1"}/${uuid("e5")}.jpg`,
                alt_text: "Front view",
                position: 0,
              },
            ],
            error: null,
          }
        );
      }
      return { data: [], error: null };
    };
  }

  it("lists products with full details when every relation succeeds", async () => {
    mocks.handler = productsHandler();
    const result = await listCatalogProducts(DEFAULT_FILTERS);
    expect(result).not.toBeNull();
    expect(result?.items).toHaveLength(2);
    expect(result?.degraded).toEqual([]);
    expect(result?.skippedRows).toBe(0);
    const first = result?.items.find((item) => item.id === PRODUCT_A);
    expect(first?.categoryName).toBe("Shirts");
    expect(first?.minPriceMinor).toBe(150000);
    expect(first?.available).toBe(2);
    expect(first?.variantCount).toBe(1);
    expect(first?.thumbnailUrl).toBe("https://signed.example/thumb");
    expect(first?.thumbnailAlt).toBe("Front view");
  });

  it("still lists products when the categories and media relations fail", async () => {
    mocks.handler = productsHandler({
      categories: { data: null, error: { message: "categories offline" } },
      media: { data: null, error: { message: "media offline" } },
    });
    const result = await listCatalogProducts(DEFAULT_FILTERS);
    expect(result).not.toBeNull();
    expect(result?.items).toHaveLength(2);
    expect(result?.degraded).toEqual(["categories", "media"]);
    const first = result?.items.find((item) => item.id === PRODUCT_A);
    expect(first?.categoryName).toBeNull();
    expect(first?.thumbnailUrl).toBeNull();
    expect(first?.minPriceMinor).toBe(150000);
    expect(first?.available).toBe(2);
  });

  it("still lists products when the variants relation fails", async () => {
    mocks.handler = productsHandler({
      variants: { data: null, error: { message: "variants offline" } },
    });
    const result = await listCatalogProducts(DEFAULT_FILTERS);
    expect(result).not.toBeNull();
    expect(result?.items).toHaveLength(2);
    expect(result?.degraded).toEqual(["variants"]);
    expect(result?.items[0]?.variantCount).toBe(0);
    expect(result?.items[0]?.minPriceMinor).toBeNull();
  });

  it("still lists products when the inventory relation fails", async () => {
    mocks.handler = productsHandler({
      inventory: { data: null, error: { message: "inventory offline" } },
    });
    const result = await listCatalogProducts(DEFAULT_FILTERS);
    expect(result).not.toBeNull();
    expect(result?.items).toHaveLength(2);
    expect(result?.degraded).toEqual(["inventory"]);
    const first = result?.items.find((item) => item.id === PRODUCT_A);
    expect(first?.variantCount).toBe(1);
    expect(first?.minPriceMinor).toBe(150000);
    expect(first?.available).toBe(0);
  });

  it("still lists products when a relation query rejects", async () => {
    mocks.handler = productsHandler({
      media: new Error("network down"),
    });
    const result = await listCatalogProducts(DEFAULT_FILTERS);
    expect(result).not.toBeNull();
    expect(result?.items).toHaveLength(2);
    expect(result?.degraded).toEqual(["media"]);
  });

  it("returns null only when the base products read fails on both shapes", async () => {
    mocks.handler = productsHandler({
      products: { data: null, error: { message: "products offline" } },
      productsFallback: { data: null, error: { message: "still offline" } },
    });
    await expect(listCatalogProducts(DEFAULT_FILTERS)).resolves.toBeNull();
  });

  it("uses the pre-migration fallback shape as unpublished", async () => {
    mocks.handler = productsHandler({
      products: { data: null, error: { message: "column missing" } },
      productsFallback: {
        data: [
          {
            id: PRODUCT_A,
            name: "Thrift Shirt A",
            slug: "thrift-shirt-a",
            description: "A shirt.",
            status: "published",
            category_id: CATEGORY_ID,
            created_at: AT,
            updated_at: AT,
            badges: [],
          },
        ],
        error: null,
        count: 1,
      },
    });
    const result = await listCatalogProducts(DEFAULT_FILTERS);
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.isPublished).toBe(false);
    expect(result?.items[0]?.publishedAt).toBeNull();
  });

  it("skips a malformed product row instead of crashing", async () => {
    mocks.handler = productsHandler({
      products: {
        data: [productRow(), { ...productRow({ id: PRODUCT_B }), status: "bogus" }],
        error: null,
        count: 2,
      },
    });
    const result = await listCatalogProducts(DEFAULT_FILTERS);
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.id).toBe(PRODUCT_A);
    expect(result?.skippedRows).toBe(1);
  });

  it("reports unavailable when every product row is malformed", async () => {
    mocks.handler = productsHandler({
      products: {
        data: [{ ...productRow(), status: "bogus" }],
        error: null,
        count: 1,
      },
    });
    await expect(listCatalogProducts(DEFAULT_FILTERS)).resolves.toBeNull();
  });
});

describe("users loaders: role-permission reads degrade honestly", () => {
  it("derives role access from defaults when role_permissions errors", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "profiles") {
        return { data: [{ id: "owner-1", display_name: "Owner" }], error: null };
      }
      if (table === "role_permissions") {
        return { data: null, error: { message: "permission denied" } };
      }
      if (table === "user_permissions") return { data: [], error: null };
      return { data: [], error: null };
    };
    const staff = await getStaffMembers();
    expect(staff).not.toBeNull();
    expect(staff?.permissionsFromDefaults).toBe(true);
    expect(staff?.members).toHaveLength(1);
    expect(staff?.members[0]?.displayName).toBe("Owner");
    expect(staff?.members[0]?.permissions).toContain("users.manage");
    const matrix = await getRolePermissionMatrix();
    expect(matrix.fromDefaults).toBe(true);
    expect(matrix.grants.moderator).toContain("orders.read");
  });

  it("derives role access from defaults when role_permissions rejects", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: OWNER_ROLE, error: null };
      if (table === "role_permissions") return new Error("network down");
      return { data: [], error: null };
    };
    const staff = await getStaffMembers();
    expect(staff?.permissionsFromDefaults).toBe(true);
    const matrix = await getRolePermissionMatrix();
    expect(matrix.fromDefaults).toBe(true);
  });

  it("uses live role_permissions rows when the read succeeds", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") {
        return {
          data: [
            { user_id: "owner-1", role: "owner" },
            { user_id: "mod-1", role: "moderator" },
          ],
          error: null,
        };
      }
      if (table === "profiles") {
        return { data: [{ id: "mod-1", display_name: "Mod" }], error: null };
      }
      if (table === "role_permissions") {
        return {
          data: [
            { role: "moderator", permission: "orders.read" },
            { role: "moderator", permission: "customers.read" },
          ],
          error: null,
        };
      }
      if (table === "user_permissions") return { data: [], error: null };
      return { data: [], error: null };
    };
    const staff = await getStaffMembers();
    expect(staff?.permissionsFromDefaults).toBe(false);
    const moderator = staff?.members.find((m) => m.userId === "mod-1");
    expect(moderator?.permissions).toEqual(["orders.read", "customers.read"]);
    const matrix = await getRolePermissionMatrix();
    expect(matrix.fromDefaults).toBe(false);
    expect(matrix.grants.moderator).toEqual(["orders.read", "customers.read"]);
  });

  it("returns null when the loader's roles read fails", async () => {
    mocks.handler = (table, columns) => {
      // staffSession selects only "role"; the loader selects
      // "user_id, role". Let the session lookup succeed and fail the
      // loader's read.
      if (table === "user_roles" && columns === "role") {
        return { data: OWNER_ROLE, error: null };
      }
      if (table === "user_roles") {
        return { data: null, error: { message: "roles offline" } };
      }
      return { data: [], error: null };
    };
    await expect(getStaffMembers()).resolves.toBeNull();
  });
});

describe("order status vocabulary: exactly the 8 database statuses", () => {
  const EIGHT = [
    "pending",
    "confirmed",
    "packed",
    "shipped",
    "out-for-delivery",
    "delivered",
    "cancelled",
    "returned",
  ];

  it("pins ORDER_STATUSES to exactly the 8 database values, in order", () => {
    expect([...ORDER_STATUSES]).toEqual(EIGHT);
  });

  it("labels exactly the 8 statuses and never labels one Processing", () => {
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual([...EIGHT].sort());
    expect(Object.values(ORDER_STATUS_LABELS)).not.toContain("Processing");
    expect(ORDER_STATUS_LABELS.packed).toBe("Packed");
  });

  it("offers transitions only within the 8-value set", () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...EIGHT].sort());
    for (const targets of Object.values(ORDER_TRANSITIONS)) {
      for (const target of targets) {
        expect(EIGHT).toContain(target);
      }
    }
  });

  it("renders the packed timeline stage as Packed, never Processing", () => {
    const html = renderToStaticMarkup(
      createElement(OrderTimeline, {
        status: "packed",
        events: [
          {
            status: "packed",
            label: "Packed",
            at: "2026-10-21T10:00:00Z",
          },
        ],
      }),
    );
    expect(html).toContain("Packed");
    expect(html).not.toContain("Processing");
  });
});

describe("migration 015: role_permissions staff read", () => {
  it("grants SELECT to authenticated behind the users.manage policy only", async () => {
    const root = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
    );
    const sql = await readFile(
      join(
        root,
        "supabase",
        "migrations",
        "20261115001500_admin_role_permissions_staff_read.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("grant select on public.role_permissions to authenticated");
    expect(sql).toContain("role_permissions_staff_read");
    expect(sql).toContain("private.has_permission('users.manage')");
    expect(sql.toLowerCase()).not.toContain("grant insert");
    expect(sql.toLowerCase()).not.toContain("grant update");
    expect(sql.toLowerCase()).not.toContain("grant delete");
    expect(sql).toContain("grant select on public.role_permissions to authenticated");
    expect(/^begin;/m.test(sql)).toBe(true);
    expect(/^commit;/m.test(sql)).toBe(true);
  });
});
