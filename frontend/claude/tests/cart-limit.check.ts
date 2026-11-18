import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCartAdd, applyCartQuantity, cartLimitRuleText, cartUnitCount, MAX_UNITS_PER_ORDER } from "../src/lib/cart-limits";
import { CartLimitNoticeContent } from "../src/components/cart/CartLimitModal";
import { createCheckoutService, type CheckoutRpc, type RpcResult } from "../src/lib/checkout/service";
import type { CartItem } from "../src/types";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

function lineInput(id: string, maxQuantity = 99): Omit<CartItem, "quantity"> {
  return {
    id,
    productId: `p-${id}`,
    productSlug: `slug-${id}`,
    variantId: `v-${id}`,
    name: `Shirt ${id}`,
    brandName: "",
    image: { src: "/x.jpg", alt: `Shirt ${id}` },
    colorName: "Blue",
    size: "M",
    unitPrice: 550,
    maxQuantity,
  };
}
function line(id: string, quantity: number, maxQuantity = 99): CartItem {
  return { ...lineInput(id, maxQuantity), quantity };
}

describe("cart order limit — pure transitions", () => {
  it("caps every order at 10 total units", () => {
    expect(MAX_UNITS_PER_ORDER).toBe(10);
  });

  it("allows adding up to exactly 10 units", () => {
    let lines: CartItem[] = [];
    for (let n = 1; n <= 10; n += 1) {
      const next = applyCartAdd(lines, lineInput(`l${n}`), 1);
      expect(next.result.refused).toBe(false);
      lines = next.lines;
    }
    expect(cartUnitCount(lines)).toBe(10);
    expect(lines).toHaveLength(10);
  });

  it("refuses the 11th unit and leaves the cart unchanged", () => {
    const lines = Array.from({ length: 10 }, (_, i) => line(`l${i}`, 1));
    const snapshot = lines.map((i) => ({ ...i }));
    const next = applyCartAdd(lines, lineInput("l11"), 1);
    expect(next.result).toEqual({ refused: true, refusal: { currentUnits: 10, attemptedUnits: 1, limit: 10 } });
    // Same array reference: the input is never mutated and React bails out of re-rendering.
    expect(next.lines).toBe(lines);
    expect(lines).toEqual(snapshot);
  });

  it("refuses a multi-unit add as a whole instead of partially adding", () => {
    const lines = [line("a", 8)];
    const snapshot = lines.map((i) => ({ ...i }));
    const next = applyCartAdd(lines, lineInput("b"), 3);
    expect(next.result.refused).toBe(true);
    expect(next.lines).toBe(lines);
    expect(lines).toEqual(snapshot);
    expect(cartUnitCount(next.lines)).toBe(8);
  });

  it("counts merged quantities against the same line", () => {
    const lines = [line("a", 9)];
    expect(applyCartAdd(lines, lineInput("a"), 1).result.refused).toBe(false);
    expect(applyCartAdd(lines, lineInput("a"), 1).lines[0]?.quantity).toBe(10);
    const refused = applyCartAdd(lines, lineInput("a"), 2);
    expect(refused.result.refused).toBe(true);
    expect(refused.lines).toEqual(lines);
  });

  it("keeps the per-line stock cap and treats an already-maxed line as a no-op", () => {
    // Line at its stock cap: the add would add zero units, so nothing is refused.
    const maxed = applyCartAdd([line("a", 2, 2)], lineInput("a", 2), 1);
    expect(maxed.result.refused).toBe(false);
    expect(maxed.lines).toEqual([line("a", 2, 2)]);
    // A new line is still clamped to stock: 7 + min(5, 3) = 10 is allowed.
    const clamped = applyCartAdd([line("a", 7)], lineInput("b", 3), 5);
    expect(clamped.result.refused).toBe(false);
    expect(clamped.lines[1]?.quantity).toBe(3);
    // ...but 8 + min(5, 3) = 11 is refused.
    expect(applyCartAdd([line("a", 8)], lineInput("b", 3), 5).result.refused).toBe(true);
  });

  it("caps the quantity stepper: increases past the limit are refused, decreases always apply", () => {
    const lines = [line("a", 5), line("b", 5)];
    const snapshot = lines.map((i) => ({ ...i }));
    const refused = applyCartQuantity(lines, "a", 6);
    expect(refused.result).toEqual({ refused: true, refusal: { currentUnits: 10, attemptedUnits: 1, limit: 10 } });
    expect(refused.lines).toBe(lines);
    expect(lines).toEqual(snapshot);
    const decreased = applyCartQuantity(lines, "a", 4);
    expect(decreased.result.refused).toBe(false);
    expect(decreased.lines[0]?.quantity).toBe(4);
    const belowCap = applyCartQuantity([line("a", 4), line("b", 4)], "a", 5);
    expect(belowCap.result.refused).toBe(false);
    expect(belowCap.lines[0]?.quantity).toBe(5);
  });

  it("keeps the stepper clamp to [1, maxQuantity]", () => {
    const lines = [line("a", 2, 3)];
    expect(applyCartQuantity(lines, "a", 99).lines[0]?.quantity).toBe(3);
    expect(applyCartQuantity(lines, "a", 0).lines[0]?.quantity).toBe(1);
    expect(applyCartQuantity(lines, "missing", 5).lines).toEqual(lines);
  });

  it("allows 10 more units once the cart is empty, and a placed order empties it", () => {
    const emptied: CartItem[] = [];
    let lines = emptied;
    for (let n = 1; n <= 10; n += 1) {
      const next = applyCartAdd(lines, lineInput(`n${n}`), 1);
      expect(next.result.refused).toBe(false);
      lines = next.lines;
    }
    expect(applyCartAdd(lines, lineInput("n11"), 1).result.refused).toBe(true);
    // The checkout form clears the cart on a successful placement, which is
    // what empties it in the real flow.
    const form = read("../src/components/checkout/CheckoutForm.tsx");
    const placedAt = form.indexOf("setPlaced({");
    expect(placedAt).toBeGreaterThan(-1);
    expect(form.indexOf("clear();", placedAt)).toBeGreaterThan(placedAt);
  });

  it("states the rule: 10 at a time, then 10 more after the order", () => {
    const text = cartLimitRuleText();
    expect(text).toMatch(/up to 10 items at a time/);
    expect(text).toMatch(/Place your current order first, then add up to 10 more/);
  });
});

describe("cart order limit — popup content", () => {
  it("renders the rule, the current count and the unchanged cart", () => {
    const html = renderToStaticMarkup(createElement(CartLimitNoticeContent, { currentUnits: 10, limit: 10 }));
    expect(html).toContain("data-cart-limit-notice");
    expect(html).toContain("10 items");
    expect(html).toContain("nothing was added");
    expect(html).toContain("your cart is unchanged");
    expect(html).toContain(cartLimitRuleText(10));
  });

  it("uses the singular for one item", () => {
    const html = renderToStaticMarkup(createElement(CartLimitNoticeContent, { currentUnits: 1, limit: 10 }));
    expect(html).toContain("1 item");
    expect(html).not.toContain("1 items");
  });
});

const CLIENT = "c".repeat(64);
const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const orderPayload = (count: number) => ({
  customer: { fullName: "Nasrin Akter", phone: "+880 1712-345678", email: "" },
  address: { fullName: "x", phone: "x", division: "Dhaka", district: "Gazipur", area: "Tongi", addressLine: "House 3, Block B" },
  paymentMethod: "cod",
  items: Array.from({ length: count }, (_, i) => ({ variantId: uuid(i + 1), quantity: 1 })),
});

/**
 * Minimal stand-in for the database RPCs. It mirrors the real
 * `place_checkout_order` rule: the unit total is summed from the STORED
 * checkout items (never the browser payload) and refused above 10 with CK010.
 */
function fakeDatabase() {
  const sessions = new Map<string, { items: { variant_id: string; quantity: number }[] }>();
  const bad = <T,>(code: string): RpcResult<T> => ({ ok: false, code });
  const rpc: CheckoutRpc = async <T,>(name: string, args: Record<string, unknown>) => {
    const good = (data: unknown): RpcResult<T> => ({ ok: true, data: data as T });
    if (name === "start_checkout_session") {
      const token = "a".repeat(64);
      sessions.set(token, { items: [] });
      return good({ token, expires_at: "2030-01-08T00:00:00Z" });
    }
    const s = sessions.get(String(args.raw_token));
    if (!s) return bad("22023");
    if (name === "checkout_session_status") return good({ lifecycle_status: "active" });
    if (name === "set_checkout_items") {
      s.items = args.items as { variant_id: string; quantity: number }[];
      return good({});
    }
    if (name === "update_checkout_contact") return good({});
    if (name === "place_checkout_order") {
      const units = s.items.reduce((n, i) => n + i.quantity, 0);
      if (units > MAX_UNITS_PER_ORDER) return bad("CK010");
      return good({ order_number: 10001, total_minor: 63000, placed_at: "2030-01-08T00:00:00Z", already_placed: false, items: s.items });
    }
    return bad("unknown");
  };
  return { rpc };
}

function jar() {
  let value: string | undefined;
  return { get: () => value, set: (t: string) => { value = t; }, clear: () => { value = undefined; } };
}

describe("cart order limit — checkout server re-check", () => {
  it("places an order with exactly 10 units", async () => {
    const service = createCheckoutService(fakeDatabase().rpc, jar(), { clientKey: CLIENT });
    const res = await service.placeOrder(orderPayload(10));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.orderNumber).toBe("10001");
  });

  it("refuses an 11-unit order with a clear message and keeps the session", async () => {
    const cookieJar = jar();
    const service = createCheckoutService(fakeDatabase().rpc, cookieJar, { clientKey: CLIENT });
    const res = await service.placeOrder(orderPayload(11));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("validation");
      expect(res.message).toBe("This order has too many items. Please reduce your cart and try again.");
    }
    // Refusal never clears the checkout credential: the customer can reduce the cart and retry.
    expect(cookieJar.get()).toBe("a".repeat(64));
  });

  it("enforces the limit for guests and signed-in customers through the same path", () => {
    // The cart and the checkout service carry no session/auth branching: the
    // same context and the same RPC refuse the 11th unit for everyone.
    for (const file of ["../src/lib/cart-limits.ts", "../src/context/CartContext.tsx", "../src/components/cart/CartLimitModal.tsx", "../src/lib/checkout/service.ts"]) {
      const source = read(file);
      expect(source).not.toMatch(/getSession|useCustomer|auth\.getUser/);
    }
  });
});

describe("cart order limit — wiring and database reconciliation", () => {
  it("enforces the cap in the cart context and drives the popup from it", () => {
    const context = read("../src/context/CartContext.tsx");
    expect(context).toContain("applyCartAdd");
    expect(context).toContain("applyCartQuantity");
    expect(context).toContain("limitNotice");
    expect(context).toContain("dismissLimitNotice");
    expect(context).toContain("CartAddOutcome");
  });

  it("computes cart outcomes from a synchronous ref mirror, never inside a state updater", () => {
    const context = read("../src/context/CartContext.tsx");
    expect(context).toContain("itemsRef");
    expect(context).toContain("applyCartAdd(itemsRef.current");
    expect(context).toContain("applyCartQuantity(itemsRef.current");
    // Reading an outcome out of an updater is unreliable under batching:
    // no mutation may use the functional setItems form.
    expect(context).not.toContain("setItems((current)");
  });

  it("mounts the popup exactly once, next to the cart drawer", () => {
    const header = read("../src/components/layout/Header.tsx");
    expect(header).toContain("CartLimitModal");
    expect(header.match(/<CartLimitModal \/>/g)).toHaveLength(1);
  });

  it("gates the drawer and Buy Now navigation on a successful add", () => {
    expect(read("../src/components/product/ProductCard.tsx")).toMatch(/const \{ added \} = addItem/);
    expect(read("../src/components/product/ProductCard.tsx")).toMatch(/if \(added\) openDrawer\(\)/);
    expect(read("../src/components/product/ProductPurchasePanel.tsx")).toMatch(/const \{ added \} = addItem/);
    expect(read("../src/components/product/ProductPurchasePanel.tsx")).toMatch(/if \(!added\) return;/);
  });

  it("keeps the database as the authoritative enforcer (no new migration)", () => {
    const migration = read("../../../supabase/migrations/20261113000300_checkout_security_reliability.sql");
    expect(migration).toContain("max_units_per_order integer not null default 10");
    expect(migration).toContain("if units > cfg.max_units_per_order then");
    expect(migration).toContain("errcode = 'CK010'");
    const migrations = readdirSync(join(here, "../../../supabase/migrations"));
    expect(migrations.filter((f) => /cart.?limit/i.test(f))).toEqual([]);
  });
});
