import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Cost-exposure fix (migration 20261117000200 + loader switch):
 * the foundation table-level SELECT grant covered cost_price_minor
 * (added later), and row-level policies cannot filter columns, so an
 * anonymous direct PostgREST read returned costs for every published,
 * active variant, and any catalogue.read staff session read ALL
 * costs. The fix revokes the table-level grant, re-grants an
 * explicit 10-column list excluding the cost, and switches the only
 * two direct cost readers to the gated admin_variant_costs RPC
 * (costs.read + MFA). These tests pin the loader contracts and the
 * migration text. PostgreSQL grant/policy semantics are proven by
 * the local-Postgres harness, not by these tests.
 */

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

const mocks = vi.hoisted(() => ({
  handler: null as
    | null
    | ((table: string, columns: string) => QueryResult | Error),
  rpcHandler: null as
    | null
    | ((name: string, args: unknown) => QueryResult | Error),
  rpcCalls: [] as { name: string; args: unknown }[],
  selects: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/services/adapters/published-thrift", () => ({
  readPublishedFeed: async () => {
    throw new Error("feed reads are out of scope for cost-exposure tests");
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
        mocks.selects.push(`${table}:${selected}`);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      eq: () => builder,
      or: () => builder,
      in: () => builder,
      gte: () => builder,
      lt: () => builder,
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
          data: { user: { id: "staff-1", is_anonymous: false } },
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
      rpc: async (name: string, args: unknown) => {
        mocks.rpcCalls.push({ name, args });
        const handler = mocks.rpcHandler;
        if (!handler) throw new Error("No RPC handler set for this test");
        const result = handler(name, args);
        if (result instanceof Error) throw result;
        return result;
      },
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: { signedUrl: "https://signed.example/thumb" },
            error: null,
          }),
          remove: async () => ({ data: null, error: null }),
          upload: async () => ({
            data: { path: "staff-1/staged.jpg" },
            error: null,
          }),
        }),
      },
    }),
    adminConfiguration: () => null,
  };
});

import { readCatalogProduct } from "../src/lib/admin/catalog-products";
import { getAnalyticsReport } from "../src/lib/admin/analytics";
import { canViewProductCosts } from "../src/lib/admin/authorization";

const AT = "2026-11-15T10:00:00+00:00";
const uuid = (tail: string) => `22222222-2222-4222-8222-2222222222${tail}`;

const PRODUCT_ID = uuid("a1");
const CATEGORY_ID = uuid("c3");
const VARIANT_1_ID = uuid("d4");
const VARIANT_2_ID = uuid("d5");
const ORDER_ID = uuid("e6");

function rolesFor(role: string) {
  return [{ user_id: "staff-1", role }];
}

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: "Gulistan Shirt",
    slug: "gulistan-shirt",
    description: "A shirt.",
    status: "published",
    category_id: CATEGORY_ID,
    secondary_category_id: null,
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

/** Cost-less variant rows, as PostgREST returns them after the fix. */
function variantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VARIANT_1_ID,
    size: "M",
    color: "Blue",
    price_minor: 55000,
    sale_price_minor: null,
    active: true,
    created_at: AT,
    ...overrides,
  };
}

function inventoryRow(variantId: string) {
  return {
    variant_id: variantId,
    on_hand: 1,
    reserved: 0,
    available: 1,
    low_stock_threshold: 0,
  };
}

beforeEach(() => {
  mocks.rpcCalls = [];
  mocks.selects = [];
  mocks.rpcHandler = () => ({
    data: null,
    error: { message: "RPC unavailable in cost-exposure tests" },
  });
  mocks.handler = (table) => {
    if (table === "user_roles") return { data: rolesFor("owner"), error: null };
    return { data: [], error: null };
  };
});

describe("readCatalogProduct: costs via the gated RPC only", () => {
  it("never selects cost_price_minor from product_variants", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: rolesFor("owner"), error: null };
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") {
        return { data: [variantRow()], error: null };
      }
      return { data: [], error: null };
    };
    mocks.rpcHandler = () => ({ data: [], error: null });
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    const variantSelects = mocks.selects.filter((s) =>
      s.startsWith("product_variants:"),
    );
    expect(variantSelects).toHaveLength(1);
    expect(variantSelects[0]).not.toContain("cost_price_minor");
    expect(
      mocks.selects.every((s) => !s.includes("cost_price_minor")),
    ).toBe(true);
  });

  it("calls admin_variant_costs with the variant ids and merges costs by id", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: rolesFor("owner"), error: null };
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") {
        return {
          data: [
            variantRow(),
            variantRow({ id: VARIANT_2_ID, size: "L", color: "Red" }),
          ],
          error: null,
        };
      }
      if (table === "inventory") {
        return {
          data: [inventoryRow(VARIANT_1_ID), inventoryRow(VARIANT_2_ID)],
          error: null,
        };
      }
      if (table === "categories") return { data: { name: "Shirts" }, error: null };
      return { data: [], error: null };
    };
    // Deliberately out of order, with an unknown id and a null cost:
    // the merge must key on variant_id and ignore unknown rows.
    mocks.rpcHandler = (name) => {
      expect(name).toBe("admin_variant_costs");
      return {
        data: [
          { variant_id: VARIANT_2_ID, cost_price_minor: null },
          { variant_id: "99999999-9999-4999-8999-999999999999", cost_price_minor: 1 },
          { variant_id: VARIANT_1_ID, cost_price_minor: 40000 },
        ],
        error: null,
      };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(mocks.rpcCalls).toHaveLength(1);
    expect(mocks.rpcCalls[0]).toEqual({
      name: "admin_variant_costs",
      args: { p_variant_ids: [VARIANT_1_ID, VARIANT_2_ID] },
    });
    expect(read.detail.variants).toHaveLength(2);
    expect(read.detail.variants[0]?.cost_price_minor).toBe(40000);
    expect(read.detail.variants[1]?.cost_price_minor).toBeNull();
    expect(read.detail.variantsUnavailable).toBe(false);
  });

  it("degrades to read-only with null costs when the RPC errors, without throwing", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: rolesFor("owner"), error: null };
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") {
        return { data: [variantRow()], error: null };
      }
      return { data: [], error: null };
    };
    // Function-missing on a database where the cost migrations have
    // not applied yet surfaces as an RPC error, never a throw.
    mocks.rpcHandler = () => ({
      data: null,
      error: { message: "function public.admin_variant_costs does not exist" },
    });
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(read.detail.variants).toHaveLength(1);
    expect(read.detail.variants[0]?.cost_price_minor).toBeNull();
    // Read-only: blank costs must never be saved over stored costs.
    expect(read.detail.variantsUnavailable).toBe(true);
  });

  it("degrades to read-only with null costs when the RPC rejects, without throwing", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: rolesFor("owner"), error: null };
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") {
        return { data: [variantRow()], error: null };
      }
      return { data: [], error: null };
    };
    mocks.rpcHandler = () => new Error("connection reset");
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(read.detail.variants[0]?.cost_price_minor).toBeNull();
    expect(read.detail.variantsUnavailable).toBe(true);
  });

  it("never calls the RPC when there are no variants (empty-list guard)", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") return { data: rolesFor("owner"), error: null };
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") return { data: [], error: null };
      return { data: [], error: null };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(mocks.rpcCalls).toHaveLength(0);
    expect(read.detail.variants).toEqual([]);
    expect(read.detail.variantsUnavailable).toBe(false);
  });

  it("never calls the RPC for cost-blind roles and ignores any cost on the row", async () => {
    mocks.handler = (table) => {
      if (table === "user_roles") {
        return { data: rolesFor("moderator"), error: null };
      }
      if (table === "products") return { data: productRow(), error: null };
      if (table === "product_variants") {
        // A stale/direct cost value on the row must never be trusted:
        // the loader merges RPC costs only, behind the role gate.
        return {
          data: [variantRow({ cost_price_minor: 40000 })],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    const read = await readCatalogProduct(PRODUCT_ID);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(mocks.rpcCalls).toHaveLength(0);
    expect(read.detail.canViewCosts).toBe(false);
    expect(read.detail.variants[0]?.cost_price_minor).toBeNull();
    expect(read.detail.variantsUnavailable).toBe(false);
  });
});

describe("getAnalyticsReport: profit via the gated RPC only", () => {
  function analyticsHandler(role: string) {
    return (table: string, columns: string) => {
      if (table === "user_roles") return { data: rolesFor(role), error: null };
      if (table === "orders" && columns.startsWith("id, status")) {
        return {
          data: [
            {
              id: ORDER_ID,
              status: "delivered",
              subtotal_minor: 55000,
              discount_minor: 0,
              total_minor: 63000,
              phone: "01700000000",
              placed_at: "2026-11-16T10:00:00+06:00",
            },
          ],
          error: null,
        };
      }
      if (table === "order_items") {
        return {
          data: [
            {
              order_id: ORDER_ID,
              product_id: PRODUCT_ID,
              variant_id: VARIANT_1_ID,
              product_name: "Gulistan Shirt",
              unit_price_minor: 55000,
              quantity: 2,
              line_total_minor: 110000,
            },
          ],
          error: null,
        };
      }
      if (table === "products") {
        return { data: [{ id: PRODUCT_ID, category_id: null }], error: null };
      }
      return { data: [], error: null };
    };
  }

  it("computes profit from RPC costs and never selects the cost column", async () => {
    mocks.handler = analyticsHandler("owner");
    mocks.rpcHandler = (name, args) => {
      expect(name).toBe("admin_variant_costs");
      expect(args).toEqual({ p_variant_ids: [VARIANT_1_ID] });
      return {
        data: [{ variant_id: VARIANT_1_ID, cost_price_minor: 40000 }],
        error: null,
      };
    };
    const report = await getAnalyticsReport({ from: "2026-11-01", to: "2026-11-17" });
    expect(report.costsHidden).toBe(false);
    expect(report.profitAvailable).toBe(true);
    // (55000 - 40000) * 2 = 30000 profit; revenue is the line total.
    expect(report.profit).toEqual({
      profitMinor: 30000,
      revenueMinor: 110000,
      costMinor: 80000,
      itemsWithCost: 1,
      deliveredItems: 1,
    });
    expect(
      mocks.selects.every((s) => !s.includes("cost_price_minor")),
    ).toBe(true);
    expect(
      mocks.selects.some((s) => s.startsWith("product_variants:")),
    ).toBe(false);
  });

  it("leaves profit unavailable when the RPC errors, without throwing", async () => {
    mocks.handler = analyticsHandler("owner");
    mocks.rpcHandler = () => ({
      data: null,
      error: { message: "function public.admin_variant_costs does not exist" },
    });
    const report = await getAnalyticsReport({ from: "2026-11-01", to: "2026-11-17" });
    expect(report.costsHidden).toBe(false);
    expect(report.profitAvailable).toBe(false);
    expect(report.profit).toBeNull();
    expect(report.ordersAvailable).toBe(true);
  });

  it("never calls the RPC when costs are hidden", async () => {
    mocks.handler = analyticsHandler("moderator");
    const report = await getAnalyticsReport({ from: "2026-11-01", to: "2026-11-17" });
    expect(report.costsHidden).toBe(true);
    expect(mocks.rpcCalls).toHaveLength(0);
    expect(report.profitAvailable).toBe(false);
    expect(report.profit).toBeNull();
  });
});

describe("role gate unchanged", () => {
  it("keeps the role-only cost gate: owner/admin/product_manager only", () => {
    expect(canViewProductCosts({ roles: ["owner"] })).toBe(true);
    expect(canViewProductCosts({ roles: ["admin"] })).toBe(true);
    expect(canViewProductCosts({ roles: ["product_manager"] })).toBe(true);
    expect(canViewProductCosts({ roles: ["moderator"] })).toBe(false);
    expect(canViewProductCosts({ roles: ["editor"] })).toBe(false);
    expect(canViewProductCosts({ roles: ["analyst"] })).toBe(false);
    expect(canViewProductCosts({ roles: ["order_manager"] })).toBe(false);
    expect(canViewProductCosts({ roles: [] })).toBe(false);
  });

  it("does not gate either loader on admin_can_view_product_costs", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const catalog = readFileSync(
      join(root, "src/lib/admin/catalog-products.ts"),
      "utf8",
    );
    const analytics = readFileSync(
      join(root, "src/lib/admin/analytics.ts"),
      "utf8",
    );
    expect(catalog).not.toContain("admin_can_view_product_costs");
    expect(analytics).not.toContain("admin_can_view_product_costs");
    // The RPC is the data source only, behind the existing role gate.
    expect(catalog).toContain('rpc("admin_variant_costs"');
    expect(analytics).toContain('rpc("admin_variant_costs"');
    expect(catalog).toContain("p_variant_ids");
    expect(analytics).toContain("p_variant_ids");
  });
});

describe("loader source pins", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");

  it("detail loader: no direct cost select, RPC merge with empty-list and cap guards", () => {
    const source = readFileSync(
      join(root, "src/lib/admin/catalog-products.ts"),
      "utf8",
    );
    // The variant select list must not name the cost column.
    const selectMatch = source.match(/const variantColumns =\s*"([^"]+)"/);
    expect(selectMatch).not.toBeNull();
    expect(selectMatch![1]).not.toContain("cost_price_minor");
    // Empty-list guard + 500 cap guard the RPC call.
    expect(source).toContain("canViewCosts && variantRows.length > 0");
    expect(source).toContain("slice(0, 500)");
    // The defense-in-depth strip is preserved.
    expect(source).toContain("cost_price_minor: canViewCosts");
    expect(source).toContain("costsByVariant.get(v.id) ?? null");
  });

  it("analytics loader: no product_variants table read at all, RPC capped at 200", () => {
    const source = readFileSync(
      join(root, "src/lib/admin/analytics.ts"),
      "utf8",
    );
    expect(source).not.toContain('from("product_variants")');
    expect(source).toContain("variantIds.slice(0, 200)");
    expect(source).toContain("variant.variant_id");
  });
});

describe("migration 20261117000200 text", () => {
  const repoRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  const migrationPath = join(
    repoRoot,
    "supabase/migrations/20261117000200_product_variant_cost_read_fix.sql",
  );
  const sql = readFileSync(migrationPath, "utf8");

  it("is followed only by migrations that do not re-open variant cost reads", () => {
    const files = readdirSync(join(repoRoot, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files).toHaveLength(49); // +3: 20261119000600 blocked-phone enforcement, 20261119000700 abandoned-checkout sweep, 20261119000800 redirect resolution.
    const fixIndex = files.indexOf("20261117000200_product_variant_cost_read_fix.sql");
    expect(fixIndex).toBeGreaterThan(-1);
    // Later migrations may call orderable_variant (the cost-safe reader) but
    // must never re-grant the table or redefine the reader.
    for (const later of files.slice(fixIndex + 1)) {
      const laterSql = readFileSync(join(repoRoot, "supabase/migrations", later), "utf8");
      expect(laterSql).not.toMatch(/grant\s+[^;]*on\s+public\.product_variants/i);
      expect(laterSql).not.toMatch(/create\s+(or\s+replace\s+)?function\s+private\.orderable_variant/i);
    }
  });

  it("revokes the table-level grant and re-grants exactly the 10 non-cost columns", () => {
    expect(sql).toContain(
      "revoke select on public.product_variants from anon, authenticated;",
    );
    const grantMatch = sql.match(
      /grant select \(([^)]+)\)\s+on public\.product_variants to anon, authenticated;/,
    );
    expect(grantMatch).not.toBeNull();
    const columns = grantMatch![1]!.split(",").map((c) => c.trim());
    expect(columns).toEqual([
      "id",
      "product_id",
      "sku",
      "size",
      "color",
      "price_minor",
      "sale_price_minor",
      "active",
      "created_at",
      "updated_at",
    ]);
    expect(columns).not.toContain("cost_price_minor");
    // No column-only revoke anywhere: that shape is a proven no-op.
    expect(sql).not.toMatch(/revoke select \(cost_price_minor\)/);
  });

  it("touches no policy, no trigger, and no other table's grants", () => {
    expect(sql).not.toMatch(/create policy|drop policy|alter policy/i);
    expect(sql).not.toMatch(/create trigger|drop trigger/i);
    expect(sql).not.toMatch(
      /create (or replace )?function private\.has_permission/,
    );
    const grantLines = sql
      .split("\n")
      .filter((line) => /^\s*(revoke|grant)\s/i.test(line));
    // Table grant pair + function revoke/grant pair only.
    expect(grantLines).toHaveLength(4);
  });

  it("replaces only the audit capture in admin_save_product_variant", () => {
    expect(sql).not.toContain("to_jsonb(previous)");
    expect(sql).toContain(
      "create or replace function public.admin_save_product_variant(target_id uuid,expected_updated_at timestamptz,target_variant uuid,variant jsonb)",
    );
    expect(sql).toContain(
      "returns timestamptz language plpgsql security definer set search_path=''",
    );
    // Explicit cost-free field list in the audit capture.
    expect(sql).toContain("'before',jsonb_build_object('id',previous.id");
    expect(sql).toContain("'price_minor',previous.price_minor");
    expect(sql).toContain("'updated_at',previous.updated_at");
    // The audit-capture object names no cost field.
    const beforeMatch = sql.match(/'before',jsonb_build_object\((.*?)\)\)/);
    expect(beforeMatch).not.toBeNull();
    expect(beforeMatch![1]).not.toContain("cost");
    // Signature, draft guard, validation, and grants preserved.
    expect(sql).toContain("perform private.require_admin('catalogue.manage');");
    expect(sql).toContain("Edit SKUs on a draft only");
    expect(sql).toContain(
      "revoke all on function public.admin_save_product_variant(uuid,timestamptz,uuid,jsonb) from public,anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.admin_save_product_variant(uuid,timestamptz,uuid,jsonb) to authenticated;",
    );
  });

  it("carries the header discipline: S6 parse-check, drift check, never-apply-blind, ordering", () => {
    expect(sql).toContain("S6 PARSE-CHECK REQUIRED");
    expect(sql).toContain("NEVER apply blind");
    expect(sql).toContain("DRIFT CHECK");
    expect(sql).toContain("20261115000200");
    expect(sql).toContain("20261115001000");
    expect(sql).toContain("AFTER files 21 and 29");
    expect(sql).toContain("FAIL-CLOSED RULE");
    // No history INSERT in the file: the operator run records it.
    expect(sql).not.toContain("insert into supabase_migrations");
    expect(sql).toContain("comment on table public.product_variants");
    expect(sql).toContain("comment on column public.product_variants.cost_price_minor");
  });

  it("does not alter the cost RPC, the trigger function, or any other function", () => {
    const createFunctions = sql.match(/create or replace function [^(]+/g) ?? [];
    expect(createFunctions).toHaveLength(1);
    expect(createFunctions[0]).toContain("admin_save_product_variant");
    expect(sql).not.toContain("create function public.admin_variant_costs");
    expect(sql).not.toContain(
      "create or replace function public.admin_variant_costs",
    );
    expect(sql).not.toContain("create function private.enforce_cost_permission");
    expect(sql).not.toContain(
      "create or replace function private.enforce_cost_permission",
    );
  });
});
