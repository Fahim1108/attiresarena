import { z } from "zod";
import type {
  Order,
  OrderStatus,
  OrderTimelineEvent,
  Product,
  ProductImage,
} from "@/types";
import type { CustomerClient } from "./supabase";
import { customerPhoneSchema } from "./validation";

/**
 * Customer order reads + projection. Own-row RLS (`orders_own_read`,
 * `order_items_own_read`) applies through the customer client; every
 * query also filters explicitly by user_id so a policy regression
 * fails closed rather than leaking.
 *
 * Row schemas are local copies of the admin read shapes — customer
 * code never imports admin modules. The SKU column is never selected
 * and cost fields never reach the UI. Courier columns are never
 * selected: shipment records live in the staff-only order_shipments
 * table (unapplied migration 20261116000200), so `courier` stays
 * undefined here.
 */

/** The fixed 8 database order statuses. */
export const CUSTOMER_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "out-for-delivery",
  "delivered",
  "cancelled",
  "returned",
] as const;

export const CUSTOMER_ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  packed: "Packed",
  shipped: "Shipped",
  "out-for-delivery": "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
};

export const customerOrderRowSchema = z.object({
  id: z.uuid(),
  order_number: z.number().int().nullable(),
  customer_name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  division: z.string(),
  district: z.string(),
  area: z.string(),
  address_line: z.string(),
  payment_method: z.enum(["cod", "online"]),
  payment_status: z.enum(["unpaid", "paid", "refunded"]),
  status: z.enum(CUSTOMER_ORDER_STATUSES),
  subtotal_minor: z.number().int(),
  delivery_charge_minor: z.number().int(),
  discount_minor: z.number().int(),
  total_minor: z.number().int(),
  placed_at: z.iso.datetime({ offset: true }),
});

export type CustomerOrderRow = z.infer<typeof customerOrderRowSchema>;

export const customerOrderItemRowSchema = z.object({
  id: z.uuid(),
  order_id: z.uuid(),
  product_id: z.uuid(),
  variant_id: z.uuid(),
  product_name: z.string(),
  size: z.string(),
  color: z.string(),
  unit_price_minor: z.number().int(),
  quantity: z.number().int(),
  line_total_minor: z.number().int(),
  created_at: z.iso.datetime({ offset: true }),
});

export type CustomerOrderItemRow = z.infer<typeof customerOrderItemRowSchema>;

/** Snapshot columns only. The SKU column is never selected. */
export const CUSTOMER_ORDER_COLUMNS =
  "id,order_number,customer_name,phone,email,division,district,area,address_line,payment_method,payment_status,status,subtotal_minor,delivery_charge_minor,discount_minor,total_minor,placed_at";
export const CUSTOMER_ORDER_ITEM_COLUMNS =
  "id,order_id,product_id,variant_id,product_name,size,color,unit_price_minor,quantity,line_total_minor,created_at";

/** Newest-first history cap: unbounded history reads are a cost/DoS vector. */
export const CUSTOMER_ORDER_LIMIT = 50;
const CUSTOMER_ORDER_ITEM_LIMIT = 500;

/** Product media resolved from the public storefront feed (slug + cover image). */
export interface CustomerOrderMedia {
  slug: string;
  image: ProductImage;
}

/**
 * Build the product-id -> media map from live feed products. Products
 * that have since unpublished are absent; their lines use the neutral
 * fallback image and an empty slug (no invented product data).
 */
export function orderMediaMap(
  products: Product[],
): Map<string, CustomerOrderMedia> {
  const map = new Map<string, CustomerOrderMedia>();
  for (const product of products) {
    const image = product.defaultImages[0];
    if (image) map.set(product.id, { slug: product.slug, image });
  }
  return map;
}

/** Neutral fallback for a line whose product photo is no longer published. */
export const ORDER_LINE_FALLBACK_IMAGE: ProductImage = {
  src: "/brand/logo-maroon.png",
  alt: "",
};

/**
 * Project one order row + its item rows into the storefront Order type.
 * Returns null when the row fails validation or has no order number
 * (unroutable, undisplayable). Item rows are validated per-row: one bad
 * line is skipped, the rest still render. Money is minor -> major.
 * The timeline is derived from the current status + placedAt ONLY: no
 * other timestamp exists for customers, so none is invented.
 */
export function projectCustomerOrder(
  row: unknown,
  items: unknown[],
  media: Map<string, CustomerOrderMedia>,
): Order | null {
  const parsed = customerOrderRowSchema.safeParse(row);
  if (!parsed.success || parsed.data.order_number === null) return null;
  const order = parsed.data;
  const lines: Order["lines"] = [];
  for (const raw of items) {
    const item = customerOrderItemRowSchema.safeParse(raw);
    if (!item.success || item.data.order_id !== order.id) continue;
    const resolved = media.get(item.data.product_id);
    lines.push({
      productId: item.data.product_id,
      productSlug: resolved?.slug ?? "",
      name: item.data.product_name,
      image: resolved?.image ?? {
        ...ORDER_LINE_FALLBACK_IMAGE,
        alt: item.data.product_name,
      },
      colorName: item.data.color,
      size: item.data.size,
      quantity: item.data.quantity,
      unitPrice: item.data.unit_price_minor / 100,
    });
  }
  const timeline: OrderTimelineEvent[] = [
    { status: "pending", label: "Pending", at: order.placed_at },
  ];
  if (order.status !== "pending") {
    timeline.push({
      status: order.status,
      label: CUSTOMER_ORDER_STATUS_LABELS[order.status],
    });
  }
  return {
    id: order.id,
    orderNumber: String(order.order_number),
    placedAt: order.placed_at,
    status: order.status,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    lines,
    summary: {
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      subtotal: order.subtotal_minor / 100,
      discount: order.discount_minor / 100,
      deliveryCharge: order.delivery_charge_minor / 100,
      total: order.total_minor / 100,
    },
    shippingAddress: {
      label: "",
      fullName: order.customer_name,
      phone: order.phone,
      division: order.division,
      district: order.district,
      area: order.area,
      addressLine: order.address_line,
    },
    timeline,
  };
}

/**
 * Parse a user-supplied order number: exactly 5 digits in the
 * database range. The AA- prefix from confirmation messages is
 * accepted (either case, hyphen optional) and stripped; surrounding
 * whitespace is ignored. Anything else yields null.
 */
export function parseCustomerOrderNumber(value: string): number | null {
  const match = /^(?:aa-?)?(\d{5})$/i.exec(value.trim());
  if (!match?.[1]) return null;
  const number = Number(match[1]);
  return number >= 10000 && number <= 99999 ? number : null;
}

/**
 * Normalise a user-supplied phone to the strict stored form
 * (01[3-9]XXXXXXXX) for guest tracking, or null when it cannot be
 * one. Same rule as customerPhoneSchema — spaces/dashes stripped,
 * a +88/88 prefix removed — so the app and the database function
 * (private.normalize_bd_phone, migration 20261119000500) agree on
 * what counts as the same number. A null here never reaches the
 * database: the lookup fails closed as "not found".
 */
export function normalizeTrackingPhone(value: string): string | null {
  const parsed = customerPhoneSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function logOrderReadFailure(reason: string): void {
  console.error(`[attiresarena:customer-orders] order read failed: ${reason}`);
}

async function readOrderItems(
  client: CustomerClient,
  orderIds: string[],
): Promise<unknown[] | null> {
  if (orderIds.length === 0) return [];
  const result = await client
    .from("order_items")
    .select(CUSTOMER_ORDER_ITEM_COLUMNS)
    .in("order_id", orderIds)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(CUSTOMER_ORDER_ITEM_LIMIT);
  if (result.error) {
    logOrderReadFailure("order_items");
    return null;
  }
  return Array.isArray(result.data) ? result.data : [];
}

/** Newest-first own orders, capped. Read failures yield [] (fail closed). */
export async function readCustomerOrders(
  client: CustomerClient,
  userId: string,
  media: Map<string, CustomerOrderMedia>,
): Promise<Order[]> {
  const result = await client
    .from("orders")
    .select(CUSTOMER_ORDER_COLUMNS)
    .eq("user_id", userId)
    .order("placed_at", { ascending: false })
    .limit(CUSTOMER_ORDER_LIMIT);
  if (result.error || !Array.isArray(result.data)) {
    logOrderReadFailure("orders");
    return [];
  }
  const rows: CustomerOrderRow[] = [];
  for (const raw of result.data) {
    const parsed = customerOrderRowSchema.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
  }
  const items = await readOrderItems(
    client,
    rows.map((row) => row.id),
  );
  if (items === null) return [];
  const orders: Order[] = [];
  for (const row of rows) {
    const projected = projectCustomerOrder(row, items, media);
    if (projected) orders.push(projected);
  }
  return orders;
}

/** One own order by number, or null (unknown number, bad row, or read failure). */
export async function readCustomerOrderByNumber(
  client: CustomerClient,
  userId: string,
  orderNumber: number,
  media: Map<string, CustomerOrderMedia>,
): Promise<Order | null> {
  const result = await client
    .from("orders")
    .select(CUSTOMER_ORDER_COLUMNS)
    .eq("user_id", userId)
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (result.error || !result.data) return null;
  const parsed = customerOrderRowSchema.safeParse(result.data);
  if (!parsed.success) return null;
  const items = await readOrderItems(client, [parsed.data.id]);
  if (items === null) return null;
  return projectCustomerOrder(parsed.data, items, media);
}
