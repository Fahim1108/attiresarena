/**
 * Display-only sample data for the sales + notifications surfaces (owner
 * items 7 + 14). See lib/admin/sample-data.ts for the contract:
 *
 * - These rows render ONLY when a live loader returns null (unavailable).
 *   A live empty list renders an honest empty state, never these rows.
 * - EVERY surface rendering them must also render <SampleBadge />.
 * - Sample data is NEVER persisted, NEVER sent in a mutation, and NEVER
 *   mixed into real totals. Sample rows carry no working write actions and
 *   no detail links.
 * - Nothing here feeds analytics, profit, revenue, or the dashboard.
 *
 * `import type` ONLY: no server-only code may leak into any bundle through
 * this module. All values are fixed (no Date.now / randomness) so renders
 * are deterministic.
 */

import type {
  OrderHistoryEntry,
  OrderItemView,
  OrderNotice,
  OrderRow,
  readOrderDetail,
} from "./orders";
import type {
  CheckoutItemRow,
  CheckoutItemView,
  IncompleteSessionView,
  readIncompleteDetail,
} from "./incomplete";
import type { CustomerListEntry, readCustomerProfile } from "./customers";
import type { readCouponDetail, readCoupons } from "./coupons";

export type OrderDetailData = NonNullable<Awaited<ReturnType<typeof readOrderDetail>>>;
export type IncompleteDetailData = NonNullable<
  Awaited<ReturnType<typeof readIncompleteDetail>>
>;
export type CustomerProfileData = NonNullable<
  Awaited<ReturnType<typeof readCustomerProfile>>
>;
export type CouponDetailData = NonNullable<Awaited<ReturnType<typeof readCouponDetail>>>;
export type CouponListEntry = NonNullable<Awaited<ReturnType<typeof readCoupons>>>["coupons"][number];

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

const SAMPLE_PRODUCT_ID = "51000000-0000-4000-8000-000000000001";
const SAMPLE_VARIANT_ID = "51000000-0000-4000-8000-000000000002";

export const SAMPLE_ORDERS: OrderRow[] = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    order_number: 10001,
    user_id: null,
    customer_name: "Ayesha Rahman",
    phone: "01700000001",
    email: null,
    division: "Dhaka",
    district: "Dhaka",
    area: "Mirpur",
    address_line: "House 1, Road 2",
    note: null,
    payment_method: "cod",
    payment_status: "unpaid",
    status: "pending",
    subtotal_minor: 245000,
    delivery_charge_minor: 8000,
    discount_minor: 0,
    total_minor: 253000,
    placed_at: "2026-11-12T04:30:00.000Z",
    created_at: "2026-11-12T04:30:00.000Z",
    updated_at: "2026-11-12T04:30:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    order_number: 10002,
    user_id: null,
    customer_name: "Tanvir Hasan",
    phone: "01800000002",
    email: "tanvir@example.invalid",
    division: "Dhaka",
    district: "Gazipur",
    area: "Tongi",
    address_line: "House 4, Station Road",
    note: "Call before delivery.",
    payment_method: "cod",
    payment_status: "unpaid",
    status: "packed",
    subtotal_minor: 189000,
    delivery_charge_minor: 8000,
    discount_minor: 0,
    total_minor: 197000,
    placed_at: "2026-11-11T09:15:00.000Z",
    created_at: "2026-11-11T09:15:00.000Z",
    updated_at: "2026-11-11T12:00:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000003",
    order_number: 10003,
    user_id: "50000000-0000-4000-8000-000000000009",
    customer_name: "Nusrat Jahan",
    phone: "01900000003",
    email: null,
    division: "Chattogram",
    district: "Chattogram",
    area: "Agrabad",
    address_line: "Flat 2B, Port Road",
    note: null,
    payment_method: "cod",
    payment_status: "paid",
    status: "delivered",
    subtotal_minor: 320000,
    delivery_charge_minor: 12000,
    discount_minor: 20000,
    total_minor: 312000,
    placed_at: "2026-11-09T06:45:00.000Z",
    created_at: "2026-11-09T06:45:00.000Z",
    updated_at: "2026-11-10T08:20:00.000Z",
  },
];

const SAMPLE_ORDER_FIRST = SAMPLE_ORDERS[0]!;
const SAMPLE_ORDER_SECOND = SAMPLE_ORDERS[1]!;
const SAMPLE_ORDER_THIRD = SAMPLE_ORDERS[2]!;

const SAMPLE_ORDER_ITEMS: OrderItemView[] = [
  {
    id: "50000000-0000-4000-8000-000000000011",
    order_id: SAMPLE_ORDER_FIRST.id,
    product_id: SAMPLE_PRODUCT_ID,
    variant_id: SAMPLE_VARIANT_ID,
    product_name: "Sample Cotton Shirt",
    size: "M",
    color: "Maroon",
    unit_price_minor: 122500,
    quantity: 2,
    line_total_minor: 245000,
    created_at: "2026-11-12T04:30:00.000Z",
    imageUrl: null,
    imageAlt: "Sample Cotton Shirt",
  },
];

const SAMPLE_ORDER_HISTORY: OrderHistoryEntry[] = [
  {
    id: "50000000-0000-4000-8000-000000000012",
    before: null,
    after: "pending",
    created_at: "2026-11-12T04:30:00.000Z",
  },
];

export const SAMPLE_ORDER_DETAIL: OrderDetailData = {
  order: SAMPLE_ORDER_FIRST,
  items: SAMPLE_ORDER_ITEMS,
  history: SAMPLE_ORDER_HISTORY,
};

export const SAMPLE_ORDER_NOTICES: OrderNotice[] = SAMPLE_ORDERS.map((order) => ({
  id: order.id,
  order_number: order.order_number,
  customer_name: order.customer_name,
  status: order.status,
  total_minor: order.total_minor,
  placed_at: order.placed_at,
}));

/* ------------------------------------------------------------------ */
/* Incomplete checkouts (strict definition: abandoned, with items,     */
/* no linked order).                                                   */
/* ------------------------------------------------------------------ */

const SAMPLE_CHECKOUT_ITEMS: CheckoutItemRow[] = [
  {
    id: "52000000-0000-4000-8000-000000000001",
    checkout_session_id: "52000000-0000-4000-8000-000000000011",
    product_id: SAMPLE_PRODUCT_ID,
    variant_id: SAMPLE_VARIANT_ID,
    quantity: 1,
    regular_price_minor: 150000,
    unit_price_minor: 135000,
    price_snapshot_at: "2026-11-12T03:00:00.000Z",
    products: { name: "Sample Cotton Shirt" },
    product_variants: { size: "L", color: "Maroon" },
  },
  {
    id: "52000000-0000-4000-8000-000000000002",
    checkout_session_id: "52000000-0000-4000-8000-000000000012",
    product_id: SAMPLE_PRODUCT_ID,
    variant_id: SAMPLE_VARIANT_ID,
    quantity: 2,
    regular_price_minor: 150000,
    unit_price_minor: 150000,
    price_snapshot_at: "2026-11-11T05:00:00.000Z",
    products: { name: "Sample Cotton Shirt" },
    product_variants: { size: "M", color: "Navy" },
  },
];

const SAMPLE_CHECKOUT_ITEM_FIRST = SAMPLE_CHECKOUT_ITEMS[0]!;
const SAMPLE_CHECKOUT_ITEM_SECOND = SAMPLE_CHECKOUT_ITEMS[1]!;

export const SAMPLE_INCOMPLETE_SESSIONS: IncompleteSessionView[] = [
  {
    session: {
      id: "52000000-0000-4000-8000-000000000011",
      user_id: null,
      customer_name: "Rahim Uddin",
      phone: "01700000011",
      email: null,
      lifecycle_status: "abandoned",
      recovery_status: "pending",
      started_at: "2026-11-12T02:40:00.000Z",
      last_activity_at: "2026-11-12T03:05:00.000Z",
      abandoned_at: "2026-11-12T04:05:00.000Z",
      contacted_at: null,
      recovered_at: null,
      expires_at: "2026-11-19T02:40:00.000Z",
      order_id: null,
      created_at: "2026-11-12T02:40:00.000Z",
      updated_at: "2026-11-12T04:05:00.000Z",
    },
    items: [SAMPLE_CHECKOUT_ITEM_FIRST],
    valueMinor: 135000,
    itemCount: 1,
    progressLabel: "Reached checkout — delivery details saved",
  },
  {
    session: {
      id: "52000000-0000-4000-8000-000000000012",
      user_id: null,
      customer_name: "Shamima Akter",
      phone: "01600000012",
      email: "shamima@example.invalid",
      lifecycle_status: "abandoned",
      recovery_status: "contacted",
      started_at: "2026-11-11T04:30:00.000Z",
      last_activity_at: "2026-11-11T05:10:00.000Z",
      abandoned_at: "2026-11-11T06:10:00.000Z",
      contacted_at: "2026-11-11T08:00:00.000Z",
      recovered_at: null,
      expires_at: "2026-11-18T04:30:00.000Z",
      order_id: null,
      created_at: "2026-11-11T04:30:00.000Z",
      updated_at: "2026-11-11T08:00:00.000Z",
    },
    items: [SAMPLE_CHECKOUT_ITEM_SECOND],
    valueMinor: 300000,
    itemCount: 2,
    progressLabel: "Reached checkout — delivery details saved",
  },
];

const SAMPLE_INCOMPLETE_ITEMS: CheckoutItemView[] = [
  { ...SAMPLE_CHECKOUT_ITEM_FIRST, imageUrl: null, imageAlt: "Sample Cotton Shirt" },
];

const SAMPLE_INCOMPLETE_VIEW_FIRST = SAMPLE_INCOMPLETE_SESSIONS[0]!;

export const SAMPLE_INCOMPLETE_DETAIL: IncompleteDetailData = {
  session: SAMPLE_INCOMPLETE_VIEW_FIRST.session,
  items: SAMPLE_INCOMPLETE_ITEMS,
  valueMinor: 135000,
  log: [],
  progressLabel: "Reached checkout — delivery details saved",
  recoveryEditable: true,
};

/* ------------------------------------------------------------------ */
/* Customers (derived from orders, grouped by phone — same shape).     */
/* ------------------------------------------------------------------ */

export const SAMPLE_CUSTOMERS: CustomerListEntry[] = [
  {
    phone: "01700000001",
    name: "Ayesha Rahman",
    email: null,
    orderCount: 1,
    totalSpentMinor: 253000,
    firstOrderAt: "2026-11-12T04:30:00.000Z",
    lastOrderAt: "2026-11-12T04:30:00.000Z",
    hasAccount: false,
    latestOrderId: SAMPLE_ORDER_FIRST.id,
    blocked: false,
  },
  {
    phone: "01800000002",
    name: "Tanvir Hasan",
    email: "tanvir@example.invalid",
    orderCount: 1,
    totalSpentMinor: 197000,
    firstOrderAt: "2026-11-11T09:15:00.000Z",
    lastOrderAt: "2026-11-11T09:15:00.000Z",
    hasAccount: false,
    latestOrderId: SAMPLE_ORDER_SECOND.id,
    blocked: false,
  },
  {
    phone: "01900000003",
    name: "Nusrat Jahan",
    email: null,
    orderCount: 1,
    totalSpentMinor: 312000,
    firstOrderAt: "2026-11-09T06:45:00.000Z",
    lastOrderAt: "2026-11-09T06:45:00.000Z",
    hasAccount: true,
    latestOrderId: SAMPLE_ORDER_THIRD.id,
    blocked: false,
  },
];

const SAMPLE_CUSTOMER_FIRST = SAMPLE_CUSTOMERS[0]!;

export const SAMPLE_CUSTOMER_PROFILE: CustomerProfileData = {
  phone: SAMPLE_CUSTOMER_FIRST.phone,
  summary: SAMPLE_CUSTOMER_FIRST,
  orders: [SAMPLE_ORDER_FIRST],
  ordersTruncated: false,
  blockedRow: null,
  blocked: false,
  canManageBlock: false,
};

/* ------------------------------------------------------------------ */
/* Coupons (usage counts are zero: no redemptions are recorded until   */
/* checkout integration lands).                                        */
/* ------------------------------------------------------------------ */

export const SAMPLE_COUPONS: CouponListEntry[] = [
  {
    id: "53000000-0000-4000-8000-000000000001",
    code: "SAMPLE10",
    kind: "percent",
    percent_value: 10,
    fixed_discount_minor: null,
    min_order_minor: 100000,
    max_discount_minor: 50000,
    starts_at: null,
    expires_at: null,
    total_usage_limit: null,
    per_customer_limit: 1,
    first_order_only: false,
    active: true,
    created_by: null,
    created_at: "2026-11-10T05:00:00.000Z",
    updated_at: "2026-11-10T05:00:00.000Z",
    usageCount: 0,
  },
  {
    id: "53000000-0000-4000-8000-000000000002",
    code: "SAMPLE150",
    kind: "fixed",
    percent_value: null,
    fixed_discount_minor: 15000,
    min_order_minor: 50000,
    max_discount_minor: null,
    starts_at: "2026-11-01T00:00:00.000Z",
    expires_at: "2026-12-01T00:00:00.000Z",
    total_usage_limit: 100,
    per_customer_limit: 1,
    first_order_only: true,
    active: true,
    created_by: null,
    created_at: "2026-11-10T05:00:00.000Z",
    updated_at: "2026-11-10T05:00:00.000Z",
    usageCount: 0,
  },
  {
    id: "53000000-0000-4000-8000-000000000003",
    code: "SAMPLE-OLD",
    kind: "percent",
    percent_value: 20,
    fixed_discount_minor: null,
    min_order_minor: 0,
    max_discount_minor: null,
    starts_at: null,
    expires_at: "2026-10-01T00:00:00.000Z",
    total_usage_limit: null,
    per_customer_limit: null,
    first_order_only: false,
    active: false,
    created_by: null,
    created_at: "2026-09-10T05:00:00.000Z",
    updated_at: "2026-09-10T05:00:00.000Z",
    usageCount: 0,
  },
];

const SAMPLE_COUPON_FIRST = SAMPLE_COUPONS[0]!;

export const SAMPLE_COUPON_DETAIL: CouponDetailData = {
  coupon: SAMPLE_COUPON_FIRST,
  redemptions: [],
  totalRedemptions: 0,
};
