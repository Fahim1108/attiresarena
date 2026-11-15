"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { SalesAction } from "./types";

export interface CouponFormInitial {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  percent_value: string;
  fixed_discount: string;
  min_order: string;
  max_discount: string;
  starts_at: string;
  expires_at: string;
  total_usage_limit: string;
  per_customer_limit: string;
  first_order_only: boolean;
  active: boolean;
}

/**
 * Create/edit form. Only the active kind's value field is rendered.
 *
 * Reference-adaptation note: field order follows the reference modal
 * shape (code, type, value, maximum, minimum, dates, limits, toggles)
 * within the existing page architecture. A modal conversion was not
 * made — the verified page flow and validation/eligibility logic stay
 * untouched — and the reference's description / applicable-to fields
 * have no storage, so they are intentionally absent.
 */
export function CouponForm({
  initial,
  action,
  submitLabel,
}: {
  initial: CouponFormInitial | null;
  action: SalesAction;
  submitLabel: string;
}) {
  const [kind, setKind] = useState<"percent" | "fixed">(initial?.kind ?? "percent");
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} method="post">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="coupon-code">Code</label>
          <input
            id="coupon-code"
            name="code"
            required
            minLength={3}
            maxLength={30}
            defaultValue={initial?.code ?? ""}
            placeholder="WELCOME10"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <p className="aa-hint">3–30 letters, digits, dashes or underscores. Saved in upper case.</p>
        </div>
        <div className="aa-field">
          <label htmlFor="coupon-kind">Discount kind</label>
          <select
            id="coupon-kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as "percent" | "fixed")}
          >
            <option value="percent">Percent off</option>
            <option value="fixed">Fixed amount off</option>
          </select>
        </div>
        {kind === "percent" ? (
          <div className="aa-field">
            <label htmlFor="coupon-percent">Percent value</label>
            <input
              id="coupon-percent"
              name="percent_value"
              required
              type="number"
              min={1}
              max={100}
              step={1}
              defaultValue={initial?.percent_value ?? ""}
              placeholder="10"
            />
            <p className="aa-hint">Whole percent from 1 to 100.</p>
          </div>
        ) : (
          <div className="aa-field">
            <label htmlFor="coupon-fixed">Fixed discount (BDT)</label>
            <input
              id="coupon-fixed"
              name="fixed_discount"
              required
              inputMode="decimal"
              defaultValue={initial?.fixed_discount ?? ""}
              placeholder="150.00"
            />
            <p className="aa-hint">Amount in taka, for example 150.00.</p>
          </div>
        )}
        <div className="aa-field">
          <label htmlFor="coupon-max">Maximum discount (BDT, optional)</label>
          <input
            id="coupon-max"
            name="max_discount"
            inputMode="decimal"
            defaultValue={initial?.max_discount ?? ""}
            placeholder="Leave blank for no cap"
          />
          <p className="aa-hint">Caps the discount, mostly useful for percent coupons.</p>
        </div>
        <div className="aa-field">
          <label htmlFor="coupon-min">Minimum order (BDT)</label>
          <input
            id="coupon-min"
            name="min_order"
            inputMode="decimal"
            defaultValue={initial?.min_order ?? "0.00"}
            placeholder="0.00"
          />
          <p className="aa-hint">Orders below this subtotal cannot use the coupon. 0 means no minimum.</p>
        </div>
        <div className="aa-field">
          <label htmlFor="coupon-starts">Valid from (optional)</label>
          <input
            id="coupon-starts"
            name="starts_at"
            type="datetime-local"
            defaultValue={initial?.starts_at ?? ""}
          />
        </div>
        <div className="aa-field">
          <label htmlFor="coupon-expires">Expires (optional)</label>
          <input
            id="coupon-expires"
            name="expires_at"
            type="datetime-local"
            defaultValue={initial?.expires_at ?? ""}
          />
          <p className="aa-hint">Leave both dates blank for a coupon with no time window.</p>
        </div>
        <div className="aa-field">
          <label htmlFor="coupon-total-limit">Total usage limit (optional)</label>
          <input
            id="coupon-total-limit"
            name="total_usage_limit"
            type="number"
            min={1}
            step={1}
            defaultValue={initial?.total_usage_limit ?? ""}
            placeholder="Leave blank for unlimited"
          />
        </div>
        <div className="aa-field">
          <label htmlFor="coupon-per-limit">Uses per customer (optional)</label>
          <input
            id="coupon-per-limit"
            name="per_customer_limit"
            type="number"
            min={1}
            step={1}
            defaultValue={initial?.per_customer_limit ?? "1"}
            placeholder="Leave blank for unlimited"
          />
          <p className="aa-hint">Counted by signed-in account when one is given, else by phone.</p>
        </div>
        <div className="aa-field aa-field--full">
          <span className="aa-check-row">
            <label>
              <input
                type="checkbox"
                name="first_order_only"
                defaultChecked={initial?.first_order_only ?? false}
              />
              First order only
            </label>
            <label>
              <input
                type="checkbox"
                name="active"
                defaultChecked={initial ? initial.active : true}
              />
              Active
            </label>
          </span>
          <p className="aa-hint">
            First-order coupons only validate for a signed-in customer with no prior orders
            and no prior coupon redemptions. Guests cannot use them.
          </p>
        </div>
      </div>
      <FormMessage state={state} />
      <div className="aa-form-actions">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
