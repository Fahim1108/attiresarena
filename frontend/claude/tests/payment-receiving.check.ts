import { afterEach, describe, expect, it, vi } from "vitest";
import { previewPaymentConfiguration, productionPaymentConfiguration, type PaymentReceivingConfig } from "../src/config/payment-receiving";
import { manualPaymentBreakdown } from "../src/lib/manual-payment";
import { submitManualPaymentAction } from "../src/services/manual-payment-actions";

afterEach(() => vi.unstubAllEnvs());

// Fake numbers only — no real receiving number may appear in the repo
// (security audit 2026-11-21: the old hardcoded preview number was removed).
const FAKE_BKASH = "01812345678";
const FAKE_NAGAD = "01700000000";
const fakeReceiving = (overrides: Partial<PaymentReceivingConfig> = {}): PaymentReceivingConfig => ({
  bkashNumber: FAKE_BKASH,
  nagadNumber: FAKE_NAGAD,
  bkashAuthorized: true,
  nagadAuthorized: true,
  ...overrides,
});

describe("production collection from owner-set numbers only", () => {
  const policy = previewPaymentConfiguration().policy;
  it("stays off with no numbers set, so no order can be placed", () => {
    expect(productionPaymentConfiguration(policy)).toEqual({ available: false, destinations: [], policy });
  });
  it("collects only the providers whose numbers are set and valid", () => {
    vi.stubEnv("MANUAL_PAYMENT_BKASH_NUMBER", FAKE_BKASH);
    expect(productionPaymentConfiguration(policy)).toEqual({
      available: true,
      destinations: [{ provider: "bkash", recipientNumber: FAKE_BKASH, accountType: "personal", transferInstructions: "" }],
      policy,
    });
  });
  it("ignores invalid numbers instead of collecting to them", () => {
    vi.stubEnv("MANUAL_PAYMENT_BKASH_NUMBER", "123");
    vi.stubEnv("MANUAL_PAYMENT_NAGAD_NUMBER", FAKE_NAGAD);
    const configuration = productionPaymentConfiguration(policy);
    expect(configuration.available).toBe(true);
    expect(configuration.destinations.map((d) => d.provider)).toEqual(["nagad"]);
  });
  it("derives receiving numbers only from env vars, never from code", () => {
    vi.stubEnv("MANUAL_PAYMENT_BKASH_NUMBER", "");
    vi.stubEnv("MANUAL_PAYMENT_NAGAD_NUMBER", "");
    expect(productionPaymentConfiguration(policy).destinations).toEqual([]);
    expect(previewPaymentConfiguration().destinations).toEqual([]);
  });
});

describe("preview configuration ships no receiving number without env", () => {
  it("shows no destinations when no numbers are set", () => {
    expect(previewPaymentConfiguration().destinations).toEqual([]);
    expect(previewPaymentConfiguration().available).toBe(false);
  });
  it("shows the env numbers in preview when they are set, still without enabling collection", () => {
    vi.stubEnv("MANUAL_PAYMENT_BKASH_NUMBER", FAKE_BKASH);
    const configuration = previewPaymentConfiguration();
    expect(configuration.destinations).toEqual([
      { provider: "bkash", recipientNumber: FAKE_BKASH, accountType: "personal", transferInstructions: "" },
    ]);
    expect(configuration.available).toBe(false);
  });
});

describe("central personal recipient configuration", () => {
  it("hides each unconfirmed receiving account", () => {
    expect(previewPaymentConfiguration(fakeReceiving({ bkashAuthorized: false, nagadAuthorized: false })).destinations).toEqual([]);
  });
  it("publishes only the provider that has been authorised", () => {
    const configuration = previewPaymentConfiguration(fakeReceiving({ nagadAuthorized: false }));
    expect(configuration.destinations).toEqual([{ provider: "bkash", accountType: "personal", recipientNumber: FAKE_BKASH, transferInstructions: "" }]);
    expect(configuration.available).toBe(false);
  });
  it("keeps separate editable numbers and never enables collection from account approval", () => {
    const configuration = previewPaymentConfiguration(fakeReceiving());
    expect(configuration.destinations.map(account => account.recipientNumber)).toEqual([FAKE_BKASH, FAKE_NAGAD]);
    expect(configuration.available).toBe(false);
    expect(configuration.destinations.every(account => account.transferInstructions === "")).toBe(true);
  });
  it("never publishes an invalid receiving number", () => {
    expect(previewPaymentConfiguration(fakeReceiving({ bkashNumber: "123", nagadNumber: "" })).destinations).toEqual([]);
  });
  it("continues rejecting direct server submissions regardless of public recipient display", async () => {
    const result = await submitManualPaymentAction({ provider: "bkash", transactionId: "TEST1", senderNumber: "01700000000", note: "", orderReference: "forged-reference", idempotencyKey: "11111111-1111-4111-8111-111111111111" });
    expect(result).toMatchObject({ ok: false, reason: "not_connected" });
  });
});

describe("one payment panel for advance and full payment", () => {
  const policy = previewPaymentConfiguration().policy;
  it("uses the COD advance with a remaining balance", () => {
    expect(manualPaymentBreakdown("cod", 200000, "Barishal", "Barishal", "Barishal Sadar", policy)).toMatchObject({ amountDueMinor: 5000, remainingMinor: 195000 });
    expect(manualPaymentBreakdown("cod", 200000, "Dhaka", "Gazipur", "Gazipur Sadar", policy)).toMatchObject({ amountDueMinor: 14000, remainingMinor: 186000 });
  });
  it("uses exactly the full total with no remaining COD balance for online preview", () => {
    expect(manualPaymentBreakdown("online", 200050, "Barishal", "Barishal", "Barishal Sadar", policy)).toEqual({ zone: "inside-barishal-city", totalMinor: 200050, amountDueMinor: 200050, remainingMinor: 0 });
  });
  it("does not invent a full-payment quote for missing locations or invalid totals", () => {
    expect(manualPaymentBreakdown("online", 200000, "", "", "", policy)).toBeNull();
    expect(manualPaymentBreakdown("online", -1, "Barishal", "Barishal", "Barishal Sadar", policy)).toBeNull();
  });
});
