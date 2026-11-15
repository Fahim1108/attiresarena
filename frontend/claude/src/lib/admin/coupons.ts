import "server-only";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, actionOk, actionError, toActionError, type AdminActionResult } from "./authorization";
import { areaRoles } from "./constants";
import { formatMoney, parseMoneyToMinor } from "./format";
import { isValidBdPhone } from "./customers";

/* ------------------------------------------------------------------ */
/* Pure helpers (covered by tests/sales.check.ts)                      */
/*                                                                     */
/* evaluateCouponEligibility mirrors public.validate_coupon exactly:   */
/* same check order, same reason codes, same discount math. If the SQL */
/* changes, this mirror and its tests must change with it.             */
/* ------------------------------------------------------------------ */

export type CouponKind = "percent" | "fixed";

export interface CouponTerms {
  kind: CouponKind;
  percent_value: number | null;
  fixed_discount_minor: number | null;
  min_order_minor: number;
  max_discount_minor: number | null;
  starts_at: string | null;
  expires_at: string | null;
  total_usage_limit: number | null;
  per_customer_limit: number | null;
  first_order_only: boolean;
  active: boolean;
}

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Discount for a subtotal, before eligibility checks. Caps at max/subtotal. */
export function couponDiscountMinor(
  terms: Pick<CouponTerms, "kind" | "percent_value" | "fixed_discount_minor" | "max_discount_minor">,
  subtotalMinor: number,
): number {
  if (subtotalMinor <= 0) return 0;
  const raw =
    terms.kind === "percent"
      ? Math.floor((subtotalMinor * (terms.percent_value ?? 0)) / 100)
      : (terms.fixed_discount_minor ?? 0);
  const capped =
    terms.max_discount_minor === null ? raw : Math.min(raw, terms.max_discount_minor);
  return Math.max(0, Math.min(capped, subtotalMinor));
}

export type CouponReason =
  | "not_found"
  | "invalid_request"
  | "inactive"
  | "not_yet_valid"
  | "expired"
  | "below_minimum"
  | "usage_limit_reached"
  | "per_customer_limit_reached"
  | "first_order_only";

export interface CouponEligibility {
  valid: boolean;
  reason: CouponReason | null;
  discount_minor: number;
}

export function evaluateCouponEligibility(
  coupon: CouponTerms | null,
  input: {
    subtotalMinor: number;
    userId: string | null;
    phone: string | null;
    /** Total redemptions of this coupon. */
    totalRedemptions: number;
    /** Redemptions of this coupon by this customer (by account when given, else by phone). */
    customerRedemptions: number;
    /** Prior orders placed by this account (0 when no account is given). */
    priorOrderCount: number;
    /** Prior redemptions of any coupon by this account (0 when no account is given). */
    priorRedemptionsByUser: number;
    now: Date;
  },
): CouponEligibility {
  const invalid = (reason: CouponReason): CouponEligibility => ({
    valid: false,
    reason,
    discount_minor: 0,
  });
  // Check order mirrors validate_coupon exactly: the SQL rejects a malformed
  // request (empty code / negative subtotal) BEFORE looking the coupon up,
  // so invalid_request wins over not_found when both apply.
  if (!Number.isInteger(input.subtotalMinor) || input.subtotalMinor < 0) {
    return invalid("invalid_request");
  }
  if (coupon === null) return invalid("not_found");
  if (!coupon.active) return invalid("inactive");
  if (coupon.starts_at !== null && input.now < new Date(coupon.starts_at)) {
    return invalid("not_yet_valid");
  }
  if (coupon.expires_at !== null && input.now > new Date(coupon.expires_at)) {
    return invalid("expired");
  }
  if (input.subtotalMinor < coupon.min_order_minor) return invalid("below_minimum");
  if (
    coupon.total_usage_limit !== null &&
    input.totalRedemptions >= coupon.total_usage_limit
  ) {
    return invalid("usage_limit_reached");
  }
  if (
    coupon.per_customer_limit !== null &&
    (input.userId !== null || input.phone !== null) &&
    input.customerRedemptions >= coupon.per_customer_limit
  ) {
    return invalid("per_customer_limit_reached");
  }
  if (coupon.first_order_only) {
    if (
      input.userId === null ||
      input.priorOrderCount > 0 ||
      input.priorRedemptionsByUser > 0
    ) {
      return invalid("first_order_only");
    }
  }
  return {
    valid: true,
    reason: null,
    discount_minor: couponDiscountMinor(coupon, input.subtotalMinor),
  };
}

/** "2026-11-15T10:30" in Asia/Dhaka for <input type="datetime-local">. */
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Convert a datetime-local value (interpreted as Dhaka time) to ISO. */
export function fromDatetimeLocal(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00+06:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}+06:00`;
  return null;
}

export function couponValueLabel(coupon: CouponTerms): string {
  const base =
    coupon.kind === "percent"
      ? `${coupon.percent_value ?? 0}% off`
      : `${formatMoney(coupon.fixed_discount_minor ?? 0)} off`;
  if (coupon.max_discount_minor !== null) {
    return `${base} (max ${formatMoney(coupon.max_discount_minor)})`;
  }
  return base;
}

/* ------------------------------------------------------------------ */
/* Row schemas                                                         */
/* ------------------------------------------------------------------ */

export const couponRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  kind: z.enum(["percent", "fixed"]),
  percent_value: z.number().int().nullable(),
  fixed_discount_minor: z.number().int().nullable(),
  min_order_minor: z.number().int(),
  max_discount_minor: z.number().int().nullable(),
  starts_at: z.iso.datetime({ offset: true }).nullable(),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
  total_usage_limit: z.number().int().nullable(),
  per_customer_limit: z.number().int().nullable(),
  first_order_only: z.boolean(),
  active: z.boolean(),
  created_by: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export type CouponRow = z.infer<typeof couponRowSchema>;

export const couponRedemptionRowSchema = z.object({
  id: z.uuid(),
  coupon_id: z.uuid(),
  user_id: z.uuid().nullable(),
  phone: z.string().nullable(),
  order_id: z.uuid().nullable(),
  redeemed_at: z.iso.datetime({ offset: true }),
});

export type CouponRedemptionRow = z.infer<typeof couponRedemptionRowSchema>;

export const couponValidationSchema = z.object({
  valid: z.boolean(),
  reason: z.string().nullable(),
  discount_minor: z.number().int(),
});

export type CouponValidation = z.infer<typeof couponValidationSchema>;

const COUPON_COLUMNS =
  "id,code,kind,percent_value,fixed_discount_minor,min_order_minor,max_discount_minor,starts_at,expires_at,total_usage_limit,per_customer_limit,first_order_only,active,created_by,created_at,updated_at";

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

const REDEMPTION_COUNT_LIMIT = 10000;

/**
 * Reads return null when the live data is UNAVAILABLE (missing table/RPC,
 * failed query, or malformed rows) so pages can degrade honestly with
 * labeled sample data instead of throwing into the error boundary.
 * notFound() is kept for genuinely missing coupons.
 */
export async function readCoupons() {
  const session = await requireStaff(areaRoles("coupons"));
  // Independent queries: run them together instead of sequentially.
  const [couponResult, redemptions] = await Promise.all([
    session.client
      .from("coupons")
      .select(COUPON_COLUMNS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(200),
    session.client
      .from("coupon_redemptions")
      .select("coupon_id")
      .limit(REDEMPTION_COUNT_LIMIT),
  ]);
  if (couponResult.error || redemptions.error) return null;
  const couponsParsed = couponRowSchema.array().safeParse(couponResult.data);
  if (!couponsParsed.success) return null;
  const coupons = couponsParsed.data;

  const counts = new Map<string, number>();
  const countRow = z.object({ coupon_id: z.uuid() });
  const countsParsed = countRow.array().safeParse(redemptions.data);
  if (!countsParsed.success) return null;
  for (const row of countsParsed.data) {
    counts.set(row.coupon_id, (counts.get(row.coupon_id) ?? 0) + 1);
  }
  return {
    coupons: coupons.map((coupon) => ({
      ...coupon,
      usageCount: counts.get(coupon.id) ?? 0,
    })),
    usageTruncated: (redemptions.data?.length ?? 0) >= REDEMPTION_COUNT_LIMIT,
  };
}

export async function readCouponDetail(id: string) {
  const session = await requireStaff(areaRoles("coupons"));
  if (!z.uuid().safeParse(id).success) notFound();
  // Both queries are keyed by the id alone, so they run in parallel.
  const [couponResult, redemptionsResult] = await Promise.all([
    session.client.from("coupons").select(COUPON_COLUMNS).eq("id", id).maybeSingle(),
    session.client
      .from("coupon_redemptions")
      .select("id,coupon_id,user_id,phone,order_id,redeemed_at", { count: "exact" })
      .eq("coupon_id", id)
      .order("redeemed_at", { ascending: false })
      .limit(100),
  ]);
  if (couponResult.error) return null;
  if (!couponResult.data) notFound();
  const couponParsed = couponRowSchema.safeParse(couponResult.data);
  if (!couponParsed.success) return null;
  const coupon = couponParsed.data;

  if (redemptionsResult.error) return null;
  const redemptionsParsed = couponRedemptionRowSchema
    .array()
    .safeParse(redemptionsResult.data);
  if (!redemptionsParsed.success) return null;
  return {
    coupon,
    redemptions: redemptionsParsed.data,
    totalRedemptions: redemptionsResult.count ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Server Actions (writes go through RPCs only)                        */
/* ------------------------------------------------------------------ */

const couponInputSchema = z
  .object({
    id: z.uuid().optional(),
    code: z.string(),
    kind: z.enum(["percent", "fixed"]),
    percent_value: z.number().int().nullable(),
    fixed_discount_minor: z.number().int().nullable(),
    min_order_minor: z.number().int().min(0),
    max_discount_minor: z.number().int().nullable(),
    starts_at: z.iso.datetime({ offset: true }).nullable(),
    expires_at: z.iso.datetime({ offset: true }).nullable(),
    total_usage_limit: z.number().int().nullable(),
    per_customer_limit: z.number().int().nullable(),
    first_order_only: z.boolean(),
    active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "percent") {
      if (value.percent_value === null || value.percent_value < 1 || value.percent_value > 100) {
        ctx.addIssue({ code: "custom", message: "Enter a percent value from 1 to 100." });
      }
      if (value.fixed_discount_minor !== null) {
        ctx.addIssue({ code: "custom", message: "A percent coupon must not have a fixed discount." });
      }
    } else {
      if (value.fixed_discount_minor === null || value.fixed_discount_minor <= 0) {
        ctx.addIssue({ code: "custom", message: "Enter a fixed discount above zero." });
      }
      if (value.percent_value !== null) {
        ctx.addIssue({ code: "custom", message: "A fixed coupon must not have a percent value." });
      }
    }
    if (value.max_discount_minor !== null && value.max_discount_minor <= 0) {
      ctx.addIssue({ code: "custom", message: "Maximum discount must be above zero." });
    }
    if (value.total_usage_limit !== null && value.total_usage_limit <= 0) {
      ctx.addIssue({ code: "custom", message: "Total usage limit must be above zero." });
    }
    if (value.per_customer_limit !== null && value.per_customer_limit <= 0) {
      ctx.addIssue({ code: "custom", message: "Per-customer limit must be above zero." });
    }
    if (
      value.starts_at !== null &&
      value.expires_at !== null &&
      value.starts_at >= value.expires_at
    ) {
      ctx.addIssue({ code: "custom", message: "The coupon must start before it expires." });
    }
  });

function parseOptionalInt(raw: FormDataEntryValue | null): number | null | undefined {
  if (raw === null) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  if (!/^-?\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

export async function saveCoupon(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const kind = formData.get("kind");
  const fixedRaw = formData.get("fixed_discount");
  const percentRaw = formData.get("percent_value");
  const minRaw = formData.get("min_order");
  const maxRaw = formData.get("max_discount");
  const startsRaw = formData.get("starts_at");
  const expiresRaw = formData.get("expires_at");
  const totalLimit = parseOptionalInt(formData.get("total_usage_limit"));
  const perLimit = parseOptionalInt(formData.get("per_customer_limit"));

  const idRaw = formData.get("id");
  const percentValue = parseOptionalInt(percentRaw);
  const fixedText = String(fixedRaw ?? "").trim();
  const fixedMinor = kind === "fixed" ? parseMoneyToMinor(fixedRaw) : null;
  const minText = String(minRaw ?? "").trim();
  const minMinor = minText === "" ? 0 : parseMoneyToMinor(minRaw);
  const maxText = String(maxRaw ?? "").trim();
  const maxMinor = maxText === "" ? null : parseMoneyToMinor(maxRaw);
  const startsAt = startsRaw ? fromDatetimeLocal(String(startsRaw)) : null;
  const expiresAt = expiresRaw ? fromDatetimeLocal(String(expiresRaw)) : null;

  if (kind === "percent" && (percentValue === undefined || percentValue === null)) {
    return actionError("Enter a percent value from 1 to 100.");
  }
  if (kind === "fixed" && (fixedText === "" || fixedMinor === null || fixedMinor <= 0)) {
    return actionError("Enter a fixed discount above zero, for example 150.00.");
  }
  if (minMinor === null) {
    return actionError("Enter a valid minimum order amount, for example 500.00.");
  }
  if (maxMinor === null && maxText !== "") {
    return actionError("Enter a valid maximum discount amount.");
  }
  if (maxMinor !== null && maxMinor <= 0) {
    return actionError("Maximum discount must be above zero.");
  }
  if (totalLimit === undefined || perLimit === undefined) {
    return actionError("Usage limits must be whole numbers.");
  }
  if (
    (startsRaw && String(startsRaw).trim() !== "" && startsAt === null) ||
    (expiresRaw && String(expiresRaw).trim() !== "" && expiresAt === null)
  ) {
    return actionError("Coupon window dates are invalid.");
  }

  const parsed = couponInputSchema.safeParse({
    id: idRaw && String(idRaw) !== "" ? String(idRaw) : undefined,
    code: normalizeCouponCode(String(formData.get("code") ?? "")),
    kind: kind === "percent" || kind === "fixed" ? kind : undefined,
    percent_value: kind === "percent" ? percentValue : null,
    fixed_discount_minor: kind === "fixed" ? fixedMinor : null,
    min_order_minor: minMinor,
    max_discount_minor: maxMinor,
    starts_at: startsAt,
    expires_at: expiresAt,
    total_usage_limit: totalLimit,
    per_customer_limit: perLimit,
    first_order_only: formData.get("first_order_only") === "on",
    active: formData.get("active") === "on",
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(
      first?.message ?? "Check the coupon details and try again.",
    );
  }
  const data = parsed.data;
  if (!/^[A-Z0-9][A-Z0-9_-]{2,29}$/.test(data.code)) {
    return actionError("Coupon code must be 3 to 30 letters, digits, dashes or underscores.");
  }

  const session = await requireStaff(areaRoles("coupons"));
  const result = await session.client.rpc("admin_save_coupon", {
    p_coupon: {
      ...(data.id ? { id: data.id } : {}),
      code: data.code,
      kind: data.kind,
      percent_value: data.percent_value,
      fixed_discount_minor: data.fixed_discount_minor,
      min_order_minor: data.min_order_minor,
      max_discount_minor: data.max_discount_minor,
      starts_at: data.starts_at,
      expires_at: data.expires_at,
      total_usage_limit: data.total_usage_limit,
      per_customer_limit: data.per_customer_limit,
      first_order_only: data.first_order_only,
      active: data.active,
    },
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Coupon could not be saved. Check your access and try again."),
    );
  }
  if (!z.uuid().safeParse(result.data).success) {
    return actionError("The coupon could not be confirmed as saved. Reload and check the list.");
  }
  const couponId = result.data as string;
  revalidatePath("/admin/sales/coupons");
  revalidatePath(`/admin/sales/coupons/${couponId}`);
  redirect(`/admin/sales/coupons/${couponId}`);
}

export async function setCouponActive(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const parsed = z
    .object({ id: z.uuid(), active: z.enum(["true", "false"]) })
    .safeParse({ id: formData.get("id"), active: formData.get("active") });
  if (!parsed.success) return actionError("Enter a valid coupon and status.");
  const session = await requireStaff(areaRoles("coupons"));
  const result = await session.client.rpc("admin_set_coupon_active", {
    target_coupon: parsed.data.id,
    new_active: parsed.data.active === "true",
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Coupon status could not be changed. Try again."),
    );
  }
  revalidatePath("/admin/sales/coupons");
  revalidatePath(`/admin/sales/coupons/${parsed.data.id}`);
  return actionOk(parsed.data.active === "true" ? "Coupon activated." : "Coupon deactivated.");
}

export async function deleteCoupon(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const parsed = z.object({ id: z.uuid() }).safeParse({ id: formData.get("id") });
  if (!parsed.success) return actionError("Enter a valid coupon.");
  const session = await requireStaff(areaRoles("coupons"));
  const result = await session.client.rpc("admin_delete_coupon", {
    target_coupon: parsed.data.id,
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Coupon could not be deleted. Try again."),
    );
  }
  revalidatePath("/admin/sales/coupons");
  redirect("/admin/sales/coupons");
}

export type CouponTestResult =
  | { ok: true; result: CouponValidation }
  | { ok: false; error: string };

/**
 * Eligibility test panel: calls validate_coupon directly. This checks
 * eligibility only; it never applies a coupon (checkout has no coupon
 * parameter yet) and never records a redemption.
 */
export async function testCouponEligibility(input: {
  code: string;
  userId: string;
  phone: string;
  subtotal: string;
}): Promise<CouponTestResult> {
  "use server";
  const code = normalizeCouponCode(input.code ?? "");
  const userId = (input.userId ?? "").trim();
  const phone = (input.phone ?? "").trim();
  const subtotalMinor = parseMoneyToMinor(input.subtotal ?? "");
  if (code === "" || code.length > 30) {
    return { ok: false, error: "Enter a coupon code." };
  }
  if (userId !== "" && !z.uuid().safeParse(userId).success) {
    return { ok: false, error: "Customer account ID must be a valid ID, or leave it blank." };
  }
  if (phone !== "" && !isValidBdPhone(phone)) {
    return { ok: false, error: "Phone must be a Bangladeshi mobile number, or leave it blank." };
  }
  if (subtotalMinor === null) {
    return { ok: false, error: "Enter a valid order subtotal." };
  }
  const session = await requireStaff(areaRoles("coupons"));
  const result = await session.client.rpc("validate_coupon", {
    p_code: code,
    p_user_id: userId === "" ? null : userId,
    p_phone: phone === "" ? null : phone,
    p_subtotal_minor: subtotalMinor,
  });
  if (result.error) {
    return {
      ok: false,
      error: toActionError(result.error, "Eligibility could not be checked. Try again."),
    };
  }
  const parsed = couponValidationSchema.safeParse(result.data);
  if (!parsed.success) {
    return { ok: false, error: "Eligibility could not be checked. Try again." };
  }
  return { ok: true, result: parsed.data };
}
