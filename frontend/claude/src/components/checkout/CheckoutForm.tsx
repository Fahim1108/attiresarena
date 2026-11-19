"use client";

import { ArrowLeft, ArrowRight, Lock, PackageCheck, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CouponField } from "@/components/cart/CouponField";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { Button, ButtonLink, Checkbox, DemoNotice, EmptyState, Input, Modal, Select, CheckoutSkeleton, SmartImage, Textarea } from "@/components/ui";
import { commerce } from "@/config";
import { useCart } from "@/context/CartContext";
import { areasOf, districtsOf, divisionNames, isInsideDhaka } from "@/data/bangladesh";
import { canPlaceOrder } from "@/lib/checkout/gate";
import { toMinorUnits } from "@/lib/checkout/coupons";
import { formatPrice } from "@/lib/format";
import { isValidBdPhone, isValidEmail, normalizePhone, type FieldErrors } from "@/lib/validation";
import { placeOrderAction, saveCheckoutProgressAction } from "@/services/actions";
import type { CheckoutPayload, PaymentMethod } from "@/types";
import { CheckoutSteps } from "./CheckoutSteps";
import { PaymentMethodSelector } from "./PaymentMethodSelector";
import { ManualAdvancePayment } from "./ManualAdvancePayment";
import { advanceBreakdown, formatPaymentAmount, validatePaymentDetails } from "@/lib/manual-payment";
import type { AdvanceProvider, ManualPaymentConfiguration, PaymentSubmissionInput } from "@/types/manual-payment";

type Field = "fullName" | "phone" | "email" | "division" | "district" | "area" | "addressLine";

const STEPS = ["Delivery", "Payment", "Review"];

export function CheckoutForm({ manualPaymentConfiguration, orderingEnabled = false, isProduction = false }: { manualPaymentConfiguration: ManualPaymentConfiguration; orderingEnabled?: boolean; isProduction?: boolean }) {
  const { items, hydrated, getSummary, clear } = useCart();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Record<Field, string>>({ fullName: "", phone: "", email: "", division: "", district: "", area: "", addressLine: "" });
  const [note, setNote] = useState("");
  const [saveAddress, setSaveAddress] = useState(true);
  const [payment, setPayment] = useState<PaymentMethod>("cod");
  // Advance payment details, lifted from the payment step. No order is
  // placed without them (client convenience only; the server re-validates).
  const [paymentDetails, setPaymentDetails] = useState<{ provider: AdvanceProvider; transactionId: string; senderNumber: string } | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const paymentKeyRef = useRef<string | null>(null);
  if (paymentKeyRef.current == null) paymentKeyRef.current = crypto.randomUUID();
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [result, setResult] = useState<{ title: string; message: string; payload: CheckoutPayload } | null>(null);
  const [placed, setPlaced] = useState<{ orderNumber: string; total?: number; phone: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const firstStepRender = useRef(true);

  // Moving between steps unmounts the clicked button, which drops keyboard
  // focus. Move focus to the new step's heading instead (announced, no scroll).
  useEffect(() => {
    if (firstStepRender.current) {
      firstStepRender.current = false;
      return;
    }
    panelRef.current?.querySelector("h2")?.focus({ preventScroll: true });
  }, [step]);

  const orderable = canPlaceOrder(orderingEnabled, manualPaymentConfiguration.available);
  // The coupon phone: a valid normalized number, else null. Shared by the
  // summary (coupon freshness) and the coupon field (per-customer counting).
  const couponPhone = isValidBdPhone(form.phone) ? normalizePhone(form.phone) : null;
  const summary = getSummary(form.district || undefined, couponPhone);
  // Totals can hold fractional taka once a percent discount applies; round
  // to minor units instead of multiplying, which can leave float residue
  // that the payment helpers reject.
  const advance = payment === "cod" ? advanceBreakdown(toMinorUnits(summary.total), form.division, form.district, manualPaymentConfiguration.policy) : null;
  const districts = useMemo(() => districtsOf(form.division), [form.division]);
  const areas = useMemo(() => areasOf(form.district), [form.district]);

  const set = (field: Field, value: string) => {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === "division") Object.assign(next, { district: "", area: "" });
      if (field === "district") next.area = "";
      return next;
    });
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const validate = (): boolean => {
    const e: FieldErrors<Field> = {};
    if (form.fullName.trim().length < 3) e.fullName = "আপনার পুরো নাম লিখুন";
    if (!isValidBdPhone(form.phone)) e.phone = "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (01XXXXXXXXX)";
    if (form.email && !isValidEmail(form.email)) e.email = "সঠিক ইমেইল ঠিকানা দিন";
    if (!form.division) e.division = "বিভাগ বেছে নিন";
    if (!form.district) e.district = "জেলা বেছে নিন";
    if (!form.area.trim()) e.area = "এলাকা / উপজেলা বেছে নিন";
    if (form.addressLine.trim().length < 8) e.addressLine = "বাসা, রোড ও এলাকার বিস্তারিত লিখুন";
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) document.getElementById(`checkout-${first}`)?.focus();
    return !first;
  };

  // Records contact details and cart contents as soon as a valid name and mobile number exist, so a
  // customer who leaves on the delivery step can still be recovered. The server validates everything.
  // Failure never blocks the customer.
  const captureContact = () => {
    if (!orderingEnabled || items.length === 0) return;
    if (form.fullName.trim().length < 3 || !isValidBdPhone(form.phone)) return;
    void saveCheckoutProgressAction({
      customer: { fullName: form.fullName.trim(), phone: normalizePhone(form.phone), email: form.email.trim() || undefined },
      items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    }).catch(() => undefined);
  };

  const PAYMENT_REQUIRED = "Enter your advance payment details — no order can be placed without a bKash/Nagad Transaction ID and your number.";

  const validatePaymentState = (): PaymentSubmissionInput | null => {
    if (!paymentDetails) return null;
    const validated = validatePaymentDetails({ ...paymentDetails, note: "", orderReference: null, idempotencyKey: paymentKeyRef.current ?? "" });
    return validated.ok ? validated.data : null;
  };

  const handlePaymentDetailsChange = useCallback((details: { provider: AdvanceProvider; transactionId: string; senderNumber: string }) => {
    setPaymentDetails(details);
    setPaymentError(null);
  }, []);

  const next = () => {
    if (step === 0 && !validate()) return;
    if (step === 0) captureContact();
    // No review without payment details: the order cannot be placed anyway.
    if (step === 1 && !validatePaymentState()) {
      setPaymentError(PAYMENT_REQUIRED);
      return;
    }
    if (step === 1) setPaymentError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  const placeOrder = (paymentData?: PaymentSubmissionInput) => {
    if (pending || !orderable) return;
    if (!validate()) return setStep(0);
    // Advance payment is required: Submit Payment hands validated details
    // in directly; Place Order re-validates what the payment step lifted.
    const details = paymentData ?? validatePaymentState();
    if (!details) {
      setPaymentError(PAYMENT_REQUIRED);
      setStep(1);
      return;
    }
    const payload: CheckoutPayload = {
      customer: { fullName: form.fullName.trim(), phone: normalizePhone(form.phone), email: form.email.trim() || undefined },
      address: { fullName: form.fullName.trim(), phone: normalizePhone(form.phone), division: form.division, district: form.district, area: form.area.trim(), addressLine: form.addressLine.trim() },
      paymentMethod: payment,
      payment: { provider: details.provider, transactionId: details.transactionId, senderNumber: details.senderNumber, idempotencyKey: details.idempotencyKey },
      items: items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
      couponCode: summary.coupon?.code,
      note: note.trim() || undefined,
      saveAddress,
    };
    startTransition(async () => {
      try {
      const res = await placeOrderAction(payload);
      if (res.ok) {
        setPlaced({ orderNumber: res.data.orderNumber, total: res.data.total, phone: payload.customer.phone });
        clear();
        return;
      }
      setResult({ title: res.reason === "not_connected" ? "Order not placed" : "Could not place order", message: res.message, payload });
      } catch {
        setResult({ title: "Order not confirmed", message: "We could not confirm your order. Your cart has been kept. Please try again.", payload });
      }
    });
  };

  if (!hydrated) return <CheckoutSkeleton/>;

  if (placed)
    return (
      <div data-order-placed lang="bn">
        <EmptyState
          icon={<PackageCheck className="h-7 w-7" aria-hidden />}
          title="আপনার অর্ডারটি গ্রহণ করা হয়েছে"
          description={`অর্ডার #${placed.orderNumber}${placed.total !== undefined ? ` · মোট ${formatPrice(placed.total)}` : ""} · ক্যাশ অন ডেলিভারি। পেমেন্ট ভেরিফিকেশনের পর ${placed.phone} নম্বরে ফোনে কনফার্ম করা হবে। আপনার অর্ডার নম্বরটি সংরক্ষণ করুন।`}
          action={<ButtonLink href="/shop">Continue Shopping</ButtonLink>}
        />
      </div>
    );

  if (!items.length)
    return <EmptyState icon={<ShoppingBag className="h-7 w-7" aria-hidden />} title="Your cart is empty" description="Add products to your cart before checking out." action={<ButtonLink href="/shop">Browse Products</ButtonLink>} />;

  const deliveryLabel = form.district ? (isInsideDhaka(form.district) ? "ঢাকার ভিতরে" : "ঢাকার বাইরে") : "ডেলিভারি চার্জ জানতে জেলা বেছে নিন";

  // The notice must name the environment honestly. On production with
  // ordering enabled this is a real store, so no demo notice renders at
  // all; on production with ordering disabled the notice says so without
  // the Preview wording. Staging/Preview keeps the existing copy.
  const checkoutNotice = isProduction
    ? orderingEnabled
      ? null
      : "Ordering and payment collection are currently unavailable. Totals are estimates; do not send money or enter real payment details."
    : orderingEnabled
      ? "This is a Staging test store. Orders placed here are test orders and the final total is calculated by the server. Payment collection is not connected; do not send money."
      : "Ordering and payment collection are currently unavailable. Totals are estimates; do not send money or enter real payment details in this Preview.";

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_400px] lg:gap-12 [&>*]:min-w-0" data-checkout-content>
      <div className="min-w-0">
        {checkoutNotice && (
          <DemoNotice force className="mb-5">
            {checkoutNotice}
          </DemoNotice>
        )}
        <CheckoutSteps steps={STEPS} current={step} onStepClick={setStep} />

        <div ref={panelRef} className="mt-6 rounded-card border border-line p-5 sm:p-7">
          {step === 0 && (
            <form
              noValidate
              lang="bn"
              onSubmit={(e) => {
                e.preventDefault();
                next();
              }}
              className="space-y-5"
            >
              <h2 tabIndex={-1} className="font-serif text-2xl text-ink">ডেলিভারি তথ্য</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input id="checkout-fullName" label="পুরো নাম" required autoComplete="name" placeholder="আপনার নাম লিখুন" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} error={errors.fullName} wrapperClassName="sm:col-span-2" />
                <Input id="checkout-phone" label="মোবাইল নম্বর" required type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" value={form.phone} onChange={(e) => set("phone", e.target.value)} onBlur={captureContact} error={errors.phone} hint="অর্ডার নিশ্চিত করতে আমরা কল করব।" />
                <Input id="checkout-email" label="ইমেইল (ঐচ্ছিক)" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={(e) => set("email", e.target.value)} error={errors.email} />
                <Select id="checkout-division" label="বিভাগ" required placeholder="বিভাগ বেছে নিন" options={divisionNames.map((d) => ({ value: d, label: d }))} value={form.division} onChange={(e) => set("division", e.target.value)} error={errors.division} />
                <Select
                  id="checkout-district"
                  label="জেলা"
                  required
                  placeholder={form.division ? "জেলা বেছে নিন" : "আগে বিভাগ বেছে নিন"}
                  disabled={!form.division}
                  options={districts.map((d) => ({ value: d, label: d }))}
                  value={form.district}
                  onChange={(e) => set("district", e.target.value)}
                  error={errors.district}
                />
                <Select id="checkout-area" label="এলাকা / উপজেলা" required placeholder={form.district ? "এলাকা / উপজেলা বেছে নিন" : "আগে জেলা বেছে নিন"} disabled={!form.district} options={areas.map((a) => ({ value: a, label: a }))} value={form.area} onChange={(e) => set("area", e.target.value)} error={errors.area} wrapperClassName="sm:col-span-2" />
                <Textarea id="checkout-addressLine" label="বিস্তারিত ঠিকানা" required autoComplete="street-address" placeholder="বাসা, রোড, এলাকার বিস্তারিত লিখুন" value={form.addressLine} onChange={(e) => set("addressLine", e.target.value)} error={errors.addressLine} wrapperClassName="sm:col-span-2" className="min-h-[88px]" />
              </div>
              <Checkbox label="পরের বার ব্যবহারের জন্য এই ঠিকানাটি সংরক্ষণ করুন" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
                <Link href="/cart" className="inline-flex items-center justify-center gap-2 text-sm text-ink-muted hover:text-primary">
                  <ArrowLeft className="h-4 w-4" aria-hidden /> কার্টে ফিরুন
                </Link>
                <Button variant="burgundy" type="submit" size="lg" rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}>
                  পেমেন্টে এগিয়ে যান
                </Button>
              </div>
            </form>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <h2 tabIndex={-1} className="font-serif text-2xl text-ink">Payment</h2>
              <PaymentMethodSelector value={payment} onChange={setPayment} onlineEnabled={commerce.onlinePaymentEnabled} previewEnabled />
              <ManualAdvancePayment mode={payment} configuration={manualPaymentConfiguration} totalMinor={toMinorUnits(summary.total)} division={form.division} district={form.district} onDetailsChange={handlePaymentDetailsChange} onSubmitPayment={(data) => placeOrder(data)} submitting={pending} />
              {paymentError && <p role="alert" className="text-sm leading-relaxed text-primary">{paymentError}</p>}
              <div lang="bn">
                <Textarea label="অর্ডার নোট (ঐচ্ছিক)" placeholder="কিছু জানানোর থাকলে লিখুন, যেমন: পছন্দের ডেলিভারি সময়" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[80px]" />
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <Button variant="ghost" onClick={() => setStep(0)} leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
                  Back
                </Button>
                <Button variant="burgundy" size="lg" onClick={next} rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}>
                  Continue shopping
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h2 tabIndex={-1} className="font-serif text-2xl text-ink">Review your order</h2>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="rounded-control border border-line bg-white p-4">
                  <dt className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Deliver to
                    <button type="button" onClick={() => setStep(0)} className="normal-case tracking-normal text-primary underline underline-offset-4">
                      Edit
                    </button>
                  </dt>
                  <dd className="mt-2 leading-relaxed text-ink">
                    {form.fullName}
                    <br />
                    {form.phone}
                    <br />
                    {form.addressLine}, {form.area}, {form.district}, {form.division}
                  </dd>
                </div>
                <div className="rounded-control border border-line bg-white p-4">
                  <dt className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Payment
                    <button type="button" onClick={() => setStep(1)} className="normal-case tracking-normal text-primary underline underline-offset-4">
                      Edit
                    </button>
                  </dt>
                  <dd className="mt-2 text-ink">{payment === "cod" ? "Cash on Delivery" : "Online Payment"}</dd>
                  {paymentDetails && (
                    <dd className="mt-2 text-xs leading-relaxed text-ink">
                      {paymentDetails.provider === "bkash" ? "bKash" : "Nagad"} · TxID {paymentDetails.transactionId} · {paymentDetails.senderNumber}
                    </dd>
                  )}
                  <dd lang="bn" className="mt-1 text-xs text-ink-muted">{deliveryLabel}</dd>
                </div>
              </dl>
              <ul className="divide-y divide-line border-y border-line">
                {items.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 py-3">
                    <span className="relative h-16 w-[52px] shrink-0 overflow-hidden rounded bg-white">
                      <SmartImage src={i.image.src} alt="" fill sizes="52px" className="object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink" title={i.name}>{i.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {i.colorName} · {i.size} · Qty {i.quantity}
                      </span>
                    </span>
                    <span className="text-sm font-medium">{formatPrice(i.unitPrice * i.quantity)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <Button variant="ghost" onClick={() => setStep(1)} leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
                  Back
                </Button>
                <Button variant="burgundy" size="lg" onClick={() => placeOrder()} loading={pending} disabled={!orderable} leftIcon={<Lock className="h-4 w-4" aria-hidden />}>
                  Place Order ({payment === "cod" ? "COD" : "Online"}) · {formatPrice(summary.total)}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <div className="space-y-5 rounded-card border border-line p-5 sm:p-6">
          <h2 className="font-serif text-2xl text-ink">Order Summary</h2>
          <ul className="space-y-3">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-3">
                <span className="relative h-14 w-11 shrink-0 overflow-hidden rounded bg-white">
                  <SmartImage src={i.image.src} alt="" fill sizes="44px" className="object-cover" />
                  <span className="absolute -right-0 -top-0 flex h-4 min-w-4 items-center justify-center rounded-bl bg-ink px-1 text-[9px] text-white">{i.quantity}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-ink" title={i.name}>{i.name}</span>
                  <span className="block text-[11px] text-ink-muted">
                    {i.colorName} · {i.size}
                  </span>
                </span>
                <span className="text-xs font-medium">{formatPrice(i.unitPrice * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <CouponField phone={couponPhone} />
          <OrderSummary summary={summary} title={null} deliveryNote={deliveryLabel} />
          <div className="space-y-2 border-t border-line pt-3 text-sm" aria-label="Payment summary" aria-live="polite">
            <div className="flex justify-between gap-3"><span>{payment === "cod" ? "Required advance" : "Full payment amount"}</span><strong data-summary-advance>{payment === "online" ? formatPaymentAmount(toMinorUnits(summary.total)) : advance ? formatPaymentAmount(advance.advanceMinor) : "Select location"}</strong></div>
            <div className="flex justify-between gap-3"><span>Remaining on delivery</span><strong data-summary-remaining>{payment === "online" ? formatPaymentAmount(0) : advance ? formatPaymentAmount(advance.remainingMinor) : "—"}</strong></div>
            <p className="text-xs leading-relaxed text-ink-muted">{payment === "cod" ? "Advance counts toward the total, including delivery." : "Full payment includes delivery."} Payment is not yet verified.</p>
          </div>
        </div>
      </aside>

      <Modal
        open={Boolean(result)}
        onClose={() => setResult(null)}
        title={result?.title ?? ""}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setResult(null)}>Back to checkout</Button>
          </div>
        }
      >
        {result && (
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3 rounded-control bg-selected p-4 text-primary">
              <PackageCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>{result.message}</p>
            </div>
            <p className="text-ink-muted">Your cart has been kept. No confirmed order or payment receipt has been issued.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
