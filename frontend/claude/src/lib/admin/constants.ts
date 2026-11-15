/**
 * Shared constants for the production-capable admin panel.
 *
 * Source of truth notes (verified from supabase/migrations/*.sql):
 * - Order statuses are fixed by the orders CHECK constraint: the 8 values in
 *   ORDER_STATUSES. "Processing" is NOT in the database set; the UI must use
 *   these 8 values only. See the build report for the owner decision.
 * - Order transitions are enforced by the guard_order_update trigger; the UI
 *   must only offer transitions listed in ORDER_TRANSITIONS.
 * - Product statuses are fixed by the products CHECK constraint
 *   ('draft','published','archived'). The UI never exposes a "Draft" status:
 *   published maps to Active, everything else maps to Inactive.
 * - Variant SKUs exist in the database (NOT NULL UNIQUE) but are never shown
 *   or entered in the UI; the server generates internal values on create.
 */

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "out-for-delivery",
  "delivered",
  "cancelled",
  "returned",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  packed: "Packed",
  shipped: "Shipped",
  "out-for-delivery": "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
};

/** Badge tones: info | success | warning | danger | neutral. */
export const ORDER_STATUS_TONES: Record<
  OrderStatus,
  "info" | "success" | "warning" | "danger" | "neutral"
> = {
  pending: "warning",
  confirmed: "info",
  packed: "info",
  shipped: "info",
  "out-for-delivery": "info",
  delivered: "success",
  cancelled: "danger",
  returned: "neutral",
};

/** Legal next statuses, mirroring the guard_order_update trigger exactly. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["out-for-delivery", "delivered", "returned"],
  "out-for-delivery": ["delivered", "returned"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: "Cash on Delivery",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  refunded: "Refunded",
};

/** Database roles from the user_roles CHECK constraint. */
export const STAFF_ROLES = [
  "owner",
  "product_manager",
  "order_manager",
  "customer_support",
  "marketing_manager",
  "analyst",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  product_manager: "Product Manager",
  order_manager: "Order Manager",
  customer_support: "Customer Support",
  marketing_manager: "Marketing Manager",
  analyst: "Analyst",
};

/** Business-friendly role groups used by the admin-users UI. */
export const STAFF_ROLE_GROUPS: Record<StaffRole, "Owner" | "Admin" | "Staff"> =
  {
    owner: "Owner",
    product_manager: "Admin",
    order_manager: "Admin",
    marketing_manager: "Admin",
    customer_support: "Staff",
    analyst: "Staff",
  };

export function isStaffRole(value: unknown): value is StaffRole {
  return (
    typeof value === "string" &&
    (STAFF_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Permission names. The first seven already exist in role_permissions
 * (foundation + Step 1/Step 2 widenings). The rest are added by migration
 * 20261115000100_admin_panel_permissions.sql following the same precedent.
 */
export const PERMISSIONS = {
  catalogueRead: "catalogue.read",
  catalogueManage: "catalogue.manage",
  inventoryRead: "inventory.read",
  inventoryAdjust: "inventory.adjust",
  checkoutRecover: "checkout.recover",
  ordersRead: "orders.read",
  ordersManage: "orders.manage",
  customersRead: "customers.read",
  couponsManage: "coupons.manage",
  contentManage: "content.manage",
  settingsManage: "settings.manage",
  usersManage: "users.manage",
  analyticsRead: "analytics.read",
} as const;

/** Which database roles may hold each admin area (server-side enforcement). */
export const AREA_ROLES: Record<string, readonly StaffRole[]> = {
  catalogue: ["owner", "product_manager"],
  inventory: ["owner", "product_manager"],
  orders: ["owner", "order_manager"],
  recovery: ["owner", "order_manager", "customer_support"],
  customers: ["owner", "order_manager", "customer_support"],
  coupons: ["owner", "marketing_manager"],
  content: ["owner", "marketing_manager"],
  settings: ["owner"],
  users: ["owner"],
  analytics: ["owner", "order_manager", "marketing_manager", "analyst"],
};

/** Owner can do everything; every area check must include "owner". */
export function areaRoles(area: string): readonly StaffRole[] {
  const roles = AREA_ROLES[area] ?? [];
  return roles.includes("owner") ? roles : ["owner", ...roles];
}

/** Product display status in the new admin UI (never "Draft"). */
export type ProductDisplayStatus = "active" | "inactive" | "out-of-stock";

export function productDisplayStatus(
  dbStatus: string,
  hasAvailableStock: boolean,
): ProductDisplayStatus {
  if (dbStatus === "published" && !hasAvailableStock) return "out-of-stock";
  return dbStatus === "published" ? "active" : "inactive";
}

export const PRODUCT_DISPLAY_LABELS: Record<ProductDisplayStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  "out-of-stock": "Out of Stock",
};

export const SIZE_OPTIONS = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "3XL",
] as const;

export const PRODUCT_BADGES = [
  "Featured Product",
  "Best Seller",
  "New Arrival",
  "Premium Collection",
  "Free Delivery",
] as const;

export const RECOVERY_STATUSES = [
  "pending",
  "contacted",
  "lost",
  "recovered",
] as const;

export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];

export const RECOVERY_STATUS_LABELS: Record<RecoveryStatus, string> = {
  pending: "Pending",
  contacted: "Contacted",
  lost: "Lost",
  recovered: "Recovered",
};

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Storage bucket reused from the existing gallery/media code. */
export const PRODUCT_MEDIA_BUCKET = "attires-product-drafts";

/** Maximum product images per product (product_media position 0..19). */
export const MAX_PRODUCT_IMAGES = 20;
