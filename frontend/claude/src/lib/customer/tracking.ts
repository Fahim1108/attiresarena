import "server-only";
import { z } from "zod";
import type { CheckoutRpc } from "@/lib/checkout/service";
import type { Order } from "@/types";
import {
  customerOrderItemRowSchema,
  customerOrderRowSchema,
  normalizeTrackingPhone,
  projectCustomerOrder,
  type CustomerOrderMedia,
} from "./orders";

/**
 * Guest order lookup through the server-only tracking function
 * (public.customer_track_order_by_phone, migration
 * 20261119000500). The function is granted to the server role only, so
 * it is never callable from a browser; only the server action path
 * reaches it, with the trusted server credential (see
 * trackingRpcConfiguration in lib/checkout/config.ts).
 *
 * The phone is the second factor: an order number alone is guessable,
 * so a lookup without a phone that normalises to the strict stored
 * form never reaches the database. A miss, a wrong phone, and a
 * failed call all yield null — the page shows the same "Order not
 * found" state for each, so it never reveals which part was wrong.
 * The payload is validated against the same row schemas as the
 * signed-in order read, and projected through the same function, so
 * guest results carry exactly the same fields (no note, no user id,
 * no SKU, no courier data).
 */

/** PostgREST name of the guest-tracking function. */
export const CUSTOMER_TRACK_ORDER_RPC = "customer_track_order_by_phone";

/** PostgREST name of the guest-tracking list function (all orders for one phone). */
export const CUSTOMER_TRACK_ORDERS_RPC = "customer_track_orders_by_phone";

const trackedOrderPayloadSchema = z.object({
  order: customerOrderRowSchema,
  items: z.array(customerOrderItemRowSchema),
});

const trackedOrdersPayloadSchema = z.array(trackedOrderPayloadSchema);

function logTrackingFailure(reason: string): void {
  console.error(`[attiresarena:customer-tracking] guest lookup failed: ${reason}`);
}

/**
 * Look one order up by number + already-normalised phone. The phone
 * must already be the strict stored form (see
 * normalizeTrackingPhone); anything else returns null without a
 * database call. The rpc transport is injected so tests can pass a
 * stub instead of the live server credential.
 */
export async function trackGuestOrderByPhone(
  rpc: CheckoutRpc,
  orderNumber: number,
  phone: string,
  media: Map<string, CustomerOrderMedia>,
) {
  if (phone !== normalizeTrackingPhone(phone)) return null;
  const result = await rpc<unknown>(CUSTOMER_TRACK_ORDER_RPC, {
    p_order_number: orderNumber,
    p_phone: phone,
  });
  if (!result.ok) {
    logTrackingFailure(result.code);
    return null;
  }
  if (result.data === null) return null;
  const parsed = trackedOrderPayloadSchema.safeParse(result.data);
  if (!parsed.success) {
    logTrackingFailure("invalid-payload");
    return null;
  }
  return projectCustomerOrder(parsed.data.order, parsed.data.items, media);
}

/**
 * List every order placed with one already-normalised phone, newest
 * first. Same guarantees as trackGuestOrderByPhone: the phone must
 * already be the strict stored form (see normalizeTrackingPhone);
 * anything else returns [] without a database call, and a miss, a
 * failed call, or a malformed payload all yield [] — the page shows
 * the same "No orders found" state for each. The rpc transport is
 * injected so tests can pass a stub instead of the live server
 * credential.
 */
export async function trackGuestOrdersByPhone(
  rpc: CheckoutRpc,
  phone: string,
  media: Map<string, CustomerOrderMedia>,
): Promise<Order[]> {
  if (phone !== normalizeTrackingPhone(phone)) return [];
  const result = await rpc<unknown>(CUSTOMER_TRACK_ORDERS_RPC, {
    p_phone: phone,
  });
  if (!result.ok) {
    logTrackingFailure(result.code);
    return [];
  }
  if (result.data === null) return [];
  const parsed = trackedOrdersPayloadSchema.safeParse(result.data);
  if (!parsed.success) {
    logTrackingFailure("invalid-payload");
    return [];
  }
  const orders: Order[] = [];
  for (const entry of parsed.data) {
    const projected = projectCustomerOrder(entry.order, entry.items, media);
    if (projected) orders.push(projected);
  }
  return orders;
}
