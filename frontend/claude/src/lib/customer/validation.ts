import { z } from "zod";
import { DIVISIONS } from "@/data/bangladesh";
import { BD_PHONE_REGEX, normalizePhone } from "@/lib/validation";

/**
 * Customer-auth input validation. Server-enforced via zod in every
 * customer action; the client forms mirror these rules for instant
 * feedback but are never trusted.
 *
 * Sign-in is EMAIL-ONLY (coordinator decision D5). There is no
 * phone-to-email lookup of any kind: phone-shaped identifiers are
 * rejected with a clear message, never resolved.
 */

/** Customer password policy: 8-128 characters (registration + reset). */
export const CUSTOMER_PASSWORD_SCHEMA = z.string().min(8).max(128);

export const customerEmailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email());

/**
 * Strict Bangladeshi mobile form, matching the database CHECK
 * (`^01[3-9][0-9]{8}$` on orders.phone / profiles.phone /
 * customer_addresses.phone): spaces/dashes stripped and a +88/88
 * prefix removed before the strict check, mirroring the database
 * normalize_bd_phone behaviour.
 */
function normalizeBdPhoneStrict(value: string): string {
  return normalizePhone(value).replace(/^\+?88(?=01[3-9])/, "");
}

export const customerPhoneSchema = z
  .string()
  .max(40)
  .transform(normalizeBdPhoneStrict)
  .pipe(z.string().regex(/^01[3-9][0-9]{8}$/));

/** True when the value looks like a Bangladeshi mobile number. */
export function looksLikeBdPhone(value: string): boolean {
  return BD_PHONE_REGEX.test(normalizePhone(value));
}

export const customerSignInSchema = z.object({
  email: customerEmailSchema,
  // Sign-in accepts existing passwords of any length within the bound;
  // the 8-character minimum applies when a password is CREATED.
  password: z.string().min(1).max(128),
});

export const customerRegisterSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  email: customerEmailSchema,
  phone: customerPhoneSchema,
  password: CUSTOMER_PASSWORD_SCHEMA,
});

export const customerPasswordResetRequestSchema = z.object({
  email: customerEmailSchema,
});

export const customerNewPasswordSchema = z.object({
  password: CUSTOMER_PASSWORD_SCHEMA,
});

/** Profile edits: name + phone only. Email is read-only (decision D8). */
export const customerProfileSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  phone: customerPhoneSchema,
});

export type CustomerProfileInput = z.infer<typeof customerProfileSchema>;

/**
 * Saved-address input. `id` is "" for a new address and the address UUID
 * for an edit. Division/district must match the Bangladesh data, as in
 * checkout validation; the remaining bounds mirror the database CHECKs
 * in migration 20261116000700.
 */
export const customerAddressSchema = z
  .object({
    id: z.union([z.literal(""), z.uuid()]),
    label: z.string().trim().min(1).max(40),
    fullName: z.string().trim().min(3).max(120),
    phone: customerPhoneSchema,
    division: z.string(),
    district: z.string().trim().min(1).max(120),
    area: z.string().trim().min(1).max(120),
    addressLine: z.string().trim().min(6).max(500),
    isDefault: z.boolean(),
  })
  .refine((a) => (DIVISIONS[a.division] ?? []).includes(a.district));

export type CustomerAddressInput = z.infer<typeof customerAddressSchema>;

/**
 * Google identity-conflict copy (decision D12). Shown when Supabase
 * reports that an account with the email already exists; never calls
 * linkIdentity, never merges accounts. Shared by the Google server
 * action and the /auth/callback route (a "use server" module cannot
 * export this constant, so it lives here).
 */
export const GOOGLE_IDENTITY_CONFLICT_MESSAGE =
  "An account with this email already exists. Sign in with your password, then contact support to link Google sign-in.";

/**
 * Best-effort classification of provider error text as an
 * identity-conflict. Supabase surfaces this case with varying
 * messages/codes, so the match is deliberately narrow: only text that
 * names an existing identity/account counts.
 */
export function isIdentityConflictText(value: string): boolean {
  const text = value.toLowerCase();
  return (
    text.includes("identity already exists") ||
    text.includes("user already registered") ||
    text.includes("already registered") ||
    text.includes("account already exists") ||
    text.includes("user_already_exists")
  );
}

/** Best-effort classification of a Supabase Auth error as "already registered" (decision D11). */
export function isAlreadyRegisteredError(error: {
  message?: string;
  code?: string | null;
}): boolean {
  return isIdentityConflictText(
    `${error.code ?? ""} ${error.message ?? ""}`,
  );
}
