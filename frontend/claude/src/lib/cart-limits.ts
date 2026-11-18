import type { CartItem } from "@/types";

/**
 * Maximum total units in one order, across all cart lines.
 *
 * This mirrors the `max_units_per_order` default (10) in
 * `private.checkout_settings` (migration 20261113000300). The database is
 * authoritative: `place_checkout_order` refuses any order above the stored
 * setting with CK010, whatever this client value says. This constant exists
 * only so the storefront can refuse the 11th unit immediately with a popup
 * instead of waiting for checkout to fail. If the stored setting ever
 * changes, update this value in the same change.
 */
export const MAX_UNITS_PER_ORDER = 10;

/** Total units across all cart lines. */
export function cartUnitCount(items: readonly { quantity: number }[]): number {
  return items.reduce((n, i) => n + i.quantity, 0);
}

export interface CartLimitRefusal {
  /** Units already in the cart when the attempt was refused. */
  currentUnits: number;
  /** Units the refused attempt would have added. */
  attemptedUnits: number;
  limit: number;
}

export type CartMutationResult = { refused: false } | { refused: true; refusal: CartLimitRefusal };

/**
 * Pure add transition for the cart: merges into an existing line (clamped to
 * the line's maxQuantity, preserving today's stock-cap behaviour) or appends
 * a new line. The WHOLE add is refused — lines returned unchanged — when the
 * resulting total would exceed the limit. An add that would add zero units
 * (the line is already at its stock cap) is a silent no-op, as today: no
 * unit was refused, so no popup. Never mutates `lines`; refusal and no-op
 * paths return the same array reference so React bails out of re-rendering.
 */
export function applyCartAdd(
  lines: CartItem[],
  line: Omit<CartItem, "quantity">,
  quantity: number,
  limit: number = MAX_UNITS_PER_ORDER,
): { lines: CartItem[]; result: CartMutationResult } {
  const currentUnits = cartUnitCount(lines);
  const existing = lines.find((i) => i.id === line.id);
  const effective = existing ? Math.min(existing.quantity + quantity, existing.maxQuantity) - existing.quantity : Math.min(quantity, line.maxQuantity);
  if (effective <= 0) return { lines, result: { refused: false } };
  if (currentUnits + effective > limit) {
    return { lines, result: { refused: true, refusal: { currentUnits, attemptedUnits: effective, limit } } };
  }
  if (existing) {
    return { lines: lines.map((i) => (i.id === line.id ? { ...i, quantity: i.quantity + effective } : i)), result: { refused: false } };
  }
  return { lines: [...lines, { ...line, quantity: effective }], result: { refused: false } };
}

/**
 * Pure quantity transition for the cart steppers: clamps to [1, maxQuantity]
 * exactly as today. Decreases (and no-ops) always apply; an increase that
 * would push the cart total over the limit is refused with the lines
 * unchanged, so the stepper never moves past the cap.
 */
export function applyCartQuantity(
  lines: CartItem[],
  lineId: string,
  quantity: number,
  limit: number = MAX_UNITS_PER_ORDER,
): { lines: CartItem[]; result: CartMutationResult } {
  const line = lines.find((i) => i.id === lineId);
  if (!line) return { lines, result: { refused: false } };
  const next = Math.max(1, Math.min(quantity, line.maxQuantity));
  const delta = next - line.quantity;
  if (delta <= 0) {
    return { lines: lines.map((i) => (i.id === lineId ? { ...i, quantity: next } : i)), result: { refused: false } };
  }
  const currentUnits = cartUnitCount(lines);
  if (currentUnits + delta > limit) {
    return { lines, result: { refused: true, refusal: { currentUnits, attemptedUnits: delta, limit } } };
  }
  return { lines: lines.map((i) => (i.id === lineId ? { ...i, quantity: next } : i)), result: { refused: false } };
}

/** The rule, in the customer's words. Used by the limit popup and its tests. */
export function cartLimitRuleText(limit: number = MAX_UNITS_PER_ORDER): string {
  return `You can order up to ${limit} items at a time. Place your current order first, then add up to ${limit} more — or remove an item to make room.`;
}
