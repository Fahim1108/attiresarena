'use server';

/**
 * Inventory: server reads + Server Actions for /admin/catalog/inventory.
 *
 * Adjustments go through the EXISTING public.adjust_inventory RPC
 * (foundation migration), which enforces the 'inventory.adjust'
 * permission, the reserved-stock floor (on_hand can never drop below
 * reserved, so stock can never go negative) and writes an
 * inventory_movements row with the acting user. MFA (AAL2) is enforced
 * by staffSession/requireStaff before the RPC is reached. No new
 * adjustment RPC is introduced here.
 *
 * CONTRACT WITH THE ORDERS MODULE: order-driven stock effects are NOT
 * implemented here. Delivered -> available 0 for the sold units and
 * cancel/return stock restoration belong to the ORDERS module's order
 * transition RPC, which owns order_items, reserved quantities and the
 * transition guard. This module only offers manual, reasoned adjustments
 * and read-only movement history. Do not add order-transition stock logic
 * to this file.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffSession } from "./access";
import {
  actionError,
  actionOk,
  requireStaff,
  type AdminActionResult,
} from "./authorization";
import { areaRoles, DEFAULT_PAGE_SIZE } from "./constants";

/** Upper bound on variant rows scanned for one inventory request. */
const INVENTORY_FETCH_CAP = 1000;

function toOne<T extends z.ZodType>(schema: T) {
  return z
    .union([schema, z.array(schema).max(1)])
    .nullable()
    .optional()
    .transform(
      (v) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as z.infer<T> | null,
    );
}

const inventoryRowSchema = z.object({
  id: z.uuid(),
  product_id: z.uuid(),
  size: z.string(),
  color: z.string(),
  price_minor: z.number().int().nonnegative(),
  sale_price_minor: z.number().int().nonnegative().nullable(),
  active: z.boolean(),
  products: toOne(
    z.object({
      name: z.string(),
      slug: z.string(),
      status: z.enum(["draft", "published", "archived"]),
    }),
  ),
  inventory: toOne(
    z.object({
      on_hand: z.number().int().nonnegative(),
      reserved: z.number().int().nonnegative(),
      available: z.number().int().nonnegative(),
      low_stock_threshold: z.number().int().nonnegative(),
    }),
  ),
});

export interface InventoryRow {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  productStatus: "draft" | "published" | "archived";
  size: string;
  color: string;
  active: boolean;
  onHand: number | null;
  reserved: number | null;
  available: number | null;
  lowStockThreshold: number | null;
  stockState: "in-stock" | "low-stock" | "out-of-stock" | "no-record";
}

export interface InventoryOverview {
  productCount: number;
  variantCount: number;
  totalAvailable: number;
  totalOnHand: number;
  totalReserved: number;
  lowStockCount: number;
  outOfStockCount: number;
  truncated: boolean;
}

export interface InventoryPageResult {
  rows: InventoryRow[];
  overview: InventoryOverview;
  total: number;
  totalPages: number;
  page: number;
  canAdjust: boolean;
}

export interface InventoryFilters {
  q: string;
  stock: "" | "in-stock" | "low-stock" | "out-of-stock";
  page: number;
  /** Narrow to one variant (dashboard low-stock deep links use ?variant=<uuid>). */
  variantId?: string;
}

function classifyRow(
  inventory: { available: number; low_stock_threshold: number } | null,
): InventoryRow["stockState"] {
  if (inventory === null) return "no-record";
  if (inventory.available <= 0) return "out-of-stock";
  if (inventory.available <= inventory.low_stock_threshold) return "low-stock";
  return "in-stock";
}

export async function readInventory(
  filters: InventoryFilters,
): Promise<InventoryPageResult> {
  const session = await requireStaff(areaRoles("inventory"));
  const canAdjust = session.roles.some(
    (r) => r === "owner" || r === "product_manager",
  );
  const result = await session.client
    .from("product_variants")
    .select(
      "id,product_id,size,color,price_minor,sale_price_minor,active," +
        "products(name,slug,status)," +
        "inventory(on_hand,reserved,available,low_stock_threshold)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(INVENTORY_FETCH_CAP);
  if (result.error) {
    throw new Error("Inventory could not be read. No changes were made.");
  }
  const parsed = z.array(inventoryRowSchema).parse(result.data ?? []);
  const truncated = (result.count ?? 0) > INVENTORY_FETCH_CAP;
  const productIds = new Set<string>();
  let totalAvailable = 0;
  let totalOnHand = 0;
  let totalReserved = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  const allRows: InventoryRow[] = parsed.map((row) => {
    productIds.add(row.product_id);
    const inv = row.inventory;
    const stockState = classifyRow(
      inv
        ? {
            available: inv.available,
            low_stock_threshold: inv.low_stock_threshold,
          }
        : null,
    );
    if (inv) {
      totalAvailable += inv.available;
      totalOnHand += inv.on_hand;
      totalReserved += inv.reserved;
      if (stockState === "low-stock") lowStockCount += 1;
      if (stockState === "out-of-stock") outOfStockCount += 1;
    }
    return {
      variantId: row.id,
      productId: row.product_id,
      productName: row.products?.name ?? "Unknown product",
      productSlug: row.products?.slug ?? "",
      productStatus: row.products?.status ?? "archived",
      size: row.size,
      color: row.color,
      active: row.active,
      onHand: inv?.on_hand ?? null,
      reserved: inv?.reserved ?? null,
      available: inv?.available ?? null,
      lowStockThreshold: inv?.low_stock_threshold ?? null,
      stockState,
    };
  });
  const q = filters.q.trim().toLowerCase();
  const filtered = allRows.filter((row) => {
    if (filters.variantId && row.variantId !== filters.variantId) return false;
    if (filters.stock && row.stockState !== filters.stock) return false;
    if (!q) return true;
    return (
      row.productName.toLowerCase().includes(q) ||
      row.size.toLowerCase().includes(q) ||
      row.color.toLowerCase().includes(q)
    );
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  return {
    rows: filtered.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE),
    overview: {
      productCount: productIds.size,
      variantCount: parsed.length,
      totalAvailable,
      totalOnHand,
      totalReserved,
      lowStockCount,
      outOfStockCount,
      truncated,
    },
    total,
    totalPages,
    page,
    canAdjust,
  };
}

export interface VariantOption {
  variantId: string;
  label: string;
  onHand: number | null;
  available: number | null;
}

/** Variant choices for the adjustment form (newest first, capped). */
export async function readVariantOptions(): Promise<VariantOption[]> {
  const session = await staffSession();
  const result = await session.client
    .from("product_variants")
    .select(
      "id,size,color,products(name),inventory(on_hand,available)",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(500);
  if (result.error) throw new Error("Variants could not be read.");
  const schema = z.object({
    id: z.uuid(),
    size: z.string(),
    color: z.string(),
    products: toOne(z.object({ name: z.string() })),
    inventory: toOne(
      z.object({
        on_hand: z.number().int().nonnegative(),
        available: z.number().int().nonnegative(),
      }),
    ),
  });
  return z
    .array(schema)
    .parse(result.data ?? [])
    .map((row) => ({
      variantId: row.id,
      label: `${row.products?.name ?? "Unknown product"} — ${row.size} / ${row.color}`,
      onHand: row.inventory?.on_hand ?? null,
      available: row.inventory?.available ?? null,
    }));
}

const movementRowSchema = z.object({
  id: z.uuid(),
  variant_id: z.uuid(),
  actor_id: z.uuid().nullable(),
  delta: z.number().int(),
  on_hand_after: z.number().int().nonnegative(),
  reason: z.string(),
  created_at: z.iso.datetime({ offset: true }),
});

export interface MovementRow {
  id: string;
  variantId: string;
  variantLabel: string;
  actorId: string | null;
  delta: number;
  onHandAfter: number;
  reason: string;
  createdAt: string;
}

export async function readMovementHistory(
  page: number,
): Promise<{
  rows: MovementRow[];
  total: number;
  totalPages: number;
  page: number;
}> {
  const session = await requireStaff(areaRoles("inventory"));
  const safePage = Number.isFinite(page) && page >= 1 ? page : 1;
  const result = await session.client
    .from("inventory_movements")
    .select("id,variant_id,actor_id,delta,on_hand_after,reason,created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range((safePage - 1) * DEFAULT_PAGE_SIZE, safePage * DEFAULT_PAGE_SIZE - 1);
  if (result.error) {
    throw new Error("Movement history could not be read.");
  }
  const movements = z.array(movementRowSchema).parse(result.data ?? []);
  const variantIds = [...new Set(movements.map((m) => m.variant_id))];
  const labels = new Map<string, string>();
  if (variantIds.length > 0) {
    const variants = await session.client
      .from("product_variants")
      .select("id,size,color,products(name)")
      .in("id", variantIds);
    if (!variants.error) {
      const schema = z.object({
        id: z.uuid(),
        size: z.string(),
        color: z.string(),
        products: toOne(z.object({ name: z.string() })),
      });
      for (const row of z.array(schema).parse(variants.data ?? [])) {
        labels.set(
          row.id,
          `${row.products?.name ?? "Unknown product"} — ${row.size} / ${row.color}`,
        );
      }
    }
  }
  const total = result.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  return {
    rows: movements.map((m) => ({
      id: m.id,
      variantId: m.variant_id,
      variantLabel: labels.get(m.variant_id) ?? "Unknown variant",
      actorId: m.actor_id,
      delta: m.delta,
      onHandAfter: m.on_hand_after,
      reason: m.reason,
      createdAt: m.created_at,
    })),
    total,
    totalPages,
    page: Math.min(safePage, totalPages),
  };
}

// -------------------------------------------------------------------- actions

const adjustSchema = z.object({
  variant_id: z.uuid(),
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0, "Enter a non-zero quantity change.")
    .refine((v) => Math.abs(v) <= 999999, "Quantity change is too large."),
  reason: z
    .string()
    .trim()
    .min(3, "Enter a reason of 3–500 characters.")
    .max(500, "Enter a reason of 3–500 characters."),
});

export async function adjustInventory(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("inventory"));
  const variantRaw = form.get("variant_id");
  const deltaRaw = form.get("delta");
  const reasonRaw = form.get("reason");
  const parsed = adjustSchema.safeParse({
    variant_id: typeof variantRaw === "string" ? variantRaw : "",
    delta:
      typeof deltaRaw === "string" && /^-?\d{1,9}$/.test(deltaRaw.trim())
        ? Number.parseInt(deltaRaw.trim(), 10)
        : Number.NaN,
    reason: typeof reasonRaw === "string" ? reasonRaw : "",
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(
      first?.message ?? "Enter a variant, a non-zero quantity and a reason.",
    );
  }
  const result = await session.client.rpc("adjust_inventory", {
    target_variant: parsed.data.variant_id,
    quantity_delta: parsed.data.delta,
    adjustment_reason: parsed.data.reason.trim(),
  });
  if (result.error) {
    const message =
      result.error.message && result.error.message.length <= 300
        ? result.error.message
        : "Adjustment could not be saved.";
    if (/insufficient|missing/i.test(message)) {
      return actionError(
        "Not enough unreserved stock for that decrease. Check the available quantity and try again.",
      );
    }
    return actionError(message);
  }
  revalidatePath("/admin/catalog/inventory");
  revalidatePath("/admin/catalog/products");
  return actionOk(
    `Stock ${parsed.data.delta > 0 ? "increased" : "decreased"} by ${Math.abs(parsed.data.delta)}.`,
  );
}
