/**
 * Coupon helpers shared by the cart/checkout client code and the checkout
 * service. This module is pure: it never calls the database. All coupon
 * semantics live in the `validate_coupon` RPC (migration
 * 20261115000400); the browser only normalizes the code, converts money to
 * minor units, and renders the reason the server returns.
 *
 * A coupon is a SERVER-VALIDATED discount. The cart keeps the discount the
 * server returned for one exact subtotal; if the subtotal changes, the
 * discount is stale and must be re-validated before it can be shown or
 * sent to place_checkout_order.
 */

export const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

/** Same normalization as the database: trim, then upper-case. */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isWellFormedCouponCode(code: string): boolean {
  return COUPON_CODE_PATTERN.test(code);
}

/** Money in the storefront is major units (BDT); the RPC takes minor units. */
export function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}

export function fromMinorUnits(minor: number): number {
  return minor / 100;
}

/** Reason codes returned by `validate_coupon`, in the order the RPC checks them. */
export type CouponReason =
  | "not_found"
  | "inactive"
  | "not_yet_valid"
  | "expired"
  | "below_minimum"
  | "usage_limit_reached"
  | "per_customer_limit_reached"
  | "first_order_only"
  | "invalid_request";

export const COUPON_REASONS: readonly CouponReason[] = [
  "not_found",
  "inactive",
  "not_yet_valid",
  "expired",
  "below_minimum",
  "usage_limit_reached",
  "per_customer_limit_reached",
  "first_order_only",
  "invalid_request",
];

export function isCouponReason(value: unknown): value is CouponReason {
  return typeof value === "string" && (COUPON_REASONS as readonly string[]).includes(value);
}

/**
 * Guest-facing wording for each reason. The first-order message stays
 * neutral: the RPC returns `first_order_only` both for guests and for
 * signed-in customers with prior orders, who are already signed in.
 */
export const COUPON_REASON_MESSAGES: Record<CouponReason, string> = {
  not_found: "This coupon code was not found.",
  inactive: "This coupon is not active.",
  not_yet_valid: "This coupon is not valid yet.",
  expired: "This coupon has expired.",
  below_minimum: "Your order is below this coupon's minimum amount.",
  usage_limit_reached: "This coupon has reached its usage limit.",
  per_customer_limit_reached: "You have already used this coupon.",
  first_order_only: "This coupon is for your first order only.",
  invalid_request: "This coupon code is not valid.",
};

export function couponReasonMessage(reason: CouponReason): string {
  return COUPON_REASON_MESSAGES[reason];
}

/**
 * A validated coupon is fresh only for the exact subtotal AND phone it was
 * checked against. The phone matters because the server counts per-customer
 * usage by phone for guests: a coupon checked without a phone must be
 * re-checked once the phone is known, and vice versa. Both sides use null
 * for "no phone".
 */
export function isCouponFresh(
  coupon: { validatedSubtotalMinor: number; validatedPhone: string | null } | undefined,
  subtotalMinor: number,
  phone: string | null,
): boolean {
  return coupon !== undefined && coupon.validatedSubtotalMinor === subtotalMinor && coupon.validatedPhone === phone;
}
