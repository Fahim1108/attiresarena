"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/admin/format";
import type { CouponTestAction } from "./types";

const REASON_TEXT: Record<string, string> = {
  not_found: "No coupon with this code exists.",
  invalid_request: "Check the code and subtotal, then try again.",
  inactive: "This coupon is deactivated.",
  not_yet_valid: "This coupon is not valid yet.",
  expired: "This coupon has expired.",
  below_minimum: "The order subtotal is below this coupon's minimum.",
  usage_limit_reached: "This coupon has reached its total usage limit.",
  per_customer_limit_reached:
    "This customer has already used this coupon the maximum number of times.",
  first_order_only:
    "This coupon is for a signed-in customer's first order only: it needs an account with no prior orders and no prior coupon redemptions.",
};

/**
 * Eligibility test panel. It only checks eligibility through
 * validate_coupon; it never applies a coupon or records a redemption.
 */
export function CouponTestPanel({ testAction }: { testAction: CouponTestAction }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<
    | { kind: "valid"; discountMinor: number }
    | { kind: "invalid"; reason: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setBusy(true);
    setOutcome(null);
    let result: Awaited<ReturnType<CouponTestAction>>;
    try {
      result = await testAction({
        code: String(formData.get("code") ?? ""),
        userId: String(formData.get("userId") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        subtotal: String(formData.get("subtotal") ?? ""),
      });
    } catch {
      setOutcome({ kind: "error", message: "Eligibility could not be checked. Try again." });
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!result.ok) {
      setOutcome({ kind: "error", message: result.error });
      return;
    }
    if (result.result.valid) {
      setOutcome({ kind: "valid", discountMinor: result.result.discount_minor });
    } else {
      const reason = result.result.reason ?? "unknown";
      setOutcome({ kind: "invalid", reason: REASON_TEXT[reason] ?? `Not eligible (${reason}).` });
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="test-code">Coupon code</label>
          <input id="test-code" name="code" required maxLength={30} placeholder="WELCOME10" autoCapitalize="characters" spellCheck={false} />
        </div>
        <div className="aa-field">
          <label htmlFor="test-subtotal">Order subtotal (BDT)</label>
          <input id="test-subtotal" name="subtotal" required inputMode="decimal" placeholder="1000.00" />
        </div>
        <div className="aa-field">
          <label htmlFor="test-user">Customer account ID (optional)</label>
          <input id="test-user" name="userId" placeholder="Leave blank for a guest" spellCheck={false} />
          <p className="aa-hint">Needed to test first-order coupons and per-customer limits for signed-in customers.</p>
        </div>
        <div className="aa-field">
          <label htmlFor="test-phone">Phone (optional)</label>
          <input id="test-phone" name="phone" inputMode="tel" placeholder="01XXXXXXXXX" />
          <p className="aa-hint">Used for per-customer limits when no account ID is given.</p>
        </div>
      </div>
      {outcome?.kind === "valid" ? (
        <p role="status" className="aa-notice aa-notice--success">
          Valid. Discount: {formatMoney(outcome.discountMinor)}.
        </p>
      ) : null}
      {outcome?.kind === "invalid" ? (
        <p role="status" className="aa-notice aa-notice--warning">
          Not eligible. {outcome.reason}
        </p>
      ) : null}
      {outcome?.kind === "error" ? (
        <p role="alert" className="aa-notice aa-notice--error">
          {outcome.message}
        </p>
      ) : null}
      <div className="aa-form-actions">
        <button type="submit" className="aa-button" disabled={busy}>
          {busy ? "Checking…" : "Check eligibility"}
        </button>
      </div>
    </form>
  );
}
