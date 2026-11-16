import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, actionOk, actionError, toActionError, type AdminActionResult, type StaffSession } from "./authorization";
import { ORDER_STATUS_LABELS, areaRoles, canBookCourier } from "./constants";
import { ORDER_COLUMNS, ORDER_ITEM_COLUMNS, orderItemRowSchema, orderRowSchema, type OrderItemRow, type OrderRow } from "./orders";

/* ------------------------------------------------------------------ */
/* Steadfast courier booking (one tap, from the order detail page and  */
/* the All Orders expanded card).                                      */
/*                                                                     */
/* NO SANDBOX EXISTS: every booking made with live keys is a REAL      */
/* parcel. There is no test booking path in this module. Tests use     */
/* fetchImpl injection only and never touch the live API.              */
/*                                                                     */
/* KEYS: server-side env vars ONLY (STEADFAST_API_KEY /                */
/* STEADFAST_SECRET_KEY, set in Vercel env vars). Keys never appear    */
/* in code, tests (placeholder values only), comments, logs, or        */
/* action results. When unconfigured, the UI shows an honest           */
/* "not configured" state, never a fake success.                       */
/*                                                                     */
/* NO RETRY: a lost response after provider success could duplicate a  */
/* parcel, so this module never auto-retries. On an ambiguous failure  */
/* (timeout / network error / unreadable response) the UI tells the    */
/* owner to check the Steadfast portal before trying again.            */
/*                                                                     */
/* NO CANCELLATION: Steadfast provides no cancel endpoint (the Return  */
/* Request API / merchant portal is the cancellation path). No cancel  */
/* code exists here.                                                   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Configuration (checkout/config.ts shape: presence/length            */
/* validation, null-when-unconfigured, server-only). No staging gates: */
/* courier booking is production-capable like the rest of the sales    */
/* admin; protection comes from the explicit owner action + env-key    */
/* presence + the booked-state guards, not from STAGING_* flags.       */
/* ------------------------------------------------------------------ */

export interface SteadfastConfiguration {
  apiKey: string;
  secretKey: string;
}

const MIN_KEY_LENGTH = 8;

export function steadfastConfiguration(
  env: Record<string, string | undefined> = process.env,
): SteadfastConfiguration | null {
  const apiKey = (env.STEADFAST_API_KEY ?? "").trim();
  const secretKey = (env.STEADFAST_SECRET_KEY ?? "").trim();
  if (apiKey.length < MIN_KEY_LENGTH || secretKey.length < MIN_KEY_LENGTH) return null;
  return { apiKey, secretKey };
}

export function isSteadfastConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return steadfastConfiguration(env) !== null;
}

/* ------------------------------------------------------------------ */
/* Steadfast V1 API mapping (verified against secondary mirrors of     */
/* the official V1 guide — see the build handoff for sources; the      */
/* live provider was NEVER called while writing this module).          */
/*                                                                     */
/* Base URL: https://portal.packzy.com/api/v1                         */
/* Auth: Api-Key + Secret-Key headers on every request, plus           */
/* Content-Type: application/json. No token flow.                      */
/* Booking: POST /create_order, JSON body. Success response:           */
/* {status: 200, message, consignment: {consignment_id, invoice,       */
/* tracking_code, recipient_*, cod_amount, status, ...}}.              */
/* consignment_id + tracking_code are returned ONLY here — the status  */
/* endpoints return only delivery_status — so they are stored          */
/* immediately (order_shipments, migration 20261116000200).            */
/*                                                                     */
/* FIELD MAPPING (order snapshot -> request field):                    */
/*   invoice            <- "AA-<order_number>" (or "AA-<order id>"     */
/*                         when no number exists yet); alphanumeric +  */
/*                         hyphen/underscore, unique per account.      */
/*   recipient_name     <- orders.customer_name (max 100)              */
/*   recipient_phone    <- orders.phone (11 digits, 01…)               */
/*   recipient_address  <- address_line, area, district, division      */
/*                         joined most-specific-first (max 490; the    */
/*                         older PDF guide says 250, newer mirrors /   */
/*                         SDKs say 490 — we cap at 490 and order the  */
/*                         parts so truncation drops the division      */
/*                         last, never the house address).             */
/*   cod_amount         <- orders.total_minor / 100 (BDT, >= 0)        */
/*   note               <- orders.note when present (max 480)         */
/*   item_description   <- order_items snapshots:                      */
/*                         "Name (Size · Color) × qty" joined with     */
/*                         "; " (courtesy cap 250; the guide states    */
/*                         no limit for this field).                   */
/*   total_lot          <- sum of item quantities (>= 1)               */
/*   recipient_email    <- orders.email when present                   */
/*   delivery_type      <- 0 (home delivery, the default)              */
/* ------------------------------------------------------------------ */

export const STEADFAST_BASE_URL = "https://portal.packzy.com/api/v1";
export const STEADFAST_CREATE_ORDER_PATH = "/create_order";

export const STEADFAST_LIMITS = {
  invoice: 100,
  recipientName: 100,
  recipientAddress: 490,
  note: 480,
  itemDescription: 250,
  codAmountMax: 1_000_000,
} as const;

export interface SteadfastCreateOrderPayload {
  invoice: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  cod_amount: number;
  note?: string;
  delivery_type: number;
  recipient_email?: string;
  item_description?: string;
  total_lot?: number;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export function buildSteadfastInvoice(order: {
  id: string;
  order_number: number | null;
}): string {
  return order.order_number ? `AA-${order.order_number}` : `AA-${order.id}`;
}

export function buildSteadfastAddress(order: {
  address_line: string;
  area: string;
  district: string;
  division: string;
}): string {
  const joined = [order.address_line, order.area, order.district, order.division]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  return truncate(joined, STEADFAST_LIMITS.recipientAddress);
}

export function buildSteadfastItemDescription(items: readonly OrderItemRow[]): string | undefined {
  if (items.length === 0) return undefined;
  const description = items
    .map((item) => `${item.product_name} (${item.size} · ${item.color}) × ${item.quantity}`)
    .join("; ");
  return truncate(description, STEADFAST_LIMITS.itemDescription);
}

/** Pure payload builder: order snapshot + item snapshots -> API request. */
export function buildSteadfastPayload(
  order: OrderRow,
  items: readonly OrderItemRow[],
): SteadfastCreateOrderPayload {
  const note = order.note?.trim() ? truncate(order.note.trim(), STEADFAST_LIMITS.note) : undefined;
  const itemDescription = buildSteadfastItemDescription(items);
  const totalLot = items.reduce((sum, item) => sum + item.quantity, 0);
  return {
    invoice: buildSteadfastInvoice(order),
    recipient_name: truncate(order.customer_name.trim(), STEADFAST_LIMITS.recipientName),
    recipient_phone: order.phone.trim(),
    recipient_address: buildSteadfastAddress(order),
    cod_amount: order.total_minor / 100,
    ...(note ? { note } : {}),
    delivery_type: 0,
    ...(order.email?.trim() ? { recipient_email: order.email.trim() } : {}),
    ...(itemDescription ? { item_description: itemDescription } : {}),
    ...(totalLot > 0 ? { total_lot: totalLot } : {}),
  };
}

/**
 * Defense-in-depth payload validation (the builder already truncates;
 * this rejects anything that still violates the documented contract).
 * Returns a staff-facing error string, or null when valid.
 */
export function validateSteadfastPayload(payload: SteadfastCreateOrderPayload): string | null {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(payload.invoice)) {
    return "The order reference cannot be sent to Steadfast. Reload and try again.";
  }
  if (payload.recipient_name.length < 1 || payload.recipient_name.length > 100) {
    return "The recipient name cannot be sent to Steadfast. Check the order details.";
  }
  if (!/^01[3-9][0-9]{8}$/.test(payload.recipient_phone)) {
    return "The recipient phone number cannot be sent to Steadfast. Check the order details.";
  }
  if (payload.recipient_address.length < 1 || payload.recipient_address.length > 490) {
    return "The delivery address cannot be sent to Steadfast. Check the order details.";
  }
  if (
    !Number.isFinite(payload.cod_amount) ||
    payload.cod_amount < 0 ||
    payload.cod_amount > STEADFAST_LIMITS.codAmountMax
  ) {
    return "The cash-on-delivery amount cannot be sent to Steadfast. Check the order total.";
  }
  if (payload.note !== undefined && payload.note.length > 480) {
    return "The order note is too long to send to Steadfast.";
  }
  return null;
}

/* Booking guards live in constants.ts (the client panel needs them and
   this module is server-only); re-exported here so server callers and
   tests keep one import site. */
export { BOOKABLE_ORDER_STATUSES, canBookCourier } from "./constants";

/* ------------------------------------------------------------------ */
/* Sender (Telegram pattern: fetchImpl injection, AbortController +    */
/* timeout, generic errors that never leak secrets or provider         */
/* payloads).                                                          */
/* ------------------------------------------------------------------ */

export interface SteadfastConsignment {
  consignmentId: string;
  trackingCode: string;
  providerStatus: string | null;
}

export type SteadfastSendResult =
  | { ok: true; consignment: SteadfastConsignment }
  | { ok: false; error: string; ambiguous: boolean };

const STEADFAST_TIMEOUT_MS = 15_000;

const steadfastResponseSchema = z.object({
  status: z.number(),
  consignment: z.object({
    consignment_id: z.union([z.number(), z.string()]),
    tracking_code: z.string().min(1),
    status: z.string().optional(),
  }),
});

/** Lenient first pass: a refusal body carries a numeric status but no consignment. */
const steadfastStatusSchema = z.object({ status: z.number() });

export async function createSteadfastConsignment(input: {
  config: SteadfastConfiguration;
  payload: SteadfastCreateOrderPayload;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<SteadfastSendResult> {
  const send = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? STEADFAST_TIMEOUT_MS);
  try {
    const response = await send(`${STEADFAST_BASE_URL}${STEADFAST_CREATE_ORDER_PATH}`, {
      method: "POST",
      headers: {
        "Api-Key": input.config.apiKey,
        "Secret-Key": input.config.secretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.payload),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (typeof response.status === "number" && response.status >= 500) {
        // A 5xx can arrive AFTER the provider created the parcel
        // (gateway timeout, error after commit). Never call it a
        // definite refusal: the owner checks the portal first, exactly
        // as for a timeout or an unreadable response.
        return {
          ok: false,
          ambiguous: true,
          error:
            "Steadfast returned a server error. The parcel may already exist — check the Steadfast portal before trying again, so a second parcel is not created.",
        };
      }
      // A definite HTTP refusal (4xx: validation/auth) means Steadfast
      // rejected the booking: no parcel was created, so retrying after
      // fixing the cause is safe.
      return {
        ok: false,
        ambiguous: false,
        error:
          "Steadfast did not accept the booking. Check the order details and the Steadfast account balance, then try again.",
      };
    }
    const statusOnly = steadfastStatusSchema.safeParse(body);
    if (!statusOnly.success) {
      // HTTP 200 but an unreadable body: the parcel may already exist.
      // Never treat this as a clean refusal.
      return {
        ok: false,
        ambiguous: true,
        error:
          "The booking response could not be read. The parcel may already exist — check the Steadfast portal before trying again, so a second parcel is not created.",
      };
    }
    if (statusOnly.data.status !== 200) {
      // A well-formed provider-level refusal: no parcel was created.
      return {
        ok: false,
        ambiguous: false,
        error:
          "Steadfast did not accept the booking. Check the order details and the Steadfast account balance, then try again.",
      };
    }
    const parsed = steadfastResponseSchema.safeParse(body);
    if (!parsed.success) {
      // status 200 but no readable consignment: the parcel may exist
      // while its identifiers are lost. Never treat this as a refusal.
      return {
        ok: false,
        ambiguous: true,
        error:
          "The booking response could not be read. The parcel may already exist — check the Steadfast portal before trying again, so a second parcel is not created.",
      };
    }
    const consignment = parsed.data.consignment;
    return {
      ok: true,
      consignment: {
        consignmentId: String(consignment.consignment_id),
        trackingCode: consignment.tracking_code,
        providerStatus: consignment.status ?? null,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        ambiguous: true,
        error:
          "Steadfast did not respond in time. The parcel may already exist — check the Steadfast portal before trying again, so a second parcel is not created.",
      };
    }
    // Network failure after the request was sent is ambiguous: the
    // provider may have booked the parcel. Never auto-retry; the owner
    // checks the portal first.
    return {
      ok: false,
      ambiguous: true,
      error:
        "The booking could not be confirmed. The parcel may already exist — check the Steadfast portal before trying again, so a second parcel is not created.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ */
/* Shipment reads (RLS: orders.read). Null means unavailable (table /  */
/* migration missing, query failed, malformed rows) so callers can     */
/* degrade honestly. The payload snapshot is never selected: display   */
/* needs only the booking references.                                  */
/* ------------------------------------------------------------------ */

export const shipmentRowSchema = z.object({
  id: z.uuid(),
  order_id: z.uuid(),
  consignment_id: z.string(),
  tracking_code: z.string(),
  invoice: z.string(),
  provider_status: z.string().nullable(),
  booked_by: z.uuid().nullable(),
  booked_at: z.iso.datetime({ offset: true }),
  created_at: z.iso.datetime({ offset: true }),
});

export type ShipmentRow = z.infer<typeof shipmentRowSchema>;

/** Minimal shape passed to client components (no internal ids). */
export type ShipmentSummary = Pick<
  ShipmentRow,
  "consignment_id" | "tracking_code" | "invoice" | "provider_status" | "booked_at"
>;

export function toShipmentSummary(row: ShipmentRow): ShipmentSummary {
  return {
    consignment_id: row.consignment_id,
    tracking_code: row.tracking_code,
    invoice: row.invoice,
    provider_status: row.provider_status,
    booked_at: row.booked_at,
  };
}

const SHIPMENT_COLUMNS =
  "id,order_id,consignment_id,tracking_code,invoice,provider_status,booked_by,booked_at,created_at";

type StaffClient = StaffSession["client"];

async function readShipmentByOrderId(
  client: StaffClient,
  orderId: string,
): Promise<{ ok: true; shipment: ShipmentRow | null } | { ok: false }> {
  const result = await client
    .from("order_shipments")
    .select(SHIPMENT_COLUMNS)
    .eq("order_id", orderId)
    .maybeSingle();
  if (result.error) return { ok: false };
  if (!result.data) return { ok: true, shipment: null };
  const parsed = shipmentRowSchema.safeParse(result.data);
  return parsed.success ? { ok: true, shipment: parsed.data } : { ok: false };
}

export async function readOrderShipment(
  orderId: string,
): Promise<{ shipment: ShipmentRow | null } | null> {
  const session = await requireStaff(areaRoles("orders"));
  if (!z.uuid().safeParse(orderId).success) return null;
  const probe = await readShipmentByOrderId(session.client, orderId);
  return probe.ok ? { shipment: probe.shipment } : null;
}

export async function readShipmentsForOrders(
  orderIds: readonly string[],
): Promise<Map<string, ShipmentRow> | null> {
  const session = await requireStaff(areaRoles("orders"));
  const unique = [...new Set(orderIds)];
  if (unique.length === 0) return new Map();
  const result = await session.client
    .from("order_shipments")
    .select(SHIPMENT_COLUMNS)
    .in("order_id", unique)
    .limit(200);
  if (result.error) return null;
  const parsed = shipmentRowSchema.array().safeParse(result.data);
  if (!parsed.success) return null;
  return new Map(parsed.data.map((row) => [row.order_id, row]));
}

/* ------------------------------------------------------------------ */
/* Booking claims (migration 20261116000500). A claim row is the lock  */
/* that serializes concurrent booking attempts for one order: the      */
/* probe above and the record RPC's UNIQUE backstop prevent duplicate  */
/* RECORDS, but only a claim taken BEFORE the provider call prevents   */
/* duplicate PARCELS, because two simultaneous attempts would both     */
/* probe "not booked" and both call Steadfast.                         */
/*                                                                     */
/* Lifecycle: pending (held while the provider call runs) -> released  */
/* on a definite refusal or a recorded booking; marked AMBIGUOUS when  */
/* the provider outcome is unknown or the record save fails after      */
/* provider success. An ambiguous claim BLOCKS re-booking until the    */
/* owner checks the portal and clears it (admin_clear_ambiguous_       */
/* courier_booking_claim) — it is never silently overwritten. A        */
/* pending claim older than 15 minutes is stale (the provider call     */
/* times out at 15s) and the claim RPC reclaims it.                    */
/* ------------------------------------------------------------------ */

/** Map a claim-RPC refusal to fixed staff-facing copy. Never echoes DB text. */
export function mapClaimError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") {
      if (/outcome unknown/i.test(message)) {
        return "A previous booking attempt for this order did not get a confirmed result, so booking is blocked. Check the Steadfast portal before trying again — a parcel may already exist. If the portal shows no parcel, the blocked booking must be cleared before trying again.";
      }
      if (/already in progress/i.test(message)) {
        return "Another booking for this order is already in progress. Wait a moment and reload to see whether it succeeded — do not submit again from a second tab.";
      }
      if (/already been sent to the courier/i.test(message)) {
        return "This order was already sent to Steadfast. Booking again would create a second parcel.";
      }
      if (/cannot be sent to the courier from its current status/i.test(message)) {
        return "This order cannot be sent to the courier from its current status. Only Confirmed and Packed orders can be sent — verify the order first.";
      }
    }
  }
  return "The courier booking could not be started. No parcel was created. Reload and try again.";
}

/**
 * Take the booking claim for an order, BEFORE any provider call. A
 * concurrent second attempt is refused here by the claim RPC (unique
 * claim row), so it never reaches Steadfast.
 */
export async function claimCourierBooking(
  client: StaffClient,
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const claimed = await client.rpc("admin_claim_courier_booking", { p_order_id: orderId });
  if (claimed.error) return { ok: false, error: mapClaimError(claimed.error) };
  return { ok: true };
}

/**
 * Release a PENDING claim after a definite refusal or a recorded
 * booking, so a later retry is possible. Best-effort: the caller is
 * already returning its own result, and a stuck pending claim expires
 * (stale after 15 minutes) rather than blocking forever.
 */
export async function releaseCourierBookingClaim(
  client: StaffClient,
  orderId: string,
): Promise<void> {
  try {
    await client.rpc("admin_release_courier_booking_claim", { p_order_id: orderId });
  } catch {
    // Best-effort only; never mask the booking result.
  }
}

/**
 * Mark a claim AMBIGUOUS after an unknown provider outcome (or a record
 * failure after provider success). The claim then blocks blind
 * re-booking until the owner checks the portal and clears it.
 * Best-effort: if the mark itself fails, the claim stays pending,
 * which still blocks re-booking — the safe direction.
 */
export async function markCourierBookingClaimAmbiguous(
  client: StaffClient,
  orderId: string,
): Promise<void> {
  try {
    await client.rpc("admin_mark_courier_booking_claim_ambiguous", { p_order_id: orderId });
  } catch {
    // Best-effort only; never mask the booking result.
  }
}

/* ------------------------------------------------------------------ */
/* Server Action: one-tap send to courier.                             */
/*                                                                     */
/* Order of operations (each step refuses honestly before the next):   */
/*  1. keys configured?  2. order + items re-read from the database    */
/*  3. already booked? (probe — a fast-path courtesy check; it does    */
/*     NOT serialize concurrent attempts)  4. bookable status?         */
/*  5. payload valid?  6. CLAIM the booking (pending claim row,        */
/*     unique per order — a concurrent attempt is refused HERE,        */
/*     before any provider call, so two tabs can never create two      */
/*     parcels)  7. provider call  8. record consignment_id +          */
/*     tracking_code IMMEDIATELY via admin_record_shipment, then       */
/*     release the claim. On a definite refusal the claim is           */
/*     released so a retry is possible; on an ambiguous outcome the    */
/*     claim is marked ambiguous and BLOCKS re-booking until the       */
/*     owner checks the portal and clears it.                          */
/* If step 8's record fails after provider success, the claim is       */
/* marked ambiguous and the error message carries the consignment +    */
/* tracking references so the owner can reconcile in the portal        */
/* instead of booking a second parcel.                                 */
/* ------------------------------------------------------------------ */

const courierSchema = z.object({ id: z.uuid() });

export async function sendOrderToCourier(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const parsed = courierSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    return actionError("Enter a valid order. Reload and try again.");
  }
  const config = steadfastConfiguration();
  if (!config) {
    return actionError(
      "Steadfast is not configured. Ask the owner to add the Steadfast API keys to the server settings, then try again. No parcel was created.",
    );
  }
  const session = await requireStaff(areaRoles("orders"));
  const orderId = parsed.data.id;

  const orderResult = await session.client
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (orderResult.error || !orderResult.data) {
    return actionError("The order could not be read. No parcel was created. Reload and try again.");
  }
  const orderParsed = orderRowSchema.safeParse(orderResult.data);
  if (!orderParsed.success) {
    return actionError("The order could not be read. No parcel was created. Reload and try again.");
  }
  const order = orderParsed.data;

  // Booked-state probe BEFORE the provider call. This is a fast-path
  // courtesy check only: it does NOT serialize concurrent attempts
  // (two simultaneous probes can both read "not booked"). The CLAIM
  // step below is what prevents duplicate parcels; the record RPC +
  // UNIQUE constraint back up duplicate RECORDS. When the probe itself
  // cannot run, refuse: booking blind could duplicate a parcel whose
  // record cannot be read back.
  const existingProbe = await readShipmentByOrderId(session.client, orderId);
  if (!existingProbe.ok) {
    return actionError(
      "Whether this order was already sent to Steadfast could not be checked. No parcel was created. The database setup for courier bookings may not be applied yet.",
    );
  }
  const existing = existingProbe.shipment;
  if (existing) {
    return actionError(
      `This order was already sent to Steadfast (tracking ${existing.tracking_code}). Booking again would create a second parcel.`,
    );
  }
  if (!canBookCourier(order.status)) {
    return actionError(
      `This order is ${ORDER_STATUS_LABELS[order.status]}. Only Confirmed and Packed orders can be sent to the courier — verify the order first.`,
    );
  }

  const itemsResult = await session.client
    .from("order_items")
    .select(ORDER_ITEM_COLUMNS)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(100);
  if (itemsResult.error) {
    return actionError("The order items could not be read. No parcel was created. Reload and try again.");
  }
  const itemsParsed = orderItemRowSchema.array().safeParse(itemsResult.data);
  if (!itemsParsed.success || itemsParsed.data.length === 0) {
    return actionError("The order has no items to send. No parcel was created.");
  }

  const payload = buildSteadfastPayload(order, itemsParsed.data);
  const payloadError = validateSteadfastPayload(payload);
  if (payloadError) return actionError(`${payloadError} No parcel was created.`);

  // CLAIM before the provider call: a concurrent attempt for this order
  // is refused here, so it can never create a second parcel.
  const claimed = await claimCourierBooking(session.client, orderId);
  if (!claimed.ok) return actionError(claimed.error);

  const sent = await createSteadfastConsignment({ config, payload });
  if (!sent.ok) {
    if (sent.ambiguous) {
      await markCourierBookingClaimAmbiguous(session.client, orderId);
    } else {
      // Definite refusal: no parcel exists, so release the claim and
      // let staff fix the cause and retry.
      await releaseCourierBookingClaim(session.client, orderId);
    }
    return actionError(sent.error);
  }

  // Store the references IMMEDIATELY: Steadfast returns them only here.
  const recorded = await session.client.rpc("admin_record_shipment", {
    p_order_id: orderId,
    p_consignment_id: sent.consignment.consignmentId,
    p_tracking_code: sent.consignment.trackingCode,
    p_invoice: payload.invoice,
    p_payload: payload,
    p_provider_status: sent.consignment.providerStatus,
  });
  if (recorded.error) {
    // The parcel EXISTS but its record failed: mark the claim ambiguous
    // so no retry can create a second parcel.
    await markCourierBookingClaimAmbiguous(session.client, orderId);
    return actionError(
      `Steadfast created the parcel (consignment ${sent.consignment.consignmentId}, tracking ${sent.consignment.trackingCode}) but the booking could not be saved (${toActionError(recorded.error, "the shipment record could not be saved")}). Check the Steadfast portal and do not book again — booking again would create a second parcel.`,
    );
  }
  // Booked and recorded: release the claim. (The shipment record now
  // guards re-booking, so a failed release here is harmless.)
  await releaseCourierBookingClaim(session.client, orderId);
  revalidatePath("/admin/sales/orders");
  revalidatePath(`/admin/sales/orders/${orderId}`);
  return actionOk(
    `Sent to Steadfast. Tracking code ${sent.consignment.trackingCode} (consignment ${sent.consignment.consignmentId}).`,
  );
}
