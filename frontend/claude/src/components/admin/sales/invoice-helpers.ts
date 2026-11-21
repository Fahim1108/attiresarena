/** Pure invoice helpers: QR payload, totals, and code geometry.
 *
 * No component, no fetching, no sample data. The QR/barcode libraries are
 * loaded with dynamic import inside the async generators below, so pages
 * that never render an invoice never load them. Invoice rendering itself
 * is server-only: the codes are embedded SVG/data-URIs, never fetched at
 * print time.
 */

import { formatMoney } from "@/lib/admin/format";
import type { PaymentStatus } from "@/lib/admin/constants";

export const INVOICE_WEBSITE_HOST = "www.attiresarena.com";
export const INVOICE_WEBSITE_URL = `https://${INVOICE_WEBSITE_HOST}`;

/**
 * QR payload: plain-text order details. No public order or tracking URL
 * exists in the app, so the QR carries the details themselves instead of
 * a link — a guessed Steadfast tracking URL would be invented data.
 * Deterministic: same input, same payload.
 */
export function buildInvoiceQrPayload(input: {
  invoiceNo: string;
  trackingCode: string | null;
  totalMinor: number;
}): string {
  const lines = [
    "Attires Arena",
    `Invoice ${input.invoiceNo}`,
    `Total ${formatMoney(input.totalMinor)}`,
  ];
  if (input.trackingCode) lines.push(`Tracking ${input.trackingCode}`);
  lines.push(INVOICE_WEBSITE_HOST);
  return lines.join("\n");
}

/** Amount still to collect: the full total while unpaid, nothing once paid/refunded. */
export function amountDueMinor(input: {
  totalMinor: number;
  paymentStatus: PaymentStatus;
}): number {
  return input.paymentStatus === "unpaid" ? input.totalMinor : 0;
}

/** A discount row only earns its place when the order actually has one. */
export function showDiscountRow(discountMinor: number): boolean {
  return discountMinor > 0;
}

export type InvoiceTotalKind = "charge" | "discount" | "payable" | "due";

export interface InvoiceTotalRow {
  label: string;
  minor: number;
  kind: InvoiceTotalKind;
}

/** Totals rows straight from the stored order fields — nothing invented. */
export function invoiceTotalRows(order: {
  subtotal_minor: number;
  delivery_charge_minor: number;
  discount_minor: number;
  total_minor: number;
  payment_status: PaymentStatus;
}): InvoiceTotalRow[] {
  const rows: InvoiceTotalRow[] = [
    { label: "Subtotal", minor: order.subtotal_minor, kind: "charge" },
    { label: "Delivery Fee", minor: order.delivery_charge_minor, kind: "charge" },
  ];
  if (showDiscountRow(order.discount_minor)) {
    rows.push({ label: "Discount", minor: order.discount_minor, kind: "discount" });
  }
  rows.push(
    { label: "Total Payable", minor: order.total_minor, kind: "payable" },
    {
      label: "Amount Due",
      minor: amountDueMinor({ totalMinor: order.total_minor, paymentStatus: order.payment_status }),
      kind: "due",
    },
  );
  return rows;
}

export interface InvoiceItemRow {
  sl: string;
  description: string;
  size: string;
  color: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  /** First product image (signed URL), or null when the product has none. */
  imageUrl: string | null;
  /** Alt text for the image; falls back to the product name. */
  imageAlt: string;
}

/**
 * Item rows for the invoice table. Description is the stored product name
 * exactly — order items carry no SKU (the column is never selected), so
 * none can ever appear here. The image rides through untouched so the
 * invoice can show the ordered shirt next to its name.
 */
export function invoiceItemRows(
  items: readonly {
    product_name: string;
    size: string;
    color: string;
    quantity: number;
    unit_price_minor: number;
    line_total_minor: number;
    imageUrl?: string | null;
    imageAlt?: string;
  }[],
): InvoiceItemRow[] {
  return items.map((item, index) => ({
    sl: String(index + 1).padStart(2, "0"),
    description: item.product_name,
    size: item.size,
    color: item.color,
    quantity: item.quantity,
    unitPriceMinor: item.unit_price_minor,
    lineTotalMinor: item.line_total_minor,
    imageUrl: item.imageUrl ?? null,
    imageAlt: item.imageAlt || item.product_name,
  }));
}

/** Blank/whitespace tracking codes are treated as "no booking". */
export function normalizeTrackingCode(code: string | null | undefined): string | null {
  const value = code?.trim() ?? "";
  return value ? value : null;
}

/** QR symbol modules for a payload (error correction M, the print standard). */
export async function qrCodeModules(payload: string): Promise<{
  size: number;
  data: Uint8Array;
}> {
  const { create } = await import("qrcode");
  const qr = create(payload, { errorCorrectionLevel: "M" });
  return { size: qr.modules.size, data: qr.modules.data };
}

export interface QrRect {
  x: number;
  y: number;
}

/** Dark-module coordinates (row-major) for rendering the QR symbol as SVG rects. */
export function qrModuleRects(size: number, data: ArrayLike<number>): QrRect[] {
  const rects: QrRect[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (data[row * size + col] === 1) rects.push({ x: col, y: row });
    }
  }
  return rects;
}

/**
 * Code 128 barcode SVG for a tracking code, or null when there is no code
 * or the code cannot be encoded. A null result never breaks the invoice:
 * the tracking number is always printed as text as well.
 */
export async function renderTrackingBarcodeSvg(code: string): Promise<string | null> {
  const value = normalizeTrackingCode(code);
  if (!value) return null;
  try {
    // Subpath import: the package root export carries no top-level types
    // entry, while ./node resolves types + the Node build directly.
    const { toSVG } = await import("bwip-js/node");
    return toSVG({
      bcid: "code128",
      text: value,
      scale: 3,
      height: 10,
      includetext: false,
      backgroundcolor: "FFFFFF",
    });
  } catch {
    return null;
  }
}

/** Embed an SVG string in markup without dangerouslySetInnerHTML. */
export function barcodeSvgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
