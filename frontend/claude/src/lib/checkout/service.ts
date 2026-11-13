import type { ActionResult } from "@/types";
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
  CK010: "This order has too many items. Please reduce your cart and try again.",
  CK011: "Only one of each item can be ordered.",
  "22023": "Please check your name, mobile number, delivery address and cart, then try again.",
};
const generic = "We could not place your order. Your cart has been kept. Please try again.";

function failure(code: string): Failure {
  const message = messages[code];
  if (message) return { ok: false, reason: "validation", message };
  return { ok: false, reason: "not_connected", message: generic };
}

export function createCheckoutService(rpc: CheckoutRpc, jar: CheckoutCookieJar, options: { clientKey: string }) {
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
    const place = (token: string) =>
      rpc<OrderRow>("place_checkout_order", {
        raw_token: token,
        delivery: { division: input.address.division, district: input.address.district, area: input.address.area, address_line: input.address.addressLine },
        payment_method: input.paymentMethod,
        order_note: input.note ?? null,
        client_key: clientKey,
        expected_items: itemArgs(input.items),
      });
    const done = (row: OrderRow): ActionResult<PlacedOrder> => {
      jar.clear();
      return { ok: true, data: { orderNumber: String(row.order_number), total: row.total_minor / 100 } };
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prepared = await prepare(input);
      if ("ok" in prepared) return prepared;
      const token = "completed" in prepared ? prepared.completed : prepared.token;
      // Same checkout + same items: the database returns the original order, at any time.
      const placed = await place(token);
      if (placed.ok) return done(placed.data);
      if (placed.code === "CK004") {
        // The credential belongs to a different, already-placed cart. Start a fresh checkout.
        jar.clear();
        continue;
      }
      return failure(placed.code);
    }
    return failure("unknown");
  }

  return { saveProgress, placeOrder };
}

export const checkoutMessagesForTests = { ...messages, generic };
