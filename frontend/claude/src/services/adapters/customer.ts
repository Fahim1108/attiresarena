import "server-only";
import { trackingRpcConfiguration } from "@/lib/checkout/config";
import {
  deleteCustomerAddressAction,
  registerCustomer,
  requestCustomerPasswordReset,
  saveCustomerAddressAction,
  signInCustomer,
  submitCustomerReviewAction,
  updateCustomerProfile,
  uploadCustomerReviewPhotoAction,
} from "@/lib/customer/actions";
import { readCustomerAddresses } from "@/lib/customer/addresses";
import {
  customerSession,
  metadataDisplayName,
  readCustomerProfile,
} from "@/lib/customer/session";
import {
  orderMediaMap,
  normalizeTrackingPhone,
  parseCustomerOrderNumber,
  readCustomerOrderByNumber,
  readCustomerOrders,
  type CustomerOrderMedia,
} from "@/lib/customer/orders";
import { trackGuestOrderByPhone } from "@/lib/customer/tracking";
import type { Customer } from "@/types";
import type { StorefrontDataSource } from "../types";
import { rpcFor } from "../checkout";
import { publishedShirts } from "./published-thrift";

/**
 * Connected customer slice: the replacement for the customer methods
 * of unavailableServices. Spread over unavailableServices in
 * owner-catalogue.ts; newsletter/contact/storefront-draft/media/upload
 * stay unavailable.
 *
 * Reads use the customer client (own-row RLS + explicit user_id
 * filters). The one exception is the guest order lookup in
 * getOrderByNumber: guests have no session, so it goes through the
 * server-only tracking function (lib/customer/tracking.ts), which
 * checks order number + phone itself. Mutations delegate to the
 * customer server actions, which validate and authenticate inside
 * themselves. No mock/demo customer data is ever returned here.
 */

async function orderMedia(): Promise<Map<string, CustomerOrderMedia>> {
  return orderMediaMap(await publishedShirts());
}

export const customerServices = {
  async getCurrentCustomer(): Promise<Customer | null> {
    const session = await customerSession();
    if (!session) return null;
    const { client, user } = session;
    const [profile, addresses] = await Promise.all([
      readCustomerProfile(client, user.id),
      readCustomerAddresses(client, user.id),
    ]);
    return {
      id: user.id,
      fullName:
        profile.displayName ||
        metadataDisplayName(user.user_metadata) ||
        "",
      email: user.email ?? "",
      phone: profile.phone,
      memberSince: user.created_at,
      addresses,
    };
  },

  async getOrders() {
    const session = await customerSession();
    if (!session) return [];
    return readCustomerOrders(
      session.client,
      session.user.id,
      await orderMedia(),
    );
  },

  /**
   * Order lookup by number + phone. Signed-in customers first try
   * their own order (no phone needed); anything else goes through
   * the guest path, which requires the phone that matches the order
   * and returns null without it. The old signed-in-only rule
   * (decision D14) is superseded by the owner-approved guest
   * tracking fix (2026-11-19): the phone is a second factor the
   * customer already knows, checked inside the server-only
   * tracking function, and a miss never reveals whether the number
   * or the phone was wrong. Unknown numbers and other customers'
   * numbers both yield null so the detail page answers notFound().
   */
  async getOrderByNumber(orderNumber: string, phone?: string) {
    const parsed = parseCustomerOrderNumber(orderNumber);
    if (parsed === null) return null;
    const session = await customerSession();
    if (session) {
      const own = await readCustomerOrderByNumber(
        session.client,
        session.user.id,
        parsed,
        await orderMedia(),
      );
      if (own) return own;
    }
    const canonicalPhone = normalizeTrackingPhone(phone ?? "");
    if (canonicalPhone === null) return null;
    const config = trackingRpcConfiguration();
    if (!config) return null;
    return trackGuestOrderByPhone(
      rpcFor(config),
      parsed,
      canonicalPhone,
      await orderMedia(),
    );
  },

  async signIn(input: { email: string; password: string }) {
    return signInCustomer(input);
  },
  async register(input: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
  }) {
    return registerCustomer(input);
  },
  async requestPasswordReset(input: { email: string }) {
    return requestCustomerPasswordReset(input);
  },
  async updateProfile(input: { fullName: string; phone: string }) {
    return updateCustomerProfile(input);
  },
  async saveAddress(address) {
    return saveCustomerAddressAction(address);
  },
  async deleteAddress(addressId: string) {
    return deleteCustomerAddressAction(addressId);
  },
  async submitReview(input) {
    return submitCustomerReviewAction(input);
  },
  async uploadReviewPhoto(reviewId, file, position) {
    return uploadCustomerReviewPhotoAction(reviewId, file, position);
  },
} satisfies Pick<
  StorefrontDataSource,
  | "getCurrentCustomer"
  | "getOrders"
  | "getOrderByNumber"
  | "signIn"
  | "register"
  | "requestPasswordReset"
  | "updateProfile"
  | "saveAddress"
  | "deleteAddress"
  | "submitReview"
  | "uploadReviewPhoto"
>;
