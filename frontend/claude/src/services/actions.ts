"use server";

/**
 * Server Actions callable from client components. Each one delegates to the
 * active data source. The customer slice is connected (see
 * src/services/adapters/customer.ts): validation and session checks run
 * inside the customer actions. Newsletter/contact/storefront/media
 * mutations still return `{ ok: false, reason: "not_connected" }`.
 */
import type { Address, CheckoutPayload, Customer, StorefrontSettings } from "@/types";
import { buildOrderNote, validatePaymentDetails } from "@/lib/manual-payment";
import { dataSource } from "./adapters";
import { saveCheckoutProgress } from "./checkout";

export async function searchSuggestionsAction(term: string) {
  return dataSource.searchSuggestions(term.slice(0, 80), 6);
}

export async function getProductsByIdsAction(ids: string[]) {
  return dataSource.getProductsByIds(ids.slice(0, 100));
}

export async function getOrderByNumberAction(orderNumber: string, phone?: string) {
  return dataSource.getOrderByNumber(orderNumber, phone);
}

/** Stores contact details and cart contents once the delivery step is completed. */
export async function saveCheckoutProgressAction(input: unknown) {
  return saveCheckoutProgress(input);
}

export async function placeOrderAction(payload: CheckoutPayload) {
  // Config gate FIRST, fail closed: without payment collection there is no
  // order at all. This also preserves the disconnected-preview contract
  // (no payment details on file there, and the action reports not_connected).
  const configuration = await dataSource.getManualPaymentConfiguration();
  if (!configuration.available) {
    return { ok: false as const, reason: "not_connected" as const, message: "Payment submission is unavailable. No order was placed. Do not send money." };
  }
  // Advance payment details are required: no TxID + sender number, no order.
  // The server re-validates everything the browser sent; the client check is
  // convenience only and never the gate.
  const parsed = validatePaymentDetails({ ...(payload.payment ?? {}), note: "", orderReference: null });
  if (!parsed.ok) {
    return { ok: false as const, reason: "validation" as const, message: "Enter your advance payment details — no order can be placed without a bKash/Nagad Transaction ID and your number." };
  }
  if (!configuration.destinations.some((d) => d.provider === parsed.data.provider)) {
    return { ok: false as const, reason: "not_connected" as const, message: "Payment submission is unavailable. No order was placed. Do not send money." };
  }
  // The TxID + sender number travel on the order note (no payment-submissions
  // table exists yet); admin verifies them from the order detail, then
  // confirms the order. The courier payload strips this line.
  return dataSource.placeOrder({ ...payload, note: buildOrderNote(parsed.data, payload.note) });
}

export async function signInAction(input: { email: string; password: string }) {
  return dataSource.signIn(input);
}

export async function registerAction(input: { fullName: string; email: string; phone: string; password: string }) {
  return dataSource.register(input);
}

export async function requestPasswordResetAction(input: { email: string }) {
  return dataSource.requestPasswordReset(input);
}

export async function updateProfileAction(input: Pick<Customer, "fullName" | "phone">) {
  return dataSource.updateProfile(input);
}

export async function saveAddressAction(address: Address) {
  return dataSource.saveAddress(address);
}

export async function deleteAddressAction(addressId: string) {
  return dataSource.deleteAddress(addressId);
}

export async function submitReviewAction(input: {
  productId: string;
  rating: number;
  title: string;
  body: string;
}) {
  return dataSource.submitReview(input);
}

export async function subscribeNewsletterAction(email: string) {
  return dataSource.subscribeNewsletter(email);
}

export async function submitContactFormAction(input: { name: string; email: string; phone?: string; subject: string; message: string }) {
  return dataSource.submitContactForm(input);
}

export async function saveStorefrontDraftAction(settings: StorefrontSettings) {
  return dataSource.saveStorefrontDraft(settings);
}

export async function publishStorefrontSettingsAction(settings: StorefrontSettings) {
  return dataSource.publishStorefrontSettings(settings);
}

export async function uploadMediaAction(file: { name: string; type: string; size: number }) {
  return dataSource.uploadMedia(file);
}
