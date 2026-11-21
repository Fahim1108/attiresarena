import type { ActionResult } from "@/types";
import { COUPON_CODE_PATTERN, isCouponReason, normalizeCouponCode, type CouponReason } from "./coupons";
import { parseCheckoutOrder, parseCheckoutProgress, type CheckoutProgressInput } from "./validation";

/**
 * Checkout orchestration, independent of Next.js so it can be tested directly.
 * Browser -> server action -> HttpOnly cookie (raw token) -> database function (hashes it).
 * The raw token is never returned to the browser and never logged. Every rule that matters
 * (rate limits, idempotency, eligibility, stock) is enforced in the database; this layer only
 * shapes requests and maps refusals to guest-facing messages.
 */
export type RpcResult<T> = { ok: true; data: T } | { ok: false; code: string };
export type CheckoutRpc = <T>(name: string, args: Record<string, unknown>) => Promise<RpcResult<T>>;
export interface CheckoutCookieJar {
  get(): string | undefined;
  set(token: string, expires?: Date): void;
  clear(): void;
}
export type PlacedOrder = { orderNumber: string; total: number };

/** What the order-placed notification hook receives: the fresh order only. */
export type PlacedOrderNotification = { orderNumber: string; total: number };

type OrderRow = {
  order_number: number;
  total_minor: number;
  placed_at: string;
  already_placed: boolean;
  items: { variant_id: string; quantity: number }[] | null;
};
type Failure = Extract<ActionResult<never>, { ok: false }>;

const TOKEN = /^[0-9a-f]{64}$/;
const CLIENT_KEY = /^[0-9a-f]{64}$/;
const notConnected: Failure = { ok: false, reason: "not_connected", message: "Ordering is not available right now. No order was placed." };

/** Guest-facing copy. None of it refers to order tracking or order status pages. */
const messages: Record<string, string> = {
  CK001: "An item in your cart is no longer available. Remove it and try again.",
  CK002: "There is not enough stock for an item in your cart. Reduce the quantity or remove the item.",
  CK003: "Your cart is empty. Add an item to place an order.",
  CK005: "Too many attempts from this connection. Please wait a few minutes and try again.",
  CK006: "This mobile number has reached today's order limit. Please try again tomorrow.",
  CK007: "Please choose a district that belongs to the division you selected.",
  CK008: "Ordering is not available right now. No order was placed.",
  CK009: "This coupon could not be applied to your order. Remove the coupon and try again.",
  CK010: "This order has too many items. Please reduce your cart and try again.",
  CK011: "Only one of each item can be ordered.",
  CK012: "Orders cannot be placed from this mobile number right now. Please contact the store if you think this is a mistake.",
  CK013: "This Transaction ID has already been used for another order. Check the Transaction ID and try again.",
  "22023": "Please check your name, mobile number, delivery address and cart, then try again.",
};
const generic = "We could not place your order. Your cart has been kept. Please try again.";

function failure(code: string): Failure {
  const message = messages[code];
  if (message) return { ok: false, reason: "validation", message };
  return { ok: false, reason: "not_connected", message: generic };
}

export function createCheckoutService(
  rpc: CheckoutRpc,
  jar: CheckoutCookieJar,
  options: {
    clientKey: string;
    /**
     * Called once, synchronously, after a FRESH order is placed — never
     * awaited, never allowed to break checkout. The service never awaits
     * the hook: the Next.js layer schedules the real work with after(),
     * so a slow notification cannot delay the customer's confirmation.
     * An idempotent replay of an already-placed order does NOT call it.
     */
    onOrderPlaced?: (order: PlacedOrderNotification) => void;
  },
) {
  if (!CLIENT_KEY.test(options.clientKey)) throw new Error("A hashed client key is required");
  const clientKey = options.clientKey;
  const currentToken = () => {
    const token = jar.get();
    return token && TOKEN.test(token) ? token : undefined;
  };
  const isCompleted = async (token: string) => {
    const status = await rpc<{ lifecycle_status: string }>("checkout_session_status", { raw_token: token });
    return status.ok ? status.data.lifecycle_status === "completed" : null;
  };
  const contactArgs = (c: CheckoutProgressInput["customer"]) => ({ customer_name: c.fullName, phone: c.phone, email: c.email ?? null, client_key: clientKey });
  const itemArgs = (items: CheckoutProgressInput["items"]) => items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity }));

  /** Returns a usable token with contact and items stored, or says the session is completed. */
  async function prepare(input: CheckoutProgressInput): Promise<{ token: string } | { completed: string } | Failure> {
    let token = currentToken();
    if (token) {
      const completed = await isCompleted(token);
      if (completed) return { completed: token };
      if (completed === null) {
        jar.clear();
        token = undefined;
      }
    }
    if (token) {
      const updated = await rpc("update_checkout_contact", { raw_token: token, ...contactArgs(input.customer) });
      if (!updated.ok) return (await isCompleted(token)) ? { completed: token } : failure(updated.code);
    } else {
      const started = await rpc<{ token: string; expires_at: string }>("start_checkout_session", contactArgs(input.customer));
      if (!started.ok) return failure(started.code);
      if (!TOKEN.test(started.data.token)) return failure("unknown");
      token = started.data.token;
      jar.set(token, new Date(started.data.expires_at));
    }
    const saved = await rpc("set_checkout_items", { raw_token: token, items: itemArgs(input.items), client_key: clientKey });
    if (!saved.ok) return (await isCompleted(token)) ? { completed: token } : failure(saved.code);
    return { token };
  }

  /** Records contact details and cart contents once the customer has entered contact details. */
  async function saveProgress(raw: unknown): Promise<ActionResult<{ saved: true }>> {
    const input = parseCheckoutProgress(raw);
    if (!input) return failure("22023");
    let prepared = await prepare(input);
    if ("completed" in prepared) {
      // The previous checkout already became an order: this is a new checkout.
      jar.clear();
      prepared = await prepare(input);
    }
    if ("token" in prepared) return { ok: true, data: { saved: true } };
    return "completed" in prepared ? notConnected : prepared;
  }

  async function placeOrder(raw: unknown): Promise<ActionResult<PlacedOrder>> {
    const input = parseCheckoutOrder(raw);
    if (!input) return failure("22023");
    const place = async (token: string) => {
      const args: Record<string, unknown> = {
        raw_token: token,
        delivery: { division: input.address.division, district: input.address.district, area: input.address.area, address_line: input.address.addressLine },
        payment_method: input.paymentMethod,
        order_note: input.note ?? null,
        client_key: clientKey,
        expected_items: itemArgs(input.items),
        // The coupon argument is sent only when a coupon is applied, so
        // databases without the coupon migration keep placing orders with
        // the six-argument signature. The seventh parameter has a default
        // once the migration is applied.
        ...(input.couponCode ? { p_coupon_code: input.couponCode } : {}),
        // The advance-payment receipt is sent the same way, as the
        // optional eighth parameter, so the database records a
        // structured payment_submissions row in the same transaction.
        ...(input.payment
          ? {
              p_payment: {
                provider: input.payment.provider,
                transaction_id: input.payment.transactionId,
                sender_number: input.payment.senderNumber,
                idempotency_key: input.payment.idempotencyKey,
              },
            }
          : {}),
      };
      const placed = await rpc<OrderRow>("place_checkout_order", args);
      if (
        placed.ok ||
        !input.payment ||
        input.couponCode ||
        (placed.code !== "PGRST202" && placed.code !== "42883")
      ) {
        return placed;
      }
      // Database predates the payment-submissions migration (it has no
      // eight-argument place_checkout_order): place without the structured
      // payment. The order note line still carries the TxID + sender
      // number, so the shop can verify the advance from the order
      // detail. No coupon is in play here — a coupon is never silently
      // dropped, the coupon error path below still refuses the order
      // when the database cannot apply one.
      const legacyArgs: Record<string, unknown> = { ...args };
      delete legacyArgs.p_payment;
      return rpc<OrderRow>("place_checkout_order", legacyArgs);
    };
    const done = (row: OrderRow): ActionResult<PlacedOrder> => {
      jar.clear();
      // Notify only a FRESH placement: an idempotent replay returns the same
      // row with already_placed, and must not send the notice twice. A
      // throwing hook must never break the order result.
      if (!row.already_placed) {
        try {
          options.onOrderPlaced?.({
            orderNumber: String(row.order_number),
            total: row.total_minor / 100,
          });
        } catch {
          // Notification failures never affect checkout.
        }
      }
      return { ok: true, data: { orderNumber: String(row.order_number), total: row.total_minor / 100 } };
    };
    let blockChecked = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prepared = await prepare(input);
      if ("ok" in prepared) return prepared;
      const isReplay = "completed" in prepared;
      const token = isReplay ? prepared.completed : prepared.token;
      if (!isReplay && !blockChecked) {
        // Blocked-customer enforcement (migration 20261119000600): a phone
        // in blocked_customers (unblocked_at null) cannot place a NEW
        // order. The check runs here, before any stock is touched, so the
        // customer gets the CK012 message instead of a generic failure.
        // A replay of an already-placed order is NOT checked: the order
        // already exists, and refusing it would hide the confirmation.
        // A failed check (RPC missing because the migration is not applied
        // yet, or a network error) must NOT block checkout — it fails open
        // and the database trigger in the same migration is the
        // authoritative enforcement once the migration is applied.
        blockChecked = true;
        const blocked = await rpc<boolean>("is_phone_blocked", { p_phone: input.customer.phone });
        if (blocked.ok && blocked.data === true) return failure("CK012");
      }
      // Same checkout + same items: the database returns the original order, at any time.
      const placed = await place(token);
      if (placed.ok) return done(placed.data);
      if (placed.code === "CK004") {
        // The credential belongs to a different, already-placed cart. Start a fresh checkout.
        jar.clear();
        continue;
      }
      if (input.couponCode && (placed.code === "PGRST202" || placed.code === "42883")) {
        // The database has no seven-argument place_checkout_order yet, so the
        // coupon cannot be applied there. Never place the order silently at
        // full price: the customer must remove the coupon first.
        return { ok: false, reason: "validation", message: "Coupons are not available yet. Remove the coupon to place your order." };
      }
      return failure(placed.code);
    }
    return failure("unknown");
  }

  return { saveProgress, placeOrder };
}

/** Outcome of a `validate_coupon` call. `ok: false` means the check itself failed. */
export type CouponValidationResult =
  | { ok: true; valid: true; discountMinor: number }
  | { ok: true; valid: false; reason: CouponReason }
  | { ok: false };

/**
 * Check a coupon against the cart subtotal. The RPC never raises for an
 * ineligible coupon: it returns `{valid, reason, discount_minor}`. Any
 * transport error or unparseable response is `ok: false`, so the caller
 * says the check failed instead of inventing a discount.
 */
export async function validateCoupon(
  rpc: CheckoutRpc,
  input: { code: string; userId: string | null; phone: string | null; subtotalMinor: number },
): Promise<CouponValidationResult> {
  const code = typeof input.code === "string" ? normalizeCouponCode(input.code) : "";
  if (!COUPON_CODE_PATTERN.test(code) || !Number.isInteger(input.subtotalMinor) || input.subtotalMinor < 0) {
    return { ok: true, valid: false, reason: "invalid_request" };
  }
  const result = await rpc<unknown>("validate_coupon", {
    p_code: code,
    p_user_id: input.userId,
    p_phone: input.phone,
    p_subtotal_minor: input.subtotalMinor,
  });
  if (!result.ok) return { ok: false };
  const data = result.data as { valid?: unknown; reason?: unknown; discount_minor?: unknown } | null;
  if (!data || typeof data !== "object") return { ok: false };
  if (data.valid === true) {
    if (typeof data.discount_minor !== "number" || !Number.isInteger(data.discount_minor) || data.discount_minor < 0) return { ok: false };
    return { ok: true, valid: true, discountMinor: data.discount_minor };
  }
  if (data.valid === false && isCouponReason(data.reason)) {
    return { ok: true, valid: false, reason: data.reason };
  }
  return { ok: false };
}

export const checkoutMessagesForTests: Record<string, string> = { ...messages, generic };
