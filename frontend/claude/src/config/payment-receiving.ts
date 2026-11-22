import { isValidBdPhone, normalizePhone } from "@/lib/validation";
import type { AdvancePolicy, ManualPaymentConfiguration } from "@/types/manual-payment";
import { DEFAULT_DELIVERY_SETTINGS, type DeliverySettings } from "@/lib/delivery-settings";

export interface PaymentReceivingConfig {
  bkashNumber: string;
  nagadNumber: string;
  bkashAuthorized: boolean;
  nagadAuthorized: boolean;
}

/**
 * Receiving details for the isolated Preview / design-review adapter.
 * They come ONLY from owner-set env vars (MANUAL_PAYMENT_BKASH_NUMBER /
 * MANUAL_PAYMENT_NAGAD_NUMBER) — the same vars production collects
 * from. No receiving number is hardcoded in the repo: a temporary
 * preview number was removed after the 2026-11-21 security audit (a
 * live payment number must never sit in git). With no numbers set, the
 * preview shows no destinations ("Awaiting account authorisation").
 * Collection is NEVER enabled from this config (available: false): the
 * preview only displays what production would show; placing an order
 * still goes through the production path.
 */
export function previewReceivingConfiguration(): PaymentReceivingConfig {
  const bkash = normalizePhone(process.env.MANUAL_PAYMENT_BKASH_NUMBER ?? "");
  const nagad = normalizePhone(process.env.MANUAL_PAYMENT_NAGAD_NUMBER ?? "");
  return {
    bkashNumber: bkash,
    nagadNumber: nagad,
    bkashAuthorized: isValidBdPhone(bkash),
    nagadAuthorized: isValidBdPhone(nagad),
  };
}

export function previewPaymentConfiguration(
  receiving = previewReceivingConfiguration(),
  delivery: DeliverySettings = DEFAULT_DELIVERY_SETTINGS,
): ManualPaymentConfiguration {
  const destinations: ManualPaymentConfiguration["destinations"] = [];
  if (receiving.bkashAuthorized && isValidBdPhone(normalizePhone(receiving.bkashNumber))) destinations.push({ provider: "bkash", recipientNumber: normalizePhone(receiving.bkashNumber), accountType: "personal", transferInstructions: "" });
  if (receiving.nagadAuthorized && isValidBdPhone(normalizePhone(receiving.nagadNumber))) destinations.push({ provider: "nagad", recipientNumber: normalizePhone(receiving.nagadNumber), accountType: "personal", transferInstructions: "" });
  // Recipient approval is NOT an authorization to collect, persist or verify.
  // The advance amounts come from the saved delivery settings, never
  // hardcoded: changing the district or charges in admin changes the
  // advance shown here too.
  return { available: false, destinations, policy: { insideMinor: delivery.insideChargeMinor, outsideMinor: delivery.outsideChargeMinor, insideDistrict: delivery.insideDistrict, credit: "against-order-total" } };
}

/**
 * Production collection, authorized ONLY by server env vars the owner sets
 * (MANUAL_PAYMENT_BKASH_NUMBER / MANUAL_PAYMENT_NAGAD_NUMBER, Vercel env
 * vars, never in code). A provider is collectable only when its number is set
 * and a valid Bangladeshi mobile number; with no numbers set, collection
 * stays off and no order can be placed (fail closed).
 */
export function productionPaymentConfiguration(policy: AdvancePolicy): ManualPaymentConfiguration {
  const destinations: ManualPaymentConfiguration["destinations"] = [];
  const bkash = normalizePhone(process.env.MANUAL_PAYMENT_BKASH_NUMBER ?? "");
  const nagad = normalizePhone(process.env.MANUAL_PAYMENT_NAGAD_NUMBER ?? "");
  if (isValidBdPhone(bkash)) destinations.push({ provider: "bkash", recipientNumber: bkash, accountType: "personal", transferInstructions: "" });
  if (isValidBdPhone(nagad)) destinations.push({ provider: "nagad", recipientNumber: nagad, accountType: "personal", transferInstructions: "" });
  return { available: destinations.length > 0, destinations, policy };
}
