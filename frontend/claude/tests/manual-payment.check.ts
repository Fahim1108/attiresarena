import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceBreakdown, buildOrderNote, canDisplayConfirmedOrder, classifyAdvanceLocation, formatPaymentAmount, formatPaymentNoteLine, stripPaymentNoteLine, validatePaymentDetails } from "../src/lib/manual-payment";
import { submitManualPaymentAction } from "../src/services/manual-payment-actions";
import { mockDataSource } from "../src/services/adapters/mock";

const policy = { insideDhakaMinor: 7000, outsideDhakaMinor: 13000, credit: "against-order-total" as const };
const input = { provider: "bkash", transactionId: " AbC-123 ", senderNumber: " +880 1700-000000 ", note: " Test note ", idempotencyKey: "11111111-1111-4111-8111-111111111111", orderReference: null };
afterEach(() => vi.restoreAllMocks());

describe("location and precision-safe advance breakdown", () => {
  it("credits 70 inside Dhaka against the total, without adding delivery again", () => {
    expect(advanceBreakdown(200000, "Dhaka", "Dhaka", policy)).toEqual({ zone: "inside-dhaka", totalMinor: 200000, advanceMinor: 7000, remainingMinor: 193000 });
  });
  it("credits 130 outside Dhaka and includes 64-district classification", () => {
    expect(advanceBreakdown(200000, "Chattogram", "Cumilla", policy)?.remainingMinor).toBe(187000);
    expect(classifyAdvanceLocation("Dhaka", "Gazipur")).toBe("outside-dhaka");
  });
  it("rejects mismatched, missing, invented and arbitrary inside/outside labels", () => {
    for (const [division, district] of [["", ""], ["Dhaka", "inside-dhaka"], ["Sylhet", "Dhaka"], ["Unknown", "Dhaka"]] as const) expect(advanceBreakdown(200000, division, district, policy)).toBeNull();
  });
  it("rejects unsafe or insufficient totals and invalid policies", () => {
    for (const total of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 6000]) expect(advanceBreakdown(total, "Dhaka", "Dhaka", policy)).toBeNull();
    expect(advanceBreakdown(200000, "Dhaka", "Dhaka", { ...policy, insideDhakaMinor: -1 })).toBeNull();
  });
  it("uses integer minor units for fractional BDT too", () => {
    expect(advanceBreakdown(200050, "Dhaka", "Dhaka", policy)?.remainingMinor).toBe(193050);
    expect(formatPaymentAmount(7000)).toBe("৳70");
    expect(formatPaymentAmount(7050)).toBe("৳70.50");
  });
});

describe("manual payment validation and fail-closed action", () => {
  it("trims IDs and notes, normalizes Bangladesh phone numbers, and preserves provider case", () => {
    expect(validatePaymentDetails(input)).toEqual({ ok: true, data: { ...input, transactionId: "AbC-123", senderNumber: "+8801700000000", note: "Test note" } });
  });
  it("does not impose a provider-specific transaction length", () => {
    for (const transactionId of ["A", "ABC123456789012345678901234567890", "Ref_1.2-3"]) expect(validatePaymentDetails({ ...input, transactionId }).ok).toBe(true);
  });
  it("rejects missing, non-text, unsafe or unbounded transaction details", () => {
    for (const transactionId of ["", "   ", "abc 123", "<script>", 123, "A".repeat(129)]) expect(validatePaymentDetails({ ...input, transactionId }).ok).toBe(false);
    expect(validatePaymentDetails({ ...input, note: "x".repeat(1001) }).ok).toBe(false);
    expect(validatePaymentDetails({ ...input, note: {} }).ok).toBe(false);
  });
  it("rejects invalid phones, providers, references and idempotency keys", () => {
    for (const senderNumber of ["123", "01200000000", "abc", "017000000000"]) expect(validatePaymentDetails({ ...input, senderNumber }).ok).toBe(false);
    expect(validatePaymentDetails({ ...input, provider: "unknown" }).ok).toBe(false);
    expect(validatePaymentDetails({ ...input, orderReference: {} }).ok).toBe(false);
    expect(validatePaymentDetails({ ...input, idempotencyKey: "-".repeat(36) }).ok).toBe(false);
  });
  it("returns validation errors from the server without invoking the adapter", async () => {
    const write = vi.spyOn(mockDataSource, "submitManualPayment");
    expect(await submitManualPaymentAction({ ...input, transactionId: "" })).toMatchObject({ ok: false, reason: "validation" });
    expect(write).not.toHaveBeenCalled();
  });
  it("never activates payments from caller configuration, claimed status or a forged reference", async () => {
    const write = vi.spyOn(mockDataSource, "submitManualPayment");
    const result = await submitManualPaymentAction({ ...input, available: true, status: "advance_verified", orderReference: "forged-order" });
    expect(result).toMatchObject({ ok: false, reason: "not_connected" });
    expect(write).not.toHaveBeenCalled();
  });
  it("never accepts repeated transaction submissions as verified payments", async () => {
    const results = await Promise.all([submitManualPaymentAction(input), submitManualPaymentAction(input)]);
    expect(results.every(result => !result.ok && result.reason === "not_connected")).toBe(true);
    expect((await mockDataSource.getManualPaymentConfiguration()).available).toBe(false);
  });
});

describe("payment reference on the order note", () => {
  it("labels the provider, TxID and sender number on one fixed-prefix line", () => {
    expect(formatPaymentNoteLine("bkash", "ABC123", "01700000000")).toBe("[Advance payment] bKash TxID ABC123, sender 01700000000.");
    expect(formatPaymentNoteLine("nagad", "X9", "01800000000")).toBe("[Advance payment] Nagad TxID X9, sender 01800000000.");
  });

  it("puts the payment line first and keeps the customer note within 500 chars", () => {
    const note = buildOrderNote({ provider: "bkash", transactionId: "ABC123", senderNumber: "01700000000" }, "Please call before delivery");
    expect(note.startsWith("[Advance payment] bKash TxID ABC123, sender 01700000000.")).toBe(true);
    expect(note).toContain("Please call before delivery");
    expect(buildOrderNote({ provider: "bkash", transactionId: "A".repeat(128), senderNumber: "01700000000" }, "x".repeat(600)).length).toBeLessThanOrEqual(500);
    expect(buildOrderNote({ provider: "bkash", transactionId: "ABC123", senderNumber: "01700000000" })).toBe("[Advance payment] bKash TxID ABC123, sender 01700000000.");
  });

  it("strips only the payment line for external payloads", () => {
    const note = buildOrderNote({ provider: "nagad", transactionId: "T1", senderNumber: "01700000000" }, "Leave at the gate");
    expect(stripPaymentNoteLine(note)).toBe("Leave at the gate");
    expect(stripPaymentNoteLine(note.split("\n")[0])).toBe("");
    expect(stripPaymentNoteLine("Leave at the gate")).toBe("Leave at the gate");
    expect(stripPaymentNoteLine(null)).toBe("");
  });
});

describe("order outcome consistency", () => {
  const receipt = { orderId: "test-order", orderReference: "test-reference", createdAt: "2026-10-25T00:00:00Z", orderStatus: "confirmed", advanceStatus: "advance_verified", provider: "bkash", totalMinor: 200000, advanceMinor: 7000, remainingMinor: 193000 };
  it("permits only a consistent verified confirmation receipt", () => expect(canDisplayConfirmedOrder(receipt)).toBe(true));
  it("does not confirm submitted, reviewed, unverified or inconsistent orders", () => {
    for (const value of [null, {}, { ...receipt, orderStatus: "pending_payment" }, { ...receipt, advanceStatus: "submitted" }, { ...receipt, advanceStatus: "under_review" }, { ...receipt, remainingMinor: 200000 }, { ...receipt, orderId: "" }, { ...receipt, createdAt: "bad" }, { ...receipt, advanceMinor: 0 }, { ...receipt, provider: "unknown" }]) expect(canDisplayConfirmedOrder(value)).toBe(false);
  });
});
