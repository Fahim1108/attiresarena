import { areasOf, DIVISIONS } from "@/data/bangladesh";
import { isValidBdPhone, normalizePhone } from "./validation";
import type { AdvancePolicy, AdvanceProvider, PaymentSubmissionInput, VerifiedAdvanceOrder } from "@/types/manual-payment";

export function classifyAdvanceLocation(division: string, district: string, area: string) {
  if (!DIVISIONS[division]?.includes(district)) return null;
  if (!areasOf(district).includes(area)) return null;
  // Explicit preview policy: Barishal City is Barishal Sadar upazila of
  // Barishal district, rather than a customer-controlled "inside" label.
  // Live zones need approval.
  return division === "Barishal" && district === "Barishal" && area === "Barishal Sadar" ? "inside-barishal-city" : "outside-barishal-city";
}

export function advanceBreakdown(totalMinor: number, division: string, district: string, area: string, policy: AdvancePolicy) {
  const zone = classifyAdvanceLocation(division, district, area);
  if (!zone || !Number.isSafeInteger(totalMinor) || totalMinor < 0 || policy.credit !== "against-order-total") return null;
  const advanceMinor = zone === "inside-barishal-city" ? policy.insideBarishalCityMinor : policy.outsideBarishalCityMinor;
  if (!Number.isSafeInteger(advanceMinor) || advanceMinor < 0 || advanceMinor > totalMinor) return null;
  return { zone, totalMinor, advanceMinor, remainingMinor: totalMinor - advanceMinor };
}

export function formatPaymentAmount(minor: number) {
  if (!Number.isSafeInteger(minor) || minor < 0) return "Unavailable";
  return `৳${new Intl.NumberFormat("en-BD", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100)}`;
}

export function manualPaymentBreakdown(mode: "cod" | "online", totalMinor: number, division: string, district: string, area: string, policy: AdvancePolicy) {
  if (mode === "cod") {
    const advance = advanceBreakdown(totalMinor, division, district, area, policy);
    return advance ? { ...advance, amountDueMinor: advance.advanceMinor } : null;
  }
  const zone = classifyAdvanceLocation(division, district, area);
  if (!zone || !Number.isSafeInteger(totalMinor) || totalMinor <= 0) return null;
  return { zone, totalMinor, amountDueMinor: totalMinor, remainingMinor: 0 };
}

export function validatePaymentDetails(input: unknown):
  | { ok: true; data: PaymentSubmissionInput }
  | { ok: false; errors: Partial<Record<"transactionId" | "senderNumber" | "note" | "form", string>> } {
  if (!input || typeof input !== "object") return { ok: false, errors: { form: "Invalid payment details." } };
  const value = input as Record<string, unknown>;
  const transactionId = typeof value.transactionId === "string" ? value.transactionId.trim() : "";
  // Sender is stored in 01-format only: the payment_submissions
  // CHECK and the place_checkout_order guard both require
  // ^01[3-9][0-9]{8}$. Checkout accepts +880/880/01, so strip the
  // country prefix here — otherwise a +880 order is placed but its
  // TxID row is silently skipped and admin shows no Verify button.
  const senderNumber = typeof value.senderNumber === "string"
    ? normalizePhone(value.senderNumber.trim()).replace(/^\+?88(?=01[3-9])/, "")
    : "";
  const note = typeof value.note === "string" ? value.note.trim() : "";
  const errors: Partial<Record<"transactionId" | "senderNumber" | "note" | "form", string>> = {};
  if (!transactionId || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(transactionId) || transactionId.length > 128) errors.transactionId = "Enter the Transaction ID using letters, numbers, dots, hyphens or underscores.";
  if (!isValidBdPhone(senderNumber)) errors.senderNumber = "Enter a valid Bangladesh mobile number.";
  if (note.length > 1000 || (value.note !== undefined && typeof value.note !== "string")) errors.note = "Use up to 1,000 characters.";
  if (value.provider !== "bkash" && value.provider !== "nagad") errors.form = "Choose bKash or Nagad.";
  const idempotencyKey = typeof value.idempotencyKey === "string" ? value.idempotencyKey : "";
  const provider = value.provider === "bkash" || value.provider === "nagad" ? value.provider : null;
  const orderReference = typeof value.orderReference === "string" ? value.orderReference.trim() : null;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(idempotencyKey)) errors.form = "Reload the page before submitting.";
  if (value.orderReference !== null && (typeof value.orderReference !== "string" || !value.orderReference.trim() || value.orderReference.length > 128)) errors.form = "Invalid order reference.";
  if (Object.keys(errors).length || !provider) return { ok: false, errors };
  return { ok: true, data: { provider, transactionId, senderNumber, note, idempotencyKey, orderReference } };
}

/** Presentation guard only; a live server must authorize and verify the receipt. */
export function canDisplayConfirmedOrder(order: unknown): order is VerifiedAdvanceOrder {
  if (!order || typeof order !== "object" || Array.isArray(order)) return false;
  const value = order as Record<string, unknown>;
  const isMinor = (amount: unknown): amount is number => typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0;
  const isRecord = (record: unknown): record is Record<string, unknown> => !!record && typeof record === "object" && !Array.isArray(record);
  const isText = (text: unknown): text is string => typeof text === "string" && !!text.trim();
  const optionalText = (text: unknown) => text === undefined || isText(text);
  if (value.items !== undefined && (!Array.isArray(value.items) || value.items.length === 0 || !value.items.every(item => {
    if (!isRecord(item)) return false;
    const row = item;
    return isText(row.name) && typeof row.quantity === "number" && Number.isSafeInteger(row.quantity) && row.quantity > 0 &&
      isMinor(row.unitPriceMinor) && isMinor(row.lineTotalMinor) && Number.isSafeInteger(row.unitPriceMinor * row.quantity) &&
      row.lineTotalMinor === row.unitPriceMinor * row.quantity && optionalText(row.size) && optionalText(row.color);
  }))) return false;
  if (Array.isArray(value.items) && isMinor(value.subtotalMinor)) {
    let itemSubtotal = 0;
    for (const item of value.items) {
      if (!isRecord(item) || !isMinor(item.lineTotalMinor)) return false;
      itemSubtotal += item.lineTotalMinor;
      if (!Number.isSafeInteger(itemSubtotal)) return false;
    }
    if (itemSubtotal !== value.subtotalMinor) return false;
  }
  if (value.delivery !== undefined) {
    if (!isRecord(value.delivery)) return false;
    const delivery = value.delivery;
    if (!isText(delivery.recipientName) || !Array.isArray(delivery.addressLines) || !delivery.addressLines.length || !delivery.addressLines.every(isText) ||
      !optionalText(delivery.district) || !optionalText(delivery.division) || !optionalText(delivery.zoneLabel) || !optionalText(delivery.estimatedDelivery)) return false;
  }
  if ([value.subtotalMinor, value.deliveryMinor, value.discountMinor].some(amount => amount !== undefined && !isMinor(amount))) return false;
  if (isMinor(value.subtotalMinor) && isMinor(value.deliveryMinor) && isMinor(value.discountMinor) &&
    (!Number.isSafeInteger(value.subtotalMinor + value.deliveryMinor) || value.totalMinor !== value.subtotalMinor + value.deliveryMinor - value.discountMinor)) return false;
  return typeof value.orderId === "string" && !!value.orderId.trim() && typeof value.orderReference === "string" && !!value.orderReference.trim() && typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt)) &&
    value.orderStatus === "confirmed" && value.advanceStatus === "advance_verified" && (value.provider === "bkash" || value.provider === "nagad") &&
    isMinor(value.totalMinor) && isMinor(value.advanceMinor) && isMinor(value.remainingMinor) && value.advanceMinor > 0 && value.advanceMinor + value.remainingMinor === value.totalMinor;
}

/**
 * Payment reference carried on the order note. No payment-submissions table
 * or submit RPC exists yet, so the TxID + sender number travel with the
 * order itself (max 500 chars, enforced by the checkout RPC): the admin
 * order detail shows the note, so staff can verify the advance against
 * bKash/Nagad and then confirm the order. The line is a fixed prefix so
 * external payloads (courier) can strip it before sending.
 */
export const PAYMENT_NOTE_PREFIX = "[Advance payment]";

export function formatPaymentNoteLine(provider: AdvanceProvider, transactionId: string, senderNumber: string): string {
  const name = provider === "bkash" ? "bKash" : "Nagad";
  return `${PAYMENT_NOTE_PREFIX} ${name} TxID ${transactionId}, sender ${senderNumber}.`;
}

/** Order note with the payment line first; the customer note is trimmed to fit the 500-char order-note limit. */
export function buildOrderNote(payment: { provider: AdvanceProvider; transactionId: string; senderNumber: string }, customerNote?: string, maxLength = 500): string {
  const line = formatPaymentNoteLine(payment.provider, payment.transactionId, payment.senderNumber);
  const note = (customerNote ?? "").trim();
  if (!note) return line.slice(0, maxLength);
  const combined = `${line}\n${note}`;
  if (combined.length <= maxLength) return combined;
  return `${line}\n${note.slice(0, Math.max(0, maxLength - line.length - 1))}`.trimEnd();
}

/**
 * Parses the payment line back out of an order note. Mirrors the SQL
 * backfill in migration 20261121000100 exactly (same format, same
 * phone shape): "[Advance payment] bKash TxID <txid>, sender <phone>."
 * The sender may be written in +880/880/01 form (old notes carry
 * +880); the returned number is always 01-format. Returns null when
 * the note carries no payment line.
 */
export function parsePaymentNoteLine(note: string | null | undefined): {
  provider: AdvanceProvider;
  transactionId: string;
  senderNumber: string;
} | null {
  if (!note) return null;
  const match =
    /^\[Advance payment\] (bKash|Nagad) TxID ([A-Za-z0-9][A-Za-z0-9._-]*), sender ((?:\+880|880|0)?1[3-9][0-9]{8})/.exec(
      note.trim(),
    );
  if (!match) return null;
  return {
    provider: match[1] === "Nagad" ? "nagad" : "bkash",
    transactionId: match[2] ?? "",
    senderNumber: (match[3] ?? "").replace(/^\+?88(?=01[3-9])/, ""),
  };
}

/** Removes the payment line so it never leaves the store (courier note, third-party payloads). */
export function stripPaymentNoteLine(note: string | null | undefined): string {
  if (!note) return "";
  return note
    .split("\n")
    .filter((line) => !line.trim().startsWith(PAYMENT_NOTE_PREFIX))
    .join("\n")
    .trim();
}
