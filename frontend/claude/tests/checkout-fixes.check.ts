import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AREAS, DIVISIONS, areasOf, districtsOf, divisionNames } from "../src/data/bangladesh";
import { COUPON_CODE_PATTERN, COUPON_REASON_MESSAGES, couponReasonMessage, fromMinorUnits, isCouponFresh, isWellFormedCouponCode, normalizeCouponCode, toMinorUnits } from "../src/lib/checkout/coupons";
import { createCheckoutService, validateCoupon, type CheckoutRpc } from "../src/lib/checkout/service";
import { applyCartAdd, MAX_UNITS_PER_ORDER } from "../src/lib/cart-limits";
import { CartProvider } from "../src/context/CartContext";
import { CouponField } from "../src/components/cart/CouponField";
import type { CartItem } from "../src/types";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const checkoutForm = read("../src/components/checkout/CheckoutForm.tsx");
const manualPayment = read("../src/components/checkout/ManualAdvancePayment.tsx");
const placeOrderActionSource = read("../src/services/actions.ts");
const ownerCatalogueSource = read("../src/services/adapters/owner-catalogue.ts");
const courierSource = read("../src/lib/admin/courier.ts");
const couponFieldSource = read("../src/components/cart/CouponField.tsx");

describe("upazila dataset", () => {
  it("covers all 8 divisions and all 64 districts", () => {
    expect(divisionNames).toHaveLength(8);
    const districts = Object.values(DIVISIONS).flat();
    expect(districts).toHaveLength(64);
    expect(new Set(districts).size).toBe(64);
  });

  it("gives every district a non-empty area list with no duplicates", () => {
    for (const district of Object.values(DIVISIONS).flat()) {
      const areas = areasOf(district);
      expect(areas.length).toBeGreaterThan(0);
      expect(new Set(areas).size).toBe(areas.length);
    }
    expect(Object.keys(AREAS)).toHaveLength(64);
  });

  it("totals 560 area options", () => {
    expect(Object.values(AREAS).flat().length).toBe(560);
  });

  it("keeps the Dhaka, Gazipur and Narayanganj lists intact", () => {
    expect(areasOf("Dhaka")).toHaveLength(43);
    expect(areasOf("Gazipur")).toHaveLength(6);
    expect(areasOf("Narayanganj")).toHaveLength(7);
    expect(areasOf("Dhaka")).toContain("Mirpur");
    expect(areasOf("Gazipur")).toContain("Tongi");
    expect(areasOf("Narayanganj")).toContain("Sonargaon");
  });

  it("unions the Chattogram and Sylhet lists with the dataset's upazilas", () => {
    // Every pre-existing entry is kept, and the missing upazilas are added.
    expect(areasOf("Chattogram")).toHaveLength(28);
    for (const kept of ["Agrabad", "Halishahar", "Khulshi", "Patenga"]) expect(areasOf("Chattogram")).toContain(kept);
    for (const added of ["Anwara", "Banshkhali", "Boalkhali", "Chandanaish", "Fatikchhari", "Karnaphuli", "Lohagara", "Mirsharai", "Rangunia", "Raozan", "Sandwip", "Satkania", "Bandar", "Bhujpur"]) {
      expect(areasOf("Chattogram")).toContain(added);
    }
    expect(areasOf("Sylhet")).toHaveLength(15);
    for (const kept of ["Ambarkhana", "Beanibazar", "Companiganj", "Golapganj", "Sylhet Sadar", "Zindabazar"]) expect(areasOf("Sylhet")).toContain(kept);
    for (const added of ["Balaganj", "Bishwanath", "Dakshin Surma", "Fenchuganj", "Gowainghat", "Jaintiapur", "Kanaighat", "Osmani Nagar", "Zakiganj"]) {
      expect(areasOf("Sylhet")).toContain(added);
    }
    expect(areasOf("Sylhet")).not.toContain("Companigonj");
  });

  it("sorts added lists A-Z", () => {
    const dinajpur = areasOf("Dinajpur");
    expect(dinajpur.indexOf("Biral")).toBeLessThan(dinajpur.indexOf("Birampur"));
    expect(dinajpur.indexOf("Birampur")).toBeLessThan(dinajpur.indexOf("Birganj"));
  });

  it("includes the documented corrections and additions", () => {
    expect(areasOf("Rajshahi")).toContain("Tanore");
    expect(areasOf("Bogura")).toContain("Mokamtola");
    expect(areasOf("Cox's Bazar")).toContain("Matamuhuri");
    expect(areasOf("Lakshmipur")).toContain("Chandraganj");
    expect(areasOf("Thakurgaon")).toContain("Ruhia");
    expect(areasOf("Thakurgaon")).toContain("Bhully");
    expect(areasOf("Manikganj")).toContain("Manikganj Sadar");
    expect(areasOf("Manikganj")).not.toContain("Manikgonj Sadar");
    expect(areasOf("Chapai Nawabganj")).toContain("Nawabganj Sadar");
    expect(areasOf("Jhenaidah")).toContain("Jhenaidah Sadar");
  });

  it("returns district-dependent options", () => {
    expect(areasOf("Dhaka")).not.toEqual(areasOf("Rajshahi"));
    expect(areasOf("Bogura")).toContain("Bogura Sadar");
    expect(areasOf("Bogura")).not.toContain("Tanore");
    expect(areasOf("No such district")).toEqual([]);
    expect(districtsOf("Dhaka")).toContain("Tangail");
    expect(districtsOf("Sylhet")).toEqual(["Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"]);
  });
});

describe("Bangla delivery form", () => {
  it("placeholders and hints are in Bangla, labels and heading are in English", () => {
    // Final owner spec: the heading and field labels are English, while
    // the placeholders inside the inputs, the helper hint and the
    // validation errors stay in Bangla.
    for (const text of [
      "আপনার নাম লিখুন",
      "অর্ডার নিশ্চিত করতে আমরা কল করব।",
      "বিভাগ বেছে নিন",
      "জেলা বেছে নিন",
      "আগে বিভাগ বেছে নিন",
      "এলাকা / উপজেলা বেছে নিন",
      "আগে জেলা বেছে নিন",
      "বাসা, রোড, এলাকার বিস্তারিত লিখুন",
    ]) {
      expect(checkoutForm).toContain(text);
    }
    for (const text of [
      ">Delivery Information</h2>",
      'label="Your name"',
      'label="Mobile number"',
      'label="Email (optional)"',
      'label="Division"',
      'label="District"',
      'label="Area / Upazila"',
      'label="Detailed address"',
      'label="Save this address for next time"',
      "Back to cart",
      "Continue to Payment",
    ]) {
      expect(checkoutForm).toContain(text);
    }
    expect(checkoutForm).toContain('lang="bn"');
  });

  it("validation errors are in Bangla", () => {
    for (const text of [
      "আপনার পুরো নাম লিখুন",
      "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (01XXXXXXXXX)",
      "সঠিক ইমেইল ঠিকানা দিন",
      "এলাকা / উপজেলা বেছে নিন",
      "বাসা, রোড ও এলাকার বিস্তারিত লিখুন",
    ]) {
      expect(checkoutForm).toContain(text);
    }
  });

  it("has no English placeholders, hints or validation errors left", () => {
    // The heading, labels, checkbox and buttons are deliberately NOT in
    // this list: the final owner spec keeps them in English. Only the
    // placeholders, the helper hint and the validation errors are Bangla,
    // so their pre-checkout-fixes English forms must be gone. The delivery
    // label ("Inside Barishal City" / "Outside Barishal City" / "Select a district to
    // calculate delivery") renders outside the delivery form and likewise
    // stays in English.
    for (const text of [
      "Enter your full name",
      "We'll call to confirm your order.",
      "Select division",
      "Select district",
      "Select division first",
      "Area / Thana",
      "House, road, area details",
      "Please enter your full name",
      "Select or enter your area",
    ]) {
      expect(checkoutForm).not.toContain(text);
    }
  });

  it("always renders the area as a select, never a free-text input", () => {
    expect(checkoutForm).not.toContain("areas.length ?");
    expect(checkoutForm).toContain('id="checkout-area" label="Area / Upazila"');
    expect(checkoutForm.match(/id="checkout-area"/g)).toHaveLength(1);
  });
});

describe("payment step has no continue button", () => {
  it('removes "Continue shopping": Submit Payment places the order', () => {
    // Owner 2026-11-20: no Continue shopping button on the payment step.
    // Submit Payment (onSubmitPayment -> placeOrder) is the only way
    // forward, straight to the Bangla confirmation screen.
    expect(checkoutForm).not.toContain("Review Order");
    expect(checkoutForm).not.toContain("Continue shopping");
    expect(checkoutForm).toContain("onSubmitPayment={(data) => placeOrder(data)}");
  });

  it("leaves the placed-order Continue Shopping link untouched", () => {
    expect(checkoutForm).toContain('>Continue Shopping</ButtonLink>');
  });
});

describe("single note field", () => {
  it("removes the upper payment-section note field", () => {
    expect(manualPayment).not.toContain("Note (optional)");
    expect(manualPayment).not.toContain("Textarea");
    expect(manualPayment).toContain('note: ""');
  });

  it("keeps only the lower order note, in English, feeding the payload", () => {
    // The Bangla-form correction reverted the note to the pre-checkout-fixes
    // English: the note lives in the Payment step, outside the delivery form.
    expect(checkoutForm).toContain('label="Order note (optional)"');
    expect(checkoutForm).toContain("Anything we should know? e.g. preferred delivery time");
    expect(checkoutForm).toContain("note: note.trim() || undefined");
    expect(checkoutForm).not.toContain("অর্ডার নোট");
  });
});

describe("coupon helpers", () => {
  it("normalizes codes to the database form", () => {
    expect(normalizeCouponCode(" welcome10 ")).toBe("WELCOME10");
    expect(normalizeCouponCode("save-20_x")).toBe("SAVE-20_X");
  });

  it("accepts only codes matching the database pattern", () => {
    expect(COUPON_CODE_PATTERN.test("WELCOME10")).toBe(true);
    expect(COUPON_CODE_PATTERN.test("A1-")).toBe(true);
    expect(isWellFormedCouponCode("SAVE_20")).toBe(true);
    expect(isWellFormedCouponCode("")).toBe(false);
    expect(isWellFormedCouponCode("AB")).toBe(false);
    expect(isWellFormedCouponCode("bad code!")).toBe(false);
    expect(isWellFormedCouponCode("A".repeat(31))).toBe(false);
  });

  it("converts totals to minor units with rounding, never float multiplication", () => {
    expect(toMinorUnits(550)).toBe(55000);
    expect(toMinorUnits(199.99)).toBe(19999);
    expect(fromMinorUnits(55000)).toBe(550);
    // A percent discount can leave fractional taka; `* 100` then yields
    // float residue the payment helpers reject.
    expect(toMinorUnits(109.98)).toBe(10998);
    expect(checkoutForm).not.toContain("summary.total * 100");
    expect(checkoutForm).toContain("toMinorUnits(summary.total)");
  });

  it("passes the coupon phone to the summary and the coupon field", () => {
    expect(checkoutForm).toContain("getSummary(form.division || undefined, form.district || undefined, form.area || undefined, couponPhone)");
    expect(checkoutForm).toContain("<CouponField phone={couponPhone} />");
  });

  it("has a guest-facing message for every reason", () => {
    for (const reason of Object.keys(COUPON_REASON_MESSAGES)) {
      expect(couponReasonMessage(reason as keyof typeof COUPON_REASON_MESSAGES).length).toBeGreaterThan(0);
    }
    expect(couponReasonMessage("first_order_only")).toBe("This coupon is for your first order only.");
    expect(couponReasonMessage("expired")).toMatch(/expired/i);
    expect(couponReasonMessage("below_minimum")).toMatch(/minimum/i);
  });

  it("treats a coupon as fresh only for its validated subtotal and phone", () => {
    const coupon = { validatedSubtotalMinor: 55000, validatedPhone: "01712345678" };
    expect(isCouponFresh(coupon, 55000, "01712345678")).toBe(true);
    expect(isCouponFresh(coupon, 54000, "01712345678")).toBe(false);
    expect(isCouponFresh(coupon, 55000, null)).toBe(false);
    expect(isCouponFresh(coupon, 55000, "01812345678")).toBe(false);
    expect(isCouponFresh({ validatedSubtotalMinor: 55000, validatedPhone: null }, 55000, null)).toBe(true);
    expect(isCouponFresh({ validatedSubtotalMinor: 55000, validatedPhone: null }, 55000, "01712345678")).toBe(false);
    expect(isCouponFresh(undefined, 55000, null)).toBe(false);
  });
});

describe("coupon validation service", () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpcFor = (data: unknown, code = "unknown"): CheckoutRpc => {
    return async <T,>(name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (data === "ERROR") return { ok: false, code } as never;
      return { ok: true, data: data as T };
    };
  };
  const input = { code: "welcome10", userId: "11111111-1111-1111-1111-111111111111", phone: "01712345678", subtotalMinor: 55000 };

  it("passes the normalized code, user, phone and subtotal to validate_coupon", async () => {
    calls.length = 0;
    const result = await validateCoupon(rpcFor({ valid: true, reason: null, discount_minor: 5500 }), input);
    expect(result).toEqual({ ok: true, valid: true, discountMinor: 5500 });
    expect(calls).toEqual([
      { name: "validate_coupon", args: { p_code: "WELCOME10", p_user_id: input.userId, p_phone: "01712345678", p_subtotal_minor: 55000 } },
    ]);
  });

  it("passes each ineligibility reason through unchanged", async () => {
    for (const reason of ["not_found", "inactive", "not_yet_valid", "expired", "below_minimum", "usage_limit_reached", "per_customer_limit_reached", "first_order_only"] as const) {
      const result = await validateCoupon(rpcFor({ valid: false, reason, discount_minor: 0 }), input);
      expect(result).toEqual({ ok: true, valid: false, reason });
    }
  });

  it("rejects malformed input locally without calling the RPC", async () => {
    calls.length = 0;
    expect(await validateCoupon(rpcFor({ valid: true, reason: null, discount_minor: 1 }), { ...input, code: "bad code!" })).toEqual({
      ok: true,
      valid: false,
      reason: "invalid_request",
    });
    expect(await validateCoupon(rpcFor({ valid: true, reason: null, discount_minor: 1 }), { ...input, subtotalMinor: -1 })).toEqual({
      ok: true,
      valid: false,
      reason: "invalid_request",
    });
    expect(calls).toHaveLength(0);
  });

  it("reports a failed check honestly instead of inventing a discount", async () => {
    expect(await validateCoupon(rpcFor("ERROR", "PGRST202"), input)).toEqual({ ok: false });
    expect(await validateCoupon(rpcFor(null), input)).toEqual({ ok: false });
    expect(await validateCoupon(rpcFor({ valid: true, reason: null, discount_minor: "5500" }), input)).toEqual({ ok: false });
    expect(await validateCoupon(rpcFor({ valid: true, reason: null, discount_minor: -5 }), input)).toEqual({ ok: false });
    expect(await validateCoupon(rpcFor({ valid: false, reason: "nope", discount_minor: 0 }), input)).toEqual({ ok: false });
    expect(await validateCoupon(rpcFor({ nope: true }), input)).toEqual({ ok: false });
  });
});

describe("coupon at place time", () => {
  const CLIENT = "a".repeat(64);
  const V1 = "22222222-2222-4222-8222-222222222222";
  const orderInput = (over: Record<string, unknown> = {}) => ({
    customer: { fullName: "Nasrin Akter", phone: "01712345678" },
    items: [{ variantId: V1, quantity: 1 }],
    address: { division: "Dhaka", district: "Dhaka", area: "Mirpur", addressLine: "House 3, Block B" },
    paymentMethod: "cod",
    ...over,
  });
  function mockRpc(placeBehavior: (args: Record<string, unknown>) => { ok: true; data: unknown } | { ok: false; code: string }) {
    const placeCalls: Record<string, unknown>[] = [];
    const rpc: CheckoutRpc = async <T,>(name: string, args: Record<string, unknown>) => {
      if (name === "start_checkout_session") return { ok: true, data: { token: "b".repeat(64), expires_at: new Date(Date.now() + 3600_000).toISOString() } as T };
      if (name === "set_checkout_items" || name === "update_checkout_contact") return { ok: true, data: {} as T };
      if (name === "place_checkout_order") {
        placeCalls.push(args);
        return placeBehavior(args) as never;
      }
      return { ok: false, code: "unknown" } as never;
    };
    const jar = { value: undefined as string | undefined, get() { return this.value; }, set(t: string) { this.value = t; }, clear() { this.value = undefined; } };
    return { rpc, jar, placeCalls };
  }
  const placedRow = { order_number: 10001, total_minor: 49500, placed_at: new Date().toISOString(), already_placed: false, items: null };

  it("sends p_coupon_code only when a coupon is applied", async () => {
    const withCoupon = mockRpc(() => ({ ok: true, data: placedRow }));
    const ok = await createCheckoutService(withCoupon.rpc, withCoupon.jar, { clientKey: CLIENT }).placeOrder(orderInput({ couponCode: "WELCOME10" }));
    expect(ok.ok).toBe(true);
    expect(withCoupon.placeCalls[0]?.p_coupon_code).toBe("WELCOME10");

    const withoutCoupon = mockRpc(() => ({ ok: true, data: placedRow }));
    const ok2 = await createCheckoutService(withoutCoupon.rpc, withoutCoupon.jar, { clientKey: CLIENT }).placeOrder(orderInput());
    expect(ok2.ok).toBe(true);
    expect(withoutCoupon.placeCalls[0]).not.toHaveProperty("p_coupon_code");
  });

  it("maps a CK009 refusal to the coupon message", async () => {
    const db = mockRpc(() => ({ ok: false, code: "CK009" }));
    const result = await createCheckoutService(db.rpc, db.jar, { clientKey: CLIENT }).placeOrder(orderInput({ couponCode: "WELCOME10" }));
    expect(result).toEqual({ ok: false, reason: "validation", message: "This coupon could not be applied to your order. Remove the coupon and try again." });
  });

  it("never places silently at full price when the database has no coupon support", async () => {
    const db = mockRpc(() => ({ ok: false, code: "PGRST202" }));
    const result = await createCheckoutService(db.rpc, db.jar, { clientKey: CLIENT }).placeOrder(orderInput({ couponCode: "WELCOME10" }));
    expect(result).toEqual({ ok: false, reason: "validation", message: "Coupons are not available yet. Remove the coupon to place your order." });
  });

  it("keeps the generic failure for a missing function without a coupon", async () => {
    const db = mockRpc(() => ({ ok: false, code: "PGRST202" }));
    const result = await createCheckoutService(db.rpc, db.jar, { clientKey: CLIENT }).placeOrder(orderInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toMatch(/coupon/i);
  });
});

describe("coupon field", () => {
  it("renders the apply form with no sign-in gate", () => {
    const html = renderToStaticMarkup(createElement(CartProvider, null, createElement(CouponField)));
    expect(html).toContain("Enter coupon code");
    expect(html).toContain("Apply");
    expect(html).not.toMatch(/sign in/i);
  });

  it("uses the coupon action, not the redemption stub", () => {
    expect(couponFieldSource).toContain("checkCouponAction");
    expect(couponFieldSource).not.toContain("redeemRewardAction");
    expect(couponFieldSource).not.toContain("LoginForm");
  });
});

describe("cart limit regression", () => {
  const lineInput = (id: string): Omit<CartItem, "quantity"> => ({
    id,
    productId: `p-${id}`,
    productSlug: `slug-${id}`,
    variantId: `v-${id}`,
    name: `Shirt ${id}`,
    brandName: "",
    image: { src: "/x.jpg", alt: `Shirt ${id}` },
    colorName: "Blue",
    size: "M",
    unitPrice: 550,
    maxQuantity: 99,
  });

  it("still refuses the 11th unit", () => {
    expect(MAX_UNITS_PER_ORDER).toBe(10);
    let lines: CartItem[] = [];
    for (let n = 1; n <= 10; n += 1) {
      const next = applyCartAdd(lines, lineInput(`l${n}`), 1);
      expect(next.result.refused).toBe(false);
      lines = next.lines;
    }
    expect(applyCartAdd(lines, lineInput("l11"), 1).result.refused).toBe(true);
  });
});

describe("coupon migration (authored only, never applied here)", () => {
  const sql = readFileSync(join(here, "..", "..", "..", "supabase", "migrations", "20261118000100_checkout_coupon_support.sql"), "utf8");
  const body = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("replaces the six-argument function with a seven-argument one", () => {
    expect(body).toContain("drop function public.place_checkout_order(text, jsonb, text, text, text, jsonb);");
    expect(body).toContain("p_coupon_code text default null");
    expect(body).toContain("public.place_checkout_order(text,jsonb,text,text,text,jsonb,text)");
  });

  it("validates the coupon, nets the discount and records one redemption", () => {
    expect(body).toContain("public.validate_coupon(clean_code, s.user_id, v_phone, subtotal)");
    expect(body).toContain("using errcode = 'CK009'");
    expect(body).toContain("total := subtotal + delivery_charge - discount;");
    expect(body).toContain("insert into public.coupon_redemptions(coupon_id, user_id, phone, order_id)");
    expect(body).toContain("for update");
  });

  it("grants the new signature and the guest coupon check, and runs in one transaction", () => {
    expect(body).toContain("grant execute on function public.validate_coupon(text, uuid, text, bigint) to service_role;");
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
});

describe("advance payment required before order", () => {
  it("keeps the payment details in checkout state and validates them before placing", () => {
    expect(checkoutForm).toContain("const [paymentDetails, setPaymentDetails] = useState<{ provider: AdvanceProvider; transactionId: string; senderNumber: string } | null>(null);");
    expect(checkoutForm).toContain("const details = paymentData ?? validatePaymentState();");
    expect(checkoutForm).toContain("payment: { provider: details.provider, transactionId: details.transactionId, senderNumber: details.senderNumber, idempotencyKey: details.idempotencyKey },");
  });

  it("refuses to place or review without payment details, and sends the customer back to the payment step", () => {
    expect(checkoutForm).toContain("if (step === 1 && !validatePaymentState()) {");
    expect(checkoutForm).toContain("if (!details) {");
    expect(checkoutForm).toContain("setStep(1);");
    expect(checkoutForm).toContain("অগ্রিম পেমেন্টের তথ্য দিন");
  });

  it("places the order from Submit Payment with the validated details, and shows them on Review", () => {
    expect(checkoutForm).toContain("onDetailsChange={handlePaymentDetailsChange}");
    expect(checkoutForm).toContain("onSubmitPayment={(data) => placeOrder(data)}");
    expect(checkoutForm).toContain("TxID {paymentDetails.transactionId}");
  });

  it("shows the Bangla received message with Continue Shopping after placing", () => {
    // Owner's success screen (2026-11-19 mockup): order-ID pill, received
    // message, total pill in Bengali digits, phone-update line, save-the-ID
    // line, Continue Shopping — and no "রসিদ" title.
    expect(checkoutForm).toContain("অর্ডার আইডি:");
    expect(checkoutForm).toContain("আপনার অর্ডারটি গ্রহণ করা হয়েছে।");
    expect(checkoutForm).toContain("মোট বিল:");
    expect(checkoutForm).toContain("formatPriceBangla(placed.total)");
    expect(checkoutForm).toContain("পেমেন্ট কনফার্ম হওয়ার পর আপনাকে ফোন করে ডেলিভারি আপডেট জানানো হবে।");
    expect(checkoutForm).toContain("অনুগ্রহ করে আপনার অর্ডার আইডিটি সংরক্ষণ করুন।");
    expect(checkoutForm).toContain(">Continue Shopping</ButtonLink>");
    expect(checkoutForm).not.toContain("রসিদ");
    expect(checkoutForm).not.toContain("পেমেন্ট ভেরিফিকেশনের পর");
    expect(checkoutForm).not.toContain("ফোনে কনফার্ম করা হবে");
    expect(checkoutForm).not.toContain("ক্যাশ অন ডেলিভারি");
  });

  it("hands validated checkout details to the parent instead of the standalone submission", () => {
    expect(manualPayment).toContain("onSubmitPayment?: (data: PaymentSubmissionInput) => void");
    expect(manualPayment).toContain("const canSubmit = orderReference ? configuration.available && !!destination && !!breakdown : !!destination && !!breakdown;");
    expect(manualPayment).toContain("if (onSubmitPayment) onSubmitPayment(parsed.data);");
  });

  it("fails the order closed on the server: collection gate first, then payment validation, then the note", () => {
    expect(placeOrderActionSource).toContain("if (!configuration.available) {");
    expect(placeOrderActionSource).toContain('validatePaymentDetails({ ...(payload.payment ?? {}), note: "", orderReference: null })');
    expect(placeOrderActionSource).toContain("return dataSource.placeOrder({ ...payload, note: buildOrderNote(parsed.data, payload.note) });");
  });

  it("collects advance payment on production only from owner-set numbers, never the preview number", () => {
    expect(ownerCatalogueSource).toContain("if(isProductionStorefront())return productionPaymentConfiguration(configuration.policy);");
    expect(ownerCatalogueSource).toContain("return reviewInventoryEnabled()?configuration:{...configuration,destinations:[],available:false};");
  });

  it("never sends the payment line to the courier", () => {
    expect(courierSource).toContain('stripPaymentNoteLine(order.note?.trim() ?? "")');
  });
});
