import { isValidBdPhone, normalizePhone } from "@/lib/validation";
import type { AdvancePolicy, ManualPaymentConfiguration } from "@/types/manual-payment";

// Temporary editable configuration for the isolated Preview. These are public
// receiving details, not gateway credentials. Replace with an authorized DAL.
const temporaryReceivingNumber = "01635706962";
export const paymentReceiving = {
  bkashNumber: temporaryReceivingNumber,
  nagadNumber: temporaryReceivingNumber,
  // Confirmed by the store owner in this session, not a gateway verification.
  bkashAuthorized: true,
  nagadAuthorized: true,
};

export function previewPaymentConfiguration(receiving = paymentReceiving): ManualPaymentConfiguration {
  const destinations: ManualPaymentConfiguration["destinations"] = [];
  if (receiving.bkashAuthorized) destinations.push({ provider: "bkash", recipientNumber: receiving.bkashNumber, accountType: "personal", transferInstructions: "" });
  if (receiving.nagadAuthorized) destinations.push({ provider: "nagad", recipientNumber: receiving.nagadNumber, accountType: "personal", transferInstructions: "" });
  // Recipient approval is NOT an authorization to collect, persist or verify.
  return { available: false, destinations, policy: { insideDhakaMinor: 7000, outsideDhakaMinor: 13000, credit: "against-order-total" } };
}

/**
 * Production collection, authorized ONLY by server env vars the owner sets
 * (MANUAL_PAYMENT_BKASH_NUMBER / MANUAL_PAYMENT_NAGAD_NUMBER, Vercel env
 * vars, never in code). The hardcoded preview number above is never a live
 * receiving account. A provider is collectable only when its number is set
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
