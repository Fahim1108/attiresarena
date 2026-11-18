import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { orderItemRowSchema, orderRowSchema } from "../src/lib/admin/orders";
import {
  INVOICE_WEBSITE_HOST,
  amountDueMinor,
  barcodeSvgDataUri,
  buildInvoiceQrPayload,
  invoiceItemRows,
  invoiceTotalRows,
  normalizeTrackingCode,
  qrCodeModules,
  qrModuleRects,
  renderTrackingBarcodeSvg,
  showDiscountRow,
} from "../src/components/admin/sales/invoice-helpers";

describe("invoice QR payload", () => {
  it("carries the invoice number, total, tracking, and website", () => {
    expect(
      buildInvoiceQrPayload({
        invoiceNo: "AA-10000",
        trackingCode: "SF123456789BD",
        totalMinor: 63000,
      }),
    ).toBe(
      [
        "Attires Arena",
        "Invoice AA-10000",
        "Total ৳630.00",
        "Tracking SF123456789BD",
        INVOICE_WEBSITE_HOST,
      ].join("\n"),
    );
  });

  it("omits the tracking line when there is no booking", () => {
    const payload = buildInvoiceQrPayload({
      invoiceNo: "AA-10001",
      trackingCode: null,
      totalMinor: 55000,
    });
    expect(payload).not.toContain("Tracking");
    expect(payload).toContain("Invoice AA-10001");
  });

  it("is deterministic", () => {
    const input = { invoiceNo: "AA-7", trackingCode: null, totalMinor: 100 };
    expect(buildInvoiceQrPayload(input)).toBe(buildInvoiceQrPayload(input));
  });
});

describe("invoice totals", () => {
  const base = {
    subtotal_minor: 55000,
    delivery_charge_minor: 8000,
    discount_minor: 0,
    total_minor: 63000,
    payment_status: "unpaid" as const,
  };

  it("builds rows from the stored fields, in order", () => {
    expect(invoiceTotalRows(base)).toEqual([
      { label: "Subtotal", minor: 55000, kind: "charge" },
      { label: "Delivery Fee", minor: 8000, kind: "charge" },
      { label: "Total Payable", minor: 63000, kind: "payable" },
      { label: "Amount Due", minor: 63000, kind: "due" },
    ]);
  });

  it("shows a discount row only when the order has a discount", () => {
    expect(showDiscountRow(0)).toBe(false);
    expect(showDiscountRow(-100)).toBe(false);
    expect(showDiscountRow(5000)).toBe(true);
    const rows = invoiceTotalRows({ ...base, discount_minor: 5000, total_minor: 58000 });
    expect(rows.map((row) => row.label)).toEqual([
      "Subtotal",
      "Delivery Fee",
      "Discount",
      "Total Payable",
      "Amount Due",
    ]);
    expect(rows[2]).toEqual({ label: "Discount", minor: 5000, kind: "discount" });
  });

  it("amount due is the total while unpaid and nothing once paid or refunded", () => {
    expect(amountDueMinor({ totalMinor: 63000, paymentStatus: "unpaid" })).toBe(63000);
    expect(amountDueMinor({ totalMinor: 63000, paymentStatus: "paid" })).toBe(0);
    expect(amountDueMinor({ totalMinor: 63000, paymentStatus: "refunded" })).toBe(0);
  });
});

describe("invoice item rows", () => {
  it("numbers rows, keeps the stored product name, and never carries a SKU", () => {
    const rows = invoiceItemRows([
      {
        product_name: "Sample Cotton Shirt",
        size: "M",
        color: "Maroon",
        quantity: 2,
        unit_price_minor: 122500,
        line_total_minor: 245000,
      },
      {
        product_name: "Check Shirt",
        size: "L",
        color: "",
        quantity: 1,
        unit_price_minor: 49900,
        line_total_minor: 49900,
      },
    ]);
    expect(rows).toEqual([
      {
        sl: "01",
        description: "Sample Cotton Shirt",
        size: "M",
        color: "Maroon",
        quantity: 2,
        unitPriceMinor: 122500,
        lineTotalMinor: 245000,
      },
      {
        sl: "02",
        description: "Check Shirt",
        size: "L",
        color: "",
        quantity: 1,
        unitPriceMinor: 49900,
        lineTotalMinor: 49900,
      },
    ]);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("sku");
    }
  });

  it("order and item schemas select no SKU column", () => {
    expect(Object.keys(orderRowSchema.shape)).not.toContain("sku");
    expect(Object.keys(orderItemRowSchema.shape)).not.toContain("sku");
  });
});

describe("tracking codes", () => {
  it("normalizes blank codes to null", () => {
    expect(normalizeTrackingCode(null)).toBeNull();
    expect(normalizeTrackingCode(undefined)).toBeNull();
    expect(normalizeTrackingCode("   ")).toBeNull();
    expect(normalizeTrackingCode("  SF1 ")).toBe("SF1");
  });

  it("renders a Code 128 SVG deterministically", async () => {
    const first = await renderTrackingBarcodeSvg("SF123456789BD");
    const second = await renderTrackingBarcodeSvg("SF123456789BD");
    expect(first).toBeTruthy();
    expect(first).toBe(second);
    expect(first).toMatch(/^<svg /);
    expect(first).toContain("<path");
  });

  it("renders nothing for a blank code", async () => {
    await expect(renderTrackingBarcodeSvg("   ")).resolves.toBeNull();
  });

  it("embeds SVG as a data URI that round-trips", () => {
    const uri = barcodeSvgDataUri("<svg viewBox=\"0 0 10 10\"></svg>");
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(uri.slice("data:image/svg+xml;utf8,".length))).toBe(
      "<svg viewBox=\"0 0 10 10\"></svg>",
    );
  });
});

describe("QR symbol", () => {
  it("builds a square module matrix with finder patterns", async () => {
    const { size, data } = await qrCodeModules("Attires Arena\nInvoice AA-10000");
    expect(size).toBeGreaterThanOrEqual(21);
    expect(size % 2).toBe(1);
    expect(data.length).toBe(size * size);
    // Top-left finder: corners dark, separator light, centre dark.
    expect(data[0]).toBe(1);
    expect(data[6]).toBe(1);
    expect(data[6 * size]).toBe(1);
    expect(data[7]).toBe(0);
    expect(data[3 * size + 3]).toBe(1);
    // Top-right and bottom-left finders present.
    expect(data[size - 1]).toBe(1);
    expect(data[(size - 1) * size]).toBe(1);
  });

  it("is deterministic for the same payload", async () => {
    const payload = buildInvoiceQrPayload({
      invoiceNo: "AA-10000",
      trackingCode: "SF123456789BD",
      totalMinor: 63000,
    });
    const first = await qrCodeModules(payload);
    const second = await qrCodeModules(payload);
    expect(first.size).toBe(second.size);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  it("rects cover exactly the dark modules", async () => {
    const { size, data } = await qrCodeModules("Attires Arena");
    const rects = qrModuleRects(size, data);
    const dark = Array.from(data).filter((bit) => bit === 1).length;
    expect(rects).toHaveLength(dark);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x).toBeLessThan(size);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeLessThan(size);
      expect(data[rect.y * size + rect.x]).toBe(1);
    }
  });
});

describe("invoice sheet copy and print hiding", () => {
  const sheet = readFileSync(
    new URL("../src/components/admin/sales/OrderInvoice.tsx", import.meta.url),
    "utf8",
  );
  const invoiceCss = readFileSync(new URL("../src/app/admin/invoice.css", import.meta.url), "utf8");
  const adminPanelCss = readFileSync(
    new URL("../src/app/admin/admin-panel.css", import.meta.url),
    "utf8",
  );

  it("ends with the thank-you line, below the website footer band", () => {
    const thanksAt = sheet.indexOf("Thank you for your shopping");
    expect(thanksAt).toBeGreaterThan(sheet.indexOf("aa-invoice-foot"));
    expect(sheet).toContain('className="aa-invoice-thanks"');
    const afterThanks = sheet.slice(
      sheet.indexOf("</p>", thanksAt) + "</p>".length,
      sheet.indexOf("</section>"),
    );
    expect(afterThanks.trim()).toBe("");
  });

  it("captions the QR code in both variants (unconditional figure)", () => {
    expect(sheet).toContain(
      '<figcaption className="aa-invoice-caption">Scan to see order details</figcaption>',
    );
    expect(sheet).not.toContain("Order Details QR");
    const figureAt = sheet.indexOf('<figure className="aa-invoice-code">');
    const figureEnd = sheet.indexOf("</figure>", figureAt);
    const captionAt = sheet.indexOf("Scan to see order details");
    expect(captionAt).toBeGreaterThan(figureAt);
    expect(captionAt).toBeLessThan(figureEnd);
    const codesAt = sheet.indexOf('className="aa-invoice-codes"');
    expect(sheet.slice(codesAt, figureAt)).not.toContain("trackingCode ? (");
  });

  it("captions the barcode only when tracking exists, below the number", () => {
    const conditionalAt = sheet.indexOf("{trackingCode ? (");
    const captionAt = sheet.indexOf("Scan to track the parcel");
    expect(captionAt).toBeGreaterThan(conditionalAt);
    expect(captionAt).toBeGreaterThan(sheet.indexOf("aa-invoice-tracking-number"));
    expect(sheet.indexOf("aa-invoice-tracking-number")).toBeGreaterThan(
      sheet.indexOf("<TrackingBarcode"),
    );
  });

  it("centers each code as one unit, so block-level svg/img cannot sit left of its caption", () => {
    const code = invoiceCss.slice(invoiceCss.indexOf(".aa-invoice-code {"));
    expect(code).toContain("display: flex;");
    expect(code).toContain("flex-direction: column;");
    expect(code).toContain("align-items: center;");
  });

  it("shares one centered caption style and a visible thank-you style", () => {
    expect(invoiceCss).toContain(".aa-invoice-caption {");
    const caption = invoiceCss.slice(invoiceCss.indexOf(".aa-invoice-caption {"));
    expect(caption).toContain("text-align: center;");
    expect(invoiceCss).toContain(".aa-invoice-thanks {");
    const thanks = invoiceCss.slice(invoiceCss.indexOf(".aa-invoice-thanks {"));
    expect(thanks).toContain("text-align: center;");
  });

  it("keeps the Total Payable label readable on the maroon band", () => {
    const payable = invoiceCss.slice(invoiceCss.indexOf(".aa-invoice-total-row--payable dt,"));
    expect(payable).toContain("color: rgb(var(--admin-card));");
  });

  it("keeps the printed page white even with background graphics on", () => {
    const print = adminPanelCss.slice(adminPanelCss.indexOf("@media print"));
    expect(print).toContain("background: #fff !important;");
  });

  it("hides the mobile bottom nav and other fixed chrome in print", () => {
    const print = adminPanelCss.slice(adminPanelCss.indexOf("@media print"));
    expect(print).toContain(".aa-admin-bottom,");
    expect(print).toContain(".aa-drawer,");
    expect(print).toContain(".aa-save-bar,");
    expect(print).toContain("display: none !important;");
    expect(print).toContain(".aa-content { margin: 0 !important; padding: 0 !important; }");
  });

  it("keeps the sheet margin-free in print so no stray gap spills page 2", () => {
    const print = invoiceCss.slice(invoiceCss.indexOf("@media print"));
    expect(print).toContain("margin: 0 !important;");
    expect(print).toContain(".aa-invoice-code {");
    expect(print).toContain("break-inside: avoid;");
  });
});
