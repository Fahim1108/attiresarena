import type { ActionResult } from "@/types";
import { parseCheckoutOrder, parseCheckoutProgress, type CheckoutProgressInput } from "./validation";

/**
 * Checkout orchestration, independent of Next.js so it can be tested directly.
 * Browser -> server action -> HttpOnly cookie (raw token) -> database function (hashes it).
 * The raw token is never returned to the browser and never logged.
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
const unavailable: Failure = { ok: false, reason: "not_connected", message: "Ordering is not available right now. No order was placed." };

function failure(code: string): Failure {
  if (code === "CK001") return { ok: false, reason: "validation", message: "An item in your cart is no longer available. Remove it and try again." };
  if (code === "CK002") return { ok: false, reason: "validation", message: "There is not enough stock for an item in your cart. Reduce the quantity or remove it." };
  if (code === "CK003") return { ok: false, reason: "validation", message: "Your cart is empty." };
  if (code === "22023") return { ok: false, reason: "validation", message: "Check your name, mobile number, delivery address and cart, then try again." };
  return unavailable;
}

function sameItems(placed: OrderRow["items"], submitted: CheckoutProgressInput["items"]): boolean {
  const key = (list: { id: string; quantity: number }[]) => list.map((i) => `${i.id.toLowerCase()}x${i.quantity}`).sort().join(",");
  return key((placed ?? []).map((i) => ({ id: i.variant_id, quantity: i.quantity }))) === key(submitted.map((i) => ({ id: i.variantId, quantity: i.quantity })));
}

export function createCheckoutService(rpc: CheckoutRpc, jar: CheckoutCookieJar, options: { duplicateWindowMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const currentToken = () => {
    const token = jar.get();
    return token && TOKEN.test(token) ? token : undefined;
  };
  const isCompleted = async (token: string) => {
    const status = await rpc<{ lifecycle_status: string }>("checkout_session_status", { raw_token: token });
    return status.ok ? status.data.lifecycle_status === "completed" : null;
  };
  const contactArgs = (c: CheckoutProgressInput["customer"]) => ({ customer_name: c.fullName, phone: c.phone, email: c.email ?? null });

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
      if (!TOKEN.test(started.data.token)) return unavailable;
      token = started.data.token;
      jar.set(token, new Date(started.data.expires_at));
    }
    const saved = await rpc("set_checkout_items", { raw_token: token, items: input.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })) });
    if (!saved.ok) return (await isCompleted(token)) ? { completed: token } : failure(saved.code);
    return { token };
  }

  /** Records contact details and cart contents once the customer shows checkout intent. */
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
    return "completed" in prepared ? unavailable : prepared;
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
      });
    const done = (row: OrderRow): ActionResult<PlacedOrder> => {
      jar.clear();
      return { ok: true, data: { orderNumber: String(row.order_number), total: row.total_minor / 100 } };
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prepared = await prepare(input);
      if ("ok" in prepared) return prepared;
      if ("completed" in prepared) {
        // Already an order. Placing again has no effect and returns that order.
        const prior = await place(prepared.completed);
        if (prior.ok && sameItems(prior.data.items, input.items) && now() - Date.parse(prior.data.placed_at) < options.duplicateWindowMs) return done(prior.data);
        jar.clear(); // stale credential from an earlier purchase: start a new checkout
        continue;
      }
      const placed = await place(prepared.token);
      return placed.ok ? done(placed.data) : failure(placed.code);
    }
    return unavailable;
  }

  return { saveProgress, placeOrder };
}
