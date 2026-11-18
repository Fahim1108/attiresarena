'use server';

import { COUPON_CODE_PATTERN, normalizeCouponCode, type CouponReason } from "@/lib/checkout/coupons";
import { validateCheckoutCoupon } from "@/services/checkout";

/**
 * Coupon check for the cart/checkout coupon field. Guests may check a coupon:
 * only first-order-only coupons need a signed-in customer, and the RPC says
 * so. Checking never records a redemption; only placing the order does.
 */
export type CouponCheckResult =
  | { ok: true; valid: true; code: string; discountMinor: number; subtotalMinor: number }
  | { ok: true; valid: false; reason: CouponReason }
  | { ok: false; message: string };

/**
 * Mirror of `private.normalize_bd_phone` (migration 20261113000200): strip
 * spaces and dashes, strip a leading country code, keep the 01 form the
 * database stores. An unparseable number becomes null (no phone counting)
 * rather than failing the check.
 */
function normalizeDbPhone(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const stripped = value.replace(/[\s-]/g, "").replace(/^\+?88/, "");
  return /^01[3-9]\d{8}$/.test(stripped) ? stripped : null;
}

export async function checkCouponAction(input: { code: string; phone?: string | null; subtotalMinor: number }): Promise<CouponCheckResult> {
  const code = typeof input?.code === "string" ? normalizeCouponCode(input.code) : "";
  const subtotalMinor = input?.subtotalMinor;
  if (!COUPON_CODE_PATTERN.test(code) || typeof subtotalMinor !== "number" || !Number.isInteger(subtotalMinor) || subtotalMinor < 0) {
    return { ok: true, valid: false, reason: "invalid_request" };
  }
  const result = await validateCheckoutCoupon({ code, phone: normalizeDbPhone(input?.phone), subtotalMinor });
  if (!result.ok) return { ok: false, message: result.message };
  if (result.data.valid) {
    return { ok: true, valid: true, code, discountMinor: result.data.discountMinor, subtotalMinor };
  }
  return { ok: true, valid: false, reason: result.data.reason };
}
