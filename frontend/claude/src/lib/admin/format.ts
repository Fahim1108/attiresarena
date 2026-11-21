/* Advance-payment submission labels (migration 20261121000100).      */
/* Pure helpers kept here — NOT in orders.ts — so client components    */
/* (orders list, verification card) can use them without pulling in    */
/* orders.ts, which holds inline "use server" actions that Next.js     */
/* refuses to bundle into a client component.                          */

export const PAYMENT_SUBMISSION_STATUSES = ["submitted", "verified", "rejected"] as const;

export type PaymentSubmissionStatus = (typeof PAYMENT_SUBMISSION_STATUSES)[number];

export const PAYMENT_SUBMISSION_STATUS_LABELS: Record<PaymentSubmissionStatus, string> = {
  submitted: "Needs verification",
  verified: "Verified",
  rejected: "Rejected",
};

export function paymentSubmissionStatusLabel(status: string): string {
  if (status === "verified") return PAYMENT_SUBMISSION_STATUS_LABELS.verified;
  if (status === "rejected") return PAYMENT_SUBMISSION_STATUS_LABELS.rejected;
  return PAYMENT_SUBMISSION_STATUS_LABELS.submitted;
}

export const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  bkash: "bKash",
  nagad: "Nagad",
};

export function paymentProviderLabel(provider: string): string {
  return PAYMENT_PROVIDER_LABELS[provider] ?? provider;
}

/** Short TxID for tight list cells: first 8 chars + ellipsis, full value on hover. */
export function shortTransactionId(transactionId: string): string {
  return transactionId.length > 12 ? `${transactionId.slice(0, 8)}…` : transactionId;
}

/** Shared formatting helpers for the admin panel (Asia/Dhaka, BDT minor units). */

export function formatMoney(minor: number): string {
  const value = minor / 100;
  return `৳${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatMoneyShort(minor: number): string {
  const value = minor / 100;
  return `৳${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Display label for an order number: "AA-10001"; "Order" when unknown. Accepts the numeric value or its string form (the checkout confirmation carries it as a string). */
export function formatOrderNumber(orderNumber: number | string | null | undefined): string {
  return orderNumber ? `AA-${orderNumber}` : "Order";
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  dateStyle: "medium",
  timeStyle: "short",
});

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  dateStyle: "medium",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormat.format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormat.format(date);
}

/** YYYY-MM-DD in Asia/Dhaka for <input type="date"> values and queries. */
export function toDhakaDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function parsePage(value: unknown, fallback = 1): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

export function parsePageSize(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export interface DateRange {
  from: string;
  to: string;
}

/** Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD, clamped to a sane window. */
export function parseDateRange(
  searchParams: Record<string, string | string[] | undefined>,
  defaultDays = 30,
): DateRange {
  const today = toDhakaDateKey(new Date());
  const rawFrom = searchParams.from;
  const rawTo = searchParams.to;
  const from = typeof rawFrom === "string" ? rawFrom : "";
  const to = typeof rawTo === "string" ? rawTo : "";
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  const end = valid(to) && to <= today ? to : today;
  const startDate = new Date(`${end}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - (defaultDays - 1));
  const defaultFrom = startDate.toISOString().slice(0, 10);
  const start = valid(from) && from <= end ? from : defaultFrom;
  // Clamp the window to 366 days to keep dashboard queries bounded.
  const spanDays =
    (Date.parse(end) - Date.parse(start)) / (24 * 60 * 60 * 1000);
  if (spanDays > 366) {
    const clamped = new Date(`${end}T00:00:00Z`);
    clamped.setUTCDate(clamped.getUTCDate() - 365);
    return { from: clamped.toISOString().slice(0, 10), to: end };
  }
  return { from: start, to: end };
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Escape a CSV cell per RFC 4180. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Parse a "10.50" style BDT amount into minor units; null when invalid. */
export function parseMoneyToMinor(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/[৳,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const minor = Math.round(Number.parseFloat(trimmed) * 100);
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}
