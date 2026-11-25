import "server-only";
import { z } from "zod";
import type { CheckoutRpc } from "@/lib/checkout/service";
import {
  CUSTOMER_ORDER_MEDIA_RPC,
  customerOrderItemRowSchema,
  customerOrderRowSchema,
  mergeOrderMedia,
  normalizeTrackingPhone,
  projectCustomerOrder,
  projectOrderMediaRows,
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

const trackedOrderPayloadSchema = z.object({
  order: customerOrderRowSchema,
  items: z.array(customerOrderItemRowSchema),
});

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
  // Client feedback item 14: resolve the ordered product's actual
  // photo even when it left the published feed, through the same
  // customer_order_media RPC (migration 20261124000200) the signed-in
  // read uses — the server credential is the server role, and the phone
  // was already verified above, so the RPC's ownership check passes.
  // A failed media call (including the pre-migration missing RPC)
  // keeps the feed map: the line falls back to the logo, as today.
  const missing = [
    ...new Set(parsed.data.items.map((item) => item.product_id)),
  ].filter((id) => !media.has(id));
  let mediaWithFallback = media;
  if (missing.length > 0) {
    const mediaResult = await rpc<unknown>(CUSTOMER_ORDER_MEDIA_RPC, {
      p_order_ids: [parsed.data.order.id],
    });
    if (mediaResult.ok) {
      const resolved = projectOrderMediaRows(mediaResult.data);
      for (const id of [...resolved.keys()]) {
        if (!missing.includes(id)) resolved.delete(id);
      }
      mediaWithFallback = mergeOrderMedia(media, resolved);
    } else {
      logTrackingFailure(`order-media:${mediaResult.code}`);
    }
  }
  return projectCustomerOrder(parsed.data.order, parsed.data.items, mediaWithFallback);
}
