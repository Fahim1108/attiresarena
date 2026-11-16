"use server";

/**
 * Server Actions callable from client components. Each one delegates to the
 * active data source. The customer slice is connected (see
 * src/services/adapters/customer.ts): validation and session checks run
 * inside the customer actions. Newsletter/contact/storefront/media
 * mutations still return `{ ok: false, reason: "not_connected" }`.
 */
import type { Address, CheckoutPayload, Customer, StorefrontSettings } from "@/types";
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
  return dataSource.placeOrder(payload);
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
