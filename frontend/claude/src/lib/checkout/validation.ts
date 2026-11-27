import { z } from "zod";
import { DIVISIONS } from "@/data/bangladesh";
import { BD_PHONE_REGEX, normalizePhone } from "@/lib/validation";
import { COUPON_CODE_PATTERN, normalizeCouponCode } from "./coupons";

/**
 * Everything arriving from the browser is untrusted. These schemas keep only what the
 * server needs: who, where, and WHICH variants in what quantity. Prices, totals, product
 * ids and delivery charges sent by the browser are never read. A coupon code is an
 * identifier only: the server re-validates it and computes the discount, and the
 * browser never sends a discount amount.
 */
const contact = z.object({
  fullName: z.string().trim().min(3).max(120),
  phone: z.string().max(40).transform(normalizePhone).pipe(z.string().regex(BD_PHONE_REGEX)),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.email().optional()),
});

const items = z
  .array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(99) }))
  .max(50)
  .refine((list) => new Set(list.map((i) => i.variantId.toLowerCase())).size === list.length);

const address = z
  .object({
    division: z.string(),
    district: z.string(),
    area: z.string().trim().min(1).max(120),
    addressLine: z.string().trim().min(8).max(500),
  })
  .refine((a) => (DIVISIONS[a.division] ?? []).includes(a.district));

const progress = z.object({ customer: contact, items });
const order = z.object({
  customer: contact,
  items: items.min(1),
  address,
  paymentMethod: z.literal("cod"),
  // Advance payment details, validated again by the server action before
  // they reach placeOrder (see src/services/actions.ts). The service
  // forwards them as p_payment so the database records a structured
  // payment_submissions row; the order note line is still written as a
  // fallback. A missing payment here is not a parse failure — the
  // action refuses the order before the service ever runs.
  payment: z
    .object({
      provider: z.enum(["bkash", "nagad"]),
      transactionId: z.string().trim().min(1).max(128),
      senderNumber: z
        .string()
        .trim()
        .max(40)
        // Same 01-format normalization as validatePaymentDetails:
        // the checkout RPC CHECK requires ^01[3-9][0-9]{8}$, so a
        // +880 sender must be normalized here, not passed through.
        .transform((value) =>
          normalizePhone(value).replace(/^\+?88(?=01[3-9])/, ""),
        )
        .pipe(z.string().regex(BD_PHONE_REGEX)),
      idempotencyKey: z
        .string()
        .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),
    })
    .optional(),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value ? value : undefined)),
  // Normalized to the database form (trimmed, upper-case) before the
  // pattern check, so surrounding spaces never fail a well-formed code. An
  // empty value means "no coupon"; a malformed code fails the whole parse.
  couponCode: z
    .string()
    .optional()
    .transform((value) => {
      const code = normalizeCouponCode(value ?? "");
      return code === "" ? undefined : code;
    })
    .pipe(z.string().regex(COUPON_CODE_PATTERN).optional()),
});

export type CheckoutProgressInput = z.infer<typeof progress>;
export type CheckoutOrderInput = z.infer<typeof order>;

export function parseCheckoutProgress(input: unknown): CheckoutProgressInput | null {
  const parsed = progress.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCheckoutOrder(input: unknown): CheckoutOrderInput | null {
  const parsed = order.safeParse(input);
  return parsed.success ? parsed.data : null;
}
