import "server-only";
import {
  deleteCustomerAddressAction,
  registerCustomer,
  requestCustomerPasswordReset,
  saveCustomerAddressAction,
  signInCustomer,
  submitCustomerReviewAction,
  updateCustomerProfile,
} from "@/lib/customer/actions";
import { readCustomerAddresses } from "@/lib/customer/addresses";
import {
  customerSession,
  metadataDisplayName,
  readCustomerProfile,
} from "@/lib/customer/session";
import {
  orderMediaMap,
  parseCustomerOrderNumber,
  readCustomerOrderByNumber,
  readCustomerOrders,
  type CustomerOrderMedia,
} from "@/lib/customer/orders";
import type { Customer } from "@/types";
import type { StorefrontDataSource } from "../types";
import { publishedShirts } from "./published-thrift";

/**
 * Connected customer slice: the replacement for the customer methods
 * of unavailableServices. Spread over unavailableServices in
 * owner-catalogue.ts; newsletter/contact/storefront-draft/media/upload
 * stay unavailable.
 *
 * Reads use the customer client (own-row RLS + explicit user_id
 * filters). Mutations delegate to the customer server actions, which
 * validate and authenticate inside themselves. No mock/demo customer
 * data is ever returned here.
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
   * Signed-in customers only; the legacy phone parameter is
   * intentionally not accepted — phone must never authorise access
   * (decision D14). Unknown numbers and other customers' numbers both
   * yield null so the detail page answers notFound().
   */
  async getOrderByNumber(orderNumber: string) {
    const session = await customerSession();
    if (!session) return null;
    const parsed = parseCustomerOrderNumber(orderNumber);
    if (parsed === null) return null;
    return readCustomerOrderByNumber(
      session.client,
      session.user.id,
      parsed,
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
>;
