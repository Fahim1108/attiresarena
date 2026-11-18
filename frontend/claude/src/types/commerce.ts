import type { ID, Money, ProductImage } from "./catalog";

export interface CartItem {
  /** Unique line id = `${productId}:${variantId}` */
  id: string;
  productId: ID;
  productSlug: string;
  variantId: ID;
  name: string;
  brandName: string;
  image: ProductImage;
  colorName: string;
  size: string;
  unitPrice: Money;
  compareAtPrice?: Money;
  quantity: number;
  maxQuantity: number;
}

/**
 * A coupon validated by the server. The discount is the exact amount the
 * `validate_coupon` RPC returned for one exact subtotal and phone — the
 * browser never computes coupon math. When the cart subtotal or the phone
 * changes, the coupon is stale until it is re-validated.
 */
export interface Coupon {
  /** Normalized code (trimmed, upper-case), exactly as the server validated it. */
  code: string;
  /** Discount in minor units (paisa) returned by `validate_coupon`. */
  discountMinor: number;
  /** Cart subtotal in minor units the discount was validated against. */
  validatedSubtotalMinor: number;
  /** Phone the discount was validated against (null when checked without one). */
  validatedPhone: string | null;
}

export interface OrderSummary {
  itemCount: number;
  subtotal: Money;
  discount: Money;
  deliveryCharge: Money;
  total: Money;
  coupon?: Coupon;
}

export type PaymentMethod = "cod" | "online";

export type DeliveryZone = "inside-dhaka" | "outside-dhaka";

export interface CheckoutPayload {
  customer: { fullName: string; phone: string; email?: string };
  address: Omit<Address, "id" | "isDefault" | "label">;
  paymentMethod: PaymentMethod;
  items: { productId: ID; variantId: ID; quantity: number }[];
  couponCode?: string;
  note?: string;
  saveAddress: boolean;
}

export interface Address {
  id: ID;
  label: string;
  fullName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  addressLine: string;
  isDefault: boolean;
}

export interface Customer {
  id: ID;
  fullName: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  memberSince: string;
  addresses: Address[];
}

export type OrderStatus = "pending" | "confirmed" | "packed" | "shipped" | "out-for-delivery" | "delivered" | "cancelled" | "returned";

export interface OrderLine {
  productId: ID;
  productSlug: string;
  name: string;
  image: ProductImage;
  colorName: string;
  size: string;
  quantity: number;
  unitPrice: Money;
}

export interface OrderTimelineEvent {
  status: OrderStatus;
  label: string;
  at?: string;
  description?: string;
}

export interface Order {
  id: ID;
  orderNumber: string;
  placedAt: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: "unpaid" | "paid" | "refunded";
  lines: OrderLine[];
  summary: OrderSummary;
  shippingAddress: Omit<Address, "id" | "isDefault">;
  timeline: OrderTimelineEvent[];
  courier?: { name: string; trackingCode: string };
}

/**
 * Result shape returned by any action that requires a backend.
 * The mock adapter always returns `{ ok: false, reason: "not_connected" }`
 * so the UI never claims a successful order, payment, or sign-in.
 * A success may carry an optional `message` notice (e.g. a partial
 * save where one part did not persist); failures always carry one.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; reason: "not_connected" | "validation" | "error"; message: string };
