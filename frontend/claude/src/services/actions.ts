"use server";

/**
 * Server Actions callable from client components. Each one delegates to the
 * active data source. The customer slice is connected (see
 * src/services/adapters/customer.ts): validation and session checks run
 * inside the customer actions. Newsletter/contact/media
 * mutations still return `{ ok: false, reason: "not_connected" }`.
 * (The old storefront draft/publish actions were removed with the
 * orphaned Appearance Editor, which could never save anything.)
 */
import type { Address, CheckoutPayload, Customer } from "@/types";
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
    return { ok: false as const, reason: "validation" as const, message: "অগ্রিম পেমেন্টের তথ্য দিন — bKash/Nagad Transaction ID আর আপনার নম্বর ছাড়া অর্ডার হবে না।" };
  }
  if (!configuration.destinations.some((d) => d.provider === parsed.data.provider)) {
    return { ok: false as const, reason: "not_connected" as const, message: "Payment submission is unavailable. No order was placed. Do not send money." };
  }
  // The TxID + sender number travel twice: as the structured p_payment
  // argument (migration 20261121000100 records a payment_submissions
  // row in the same transaction as the order) AND on the order note,
  // which is kept until the new admin verification UI is live-verified.
  // Admin verifies the submission from the order detail, then confirms
  // the order. The courier payload strips the note line.
  return dataSource.placeOrder({
    ...payload,
    payment: {
      provider: parsed.data.provider,
      transactionId: parsed.data.transactionId,
      senderNumber: parsed.data.senderNumber,
      idempotencyKey: parsed.data.idempotencyKey,
    },
    note: buildOrderNote(parsed.data, payload.note),
  });
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

export async function uploadMediaAction(file: { name: string; type: string; size: number }) {
  return dataSource.uploadMedia(file);
}
