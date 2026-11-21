import { describe, expect, it } from "vitest";
import {
  buildOrderNote,
  formatPaymentNoteLine,
  parsePaymentNoteLine,
} from "../src/lib/manual-payment";
import {
  PAYMENT_SUBMISSION_STATUSES,
  paymentProviderLabel,
  paymentSubmissionStatusLabel,
  shortTransactionId,
} from "../src/lib/admin/format";
import {
  orderFilters,
  ordersToCsv,
  paymentSubmissionSchema,
  type PaymentSubmission,
} from "../src/lib/admin/orders";
import {
  buildOrderNoticeMessage,
  toOrderNotice,
  type OrderNotificationData,
} from "../src/lib/admin/telegram";
import { invoiceItemRows } from "../src/components/admin/sales/invoice-helpers";

const SUBMISSION: PaymentSubmission = {
  id: "11111111-1111-4111-8111-111111111111",
  order_id: "22222222-2222-4222-8222-222222222222",
  provider: "bkash",
  transaction_id: "ABC123XYZ789",
  sender_number: "01712345678",
  advance_minor: 13000,
  status: "submitted",
  submitted_at: "2026-11-21T05:00:00.000Z",
  verified_at: null,
  verified_by: null,
  idempotency_key: "33333333-3333-4333-8333-333333333333",
};

function noticeData(over: Partial<OrderNotificationData> = {}): OrderNotificationData {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    order_number: 10001,
    customer_name: "Ayesha Rahman",
    phone: "01712345678",
    email: null,
    division: "Dhaka",
    district: "Dhaka",
    area: "Tongi",
    address_line: "House 3, Block B",
    subtotal_minor: 45000,
    delivery_charge_minor: 13000,
    discount_minor: 0,
    total_minor: 58000,
    payment_method: "cod",
    payment_status: "unpaid",
    items: [
      {
        product_name: "Casual shirt",
        size: "M",
        color: "Standard",
        quantity: 1,
        unit_price_minor: 45000,
        line_total_minor: 45000,
      },
    ],
    ...over,
  };
}

describe("payment note line round-trip", () => {
  it("builds the fixed line and parses it back to the same fields", () => {
    const line = formatPaymentNoteLine("bkash", "ABC123XYZ789", "01712345678");
    expect(line).toBe("[Advance payment] bKash TxID ABC123XYZ789, sender 01712345678.");
    expect(parsePaymentNoteLine(line)).toEqual({
      provider: "bkash",
      transactionId: "ABC123XYZ789",
      senderNumber: "01712345678",
    });
    expect(parsePaymentNoteLine(formatPaymentNoteLine("nagad", "NAG-99.1", "01812345678"))).toEqual({
      provider: "nagad",
      transactionId: "NAG-99.1",
      senderNumber: "01812345678",
    });
  });

  it("parses the line out of a full order note that also carries a customer note", () => {
    const note = buildOrderNote(
      { provider: "bkash", transactionId: "TX1", senderNumber: "01712345678" },
      "Please call before delivery.",
    );
    expect(parsePaymentNoteLine(note)).toEqual({
      provider: "bkash",
      transactionId: "TX1",
      senderNumber: "01712345678",
    });
  });

  it("returns null for notes without a payment line or with a malformed one", () => {
    expect(parsePaymentNoteLine(null)).toBeNull();
    expect(parsePaymentNoteLine("")).toBeNull();
    expect(parsePaymentNoteLine("Please call before delivery.")).toBeNull();
    expect(parsePaymentNoteLine("[Advance payment] bKash TxID , sender 01712345678.")).toBeNull();
    expect(parsePaymentNoteLine("[Advance payment] bKash TxID TX1, sender 0123.")).toBeNull();
  });
});

describe("payment submission shape and labels", () => {
  it("accepts a valid submission row and rejects bad provider or status", () => {
    expect(paymentSubmissionSchema.safeParse(SUBMISSION).success).toBe(true);
    expect(
      paymentSubmissionSchema.safeParse({ ...SUBMISSION, provider: "rocket" }).success,
    ).toBe(false);
    expect(
      paymentSubmissionSchema.safeParse({ ...SUBMISSION, status: "pending" }).success,
    ).toBe(false);
    expect(PAYMENT_SUBMISSION_STATUSES).toEqual(["submitted", "verified", "rejected"]);
  });

  it("labels statuses and providers in staff words", () => {
    expect(paymentSubmissionStatusLabel("submitted")).toBe("Needs verification");
    expect(paymentSubmissionStatusLabel("verified")).toBe("Verified");
    expect(paymentSubmissionStatusLabel("rejected")).toBe("Rejected");
    expect(paymentSubmissionStatusLabel("unknown")).toBe("Needs verification");
    expect(paymentProviderLabel("bkash")).toBe("bKash");
    expect(paymentProviderLabel("nagad")).toBe("Nagad");
  });

  it("shortens long TxIDs for tight list cells and keeps short ones whole", () => {
    expect(shortTransactionId("ABC123XYZ7890")).toBe("ABC123XY…");
    expect(shortTransactionId("TX1")).toBe("TX1");
    expect(shortTransactionId("123456789012")).toBe("123456789012");
  });
});

describe("telegram notice with the advance payment", () => {
  it("adds the advance-payment block after the Payment section when a submission exists", () => {
    const message = buildOrderNoticeMessage(
      toOrderNotice(
        noticeData({
          payment_submission: {
            provider: "bkash",
            transaction_id: "ABC123XYZ789",
            sender_number: "01712345678",
            advance_minor: 13000,
            status: "submitted",
            submitted_at: "2026-11-21T05:00:00.000Z",
          },
        }),
      ),
    );
    expect(message).toContain("💳 Advance payment");
    expect(message).toContain("• Method: bKash");
    expect(message).toContain("• TxID: ABC123XYZ789");
    expect(message).toContain("• Sender: 01712345678");
    expect(message).toContain("• Advance: ৳130");
    expect(message).toContain("• Status: Needs verification");
    // The block comes after the Payment section, not before the totals.
    expect(message.indexOf("💳 Advance payment")).toBeGreaterThan(message.indexOf("💰 Payment"));
    expect(message.indexOf("• Total:")).toBeLessThan(message.indexOf("💳 Advance payment"));
  });

  it("omits the block when no submission was recorded, and old payloads still parse", () => {
    const without = noticeData({ payment_submission: null });
    expect(buildOrderNoticeMessage(toOrderNotice(without))).not.toContain("💳 Advance payment");
    const legacy = noticeData();
    delete legacy.payment_submission;
    expect(toOrderNotice(legacy).advancePayment).toBeNull();
    expect(buildOrderNoticeMessage(toOrderNotice(legacy))).not.toContain(
      "💳 Advance payment",
    );
  });
});

describe("orders CSV with payment columns", () => {
  const row = {
    order_number: 10001,
    placed_at: "2026-11-10T04:00:00.000Z",
    customer_name: "Test Customer",
    phone: "01712345678",
    status: "pending",
    payment_status: "unpaid",
    subtotal_minor: 100000,
    delivery_charge_minor: 13000,
    discount_minor: 0,
    total_minor: 113000,
  };

  it("appends the payment columns at the end, after Total", () => {
    const csv = ordersToCsv([{ ...row, payment: SUBMISSION }]);
    const header = (csv.split("\r\n")[0] ?? "").replace(/^\uFEFF/, "");
    expect(header.endsWith("Payment provider,TxID,Sender number,Advance (BDT),Payment verification")).toBe(true);
    expect(csv).toContain("bKash,ABC123XYZ789,01712345678,130.00,Needs verification");
    expect(csv).not.toMatch(/sku/i);
  });

  it("leaves the payment columns blank when no submission was recorded", () => {
    const csv = ordersToCsv([{ ...row, payment: null }]);
    expect(csv).toContain("1130.00,,,,");
  });
});

describe("orders verify filter", () => {
  it("parses verify=awaiting and drops anything else", () => {
    expect(orderFilters({ verify: "awaiting" }).verify).toBe("awaiting");
    expect(orderFilters({ verify: "all" }).verify).toBe("");
    expect(orderFilters({}).verify).toBe("");
  });
});

describe("invoice item rows carry the product photo", () => {
  it("preserves imageUrl and imageAlt through the row, with a name fallback", () => {
    const rows = invoiceItemRows([
      {
        product_name: "Casual shirt",
        size: "M",
        color: "Maroon",
        quantity: 1,
        unit_price_minor: 45000,
        line_total_minor: 45000,
        imageUrl: "https://example.invalid/cover.jpg",
        imageAlt: "Casual shirt front",
      },
      {
        product_name: "Check shirt",
        size: "L",
        color: "",
        quantity: 1,
        unit_price_minor: 49900,
        line_total_minor: 49900,
        imageUrl: null,
      },
    ]);
    expect(rows[0]).toEqual({
      sl: "01",
      description: "Casual shirt",
      size: "M",
      color: "Maroon",
      quantity: 1,
      unitPriceMinor: 45000,
      lineTotalMinor: 45000,
      imageUrl: "https://example.invalid/cover.jpg",
      imageAlt: "Casual shirt front",
    });
    expect(rows[1]?.imageUrl).toBeNull();
    expect(rows[1]?.imageAlt).toBe("Check shirt");
  });
});
