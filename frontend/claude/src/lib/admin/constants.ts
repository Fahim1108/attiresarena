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

export const PAYMENT_STATUSES = ["unpaid", "paid", "refunded"] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Legal payment-status moves, mirroring the admin_set_payment_status RPC
 * (migration 20261116000100) exactly. paid → unpaid is forbidden and
 * refunded is terminal. There is no order-status precondition. The RPC
 * enforces this table server-side; the UI must only offer these moves.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  unpaid: ["paid", "refunded"],
  paid: ["refunded"],
  refunded: [],
};

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return (
    typeof value === "string" &&
    (PAYMENT_STATUSES as readonly string[]).includes(value)
  );
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  refunded: "Refunded",
};

/**
 * Order statuses from which a Steadfast booking is allowed (coordinator
 * decision). Lives here — not in courier.ts — because the client-side
 * booking panel needs it and courier.ts is server-only. The
 * admin_record_shipment RPC enforces the same rule server-side, so a
 * bypassed client is still refused.
 */
export const BOOKABLE_ORDER_STATUSES: readonly OrderStatus[] = ["confirmed", "packed"];

export function canBookCourier(status: OrderStatus): boolean {
  return BOOKABLE_ORDER_STATUSES.includes(status);
}

/**
 * Database roles from the user_roles CHECK constraint. The first six are
 * the original roles; moderator, editor and admin are added by migration
 * 20261115001000_admin_v2_roles_permissions.sql, which widens the CHECK
 * constraints on user_roles.role and role_permissions.role. Until that
 * migration applies, assigning a new role fails server-side (the RPC and
 * the CHECK reject it) — the UI must never assume the new roles exist.
 * Order here is the display order in the User role UI (broadest first).
 */
export const STAFF_ROLES = [
  "owner",
  "admin",
  "editor",
  "moderator",
  "product_manager",
  "order_manager",
  "customer_support",
  "marketing_manager",
  "analyst",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  moderator: "Moderator",
  product_manager: "Product Manager",
  order_manager: "Order Manager",
  customer_support: "Customer Support",
  marketing_manager: "Marketing Manager",
  analyst: "Analyst",
};

/** Business-friendly role groups used by the User role UI. */
export const STAFF_ROLE_GROUPS: Record<StaffRole, "Owner" | "Admin" | "Staff"> =
  {
    owner: "Owner",
    admin: "Admin",
    editor: "Staff",
    moderator: "Staff",
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
 * (foundation + Step 1/Step 2 widenings). The next six are added by
 * migration 20261115000100_admin_panel_permissions.sql following the same
 * precedent. costs.read is added by migration
 * 20261115001000_admin_v2_roles_permissions.sql: it gates product cost
 * prices, which moderators and editors must never see.
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
  costsRead: "costs.read",
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly PermissionName[] = [
  PERMISSIONS.catalogueRead,
  PERMISSIONS.catalogueManage,
  PERMISSIONS.inventoryRead,
  PERMISSIONS.inventoryAdjust,
  PERMISSIONS.checkoutRecover,
  PERMISSIONS.ordersRead,
  PERMISSIONS.ordersManage,
  PERMISSIONS.customersRead,
  PERMISSIONS.couponsManage,
  PERMISSIONS.contentManage,
  PERMISSIONS.settingsManage,
  PERMISSIONS.usersManage,
  PERMISSIONS.analyticsRead,
  PERMISSIONS.costsRead,
];

export function isPermissionName(value: unknown): value is PermissionName {
  return (
    typeof value === "string" &&
    (ALL_PERMISSIONS as readonly string[]).includes(value)
  );
}

export const PERMISSION_LABELS: Record<PermissionName, string> = {
  "catalogue.read": "View products and categories",
  "catalogue.manage": "Manage products and categories",
  "inventory.read": "View inventory",
  "inventory.adjust": "Adjust inventory",
  "checkout.recover": "Recover incomplete orders",
  "orders.read": "View orders",
  "orders.manage": "Manage orders",
  "customers.read": "View customers",
  "coupons.manage": "Manage coupons",
  "content.manage": "Manage content and banners",
  "settings.manage": "Manage settings and integrations",
  "users.manage": "Manage users and roles",
  "analytics.read": "View analytics",
  "costs.read": "View product cost prices",
};

/** Permission checkboxes in the User role UI, grouped by section. */
export const PERMISSION_GROUPS: readonly {
  section: string;
  permissions: readonly PermissionName[];
}[] = [
  { section: "Catalogue", permissions: ["catalogue.read", "catalogue.manage"] },
  { section: "Inventory", permissions: ["inventory.read", "inventory.adjust"] },
  { section: "Orders", permissions: ["orders.read", "orders.manage", "checkout.recover"] },
  { section: "Customers", permissions: ["customers.read"] },
  { section: "Coupons", permissions: ["coupons.manage"] },
  { section: "Content", permissions: ["content.manage"] },
  { section: "Analytics", permissions: ["analytics.read"] },
  { section: "Costs", permissions: ["costs.read"] },
  { section: "Settings and users", permissions: ["settings.manage", "users.manage"] },
];

/**
 * Default permissions granted to each role by the migrations. This mirror
 * must match the role_permissions seed rows in migrations 001 and 010
 * exactly; it is used only to explain role-granted access in the UI when
 * the live permission rows cannot be read. The database is authoritative:
 * effective access is always role grants plus per-user grants, checked
 * server-side by private.has_permission.
 *
 * Deliberate exclusions: only owner and product_manager/admin hold
 * costs.read (moderators and editors never see cost prices); only owner
 * holds settings.manage and users.manage, so settings and user management
 * stay owner-only even for the admin role.
 */
export const ROLE_PERMISSION_DEFAULTS: Record<StaffRole, readonly PermissionName[]> = {
  owner: ALL_PERMISSIONS,
  admin: [
    "catalogue.read",
    "catalogue.manage",
    "inventory.read",
    "inventory.adjust",
    "checkout.recover",
    "orders.read",
    "orders.manage",
    "customers.read",
    "coupons.manage",
    "content.manage",
    "analytics.read",
    "costs.read",
  ],
  editor: ["catalogue.read", "catalogue.manage", "inventory.read", "content.manage", "coupons.manage"],
  moderator: [
    "catalogue.read",
    "inventory.read",
    "checkout.recover",
    "orders.read",
    "customers.read",
    "analytics.read",
  ],
  product_manager: [
    "catalogue.read",
    "catalogue.manage",
    "inventory.read",
    "inventory.adjust",
    "costs.read",
  ],
  order_manager: [
    "catalogue.read",
    "inventory.read",
    "checkout.recover",
    "orders.read",
    "orders.manage",
    "customers.read",
    "analytics.read",
  ],
  customer_support: ["orders.read", "customers.read"],
  marketing_manager: ["coupons.manage", "content.manage", "analytics.read"],
  analyst: ["catalogue.read", "inventory.read", "orders.read", "analytics.read"],
};

/** Roles whose holders may view product cost prices (see costs.read). */
export const COST_VIEWING_ROLES: readonly StaffRole[] = [
  "owner",
  "admin",
  "product_manager",
];

/** Which database roles may hold each admin area (server-side enforcement). */
export const AREA_ROLES: Record<string, readonly StaffRole[]> = {
  catalogue: ["owner", "admin", "editor", "product_manager"],
  inventory: ["owner", "admin", "editor", "product_manager"],
  orders: ["owner", "admin", "moderator", "order_manager"],
  recovery: ["owner", "admin", "moderator", "order_manager", "customer_support"],
  customers: ["owner", "admin", "moderator", "order_manager", "customer_support"],
  coupons: ["owner", "admin", "editor", "marketing_manager"],
  content: ["owner", "admin", "editor", "marketing_manager"],
  settings: ["owner"],
  users: ["owner"],
  analytics: ["owner", "admin", "moderator", "order_manager", "marketing_manager", "analyst"],
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
  "4XL",
  "5XL",
  "6XL",
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
