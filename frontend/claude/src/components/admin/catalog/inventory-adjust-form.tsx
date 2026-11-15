"use client";

import { useActionState } from "react";
import {
  adjustInventory,
  type VariantOption,
} from "@/lib/admin/catalog-inventory";
import { Notice } from "../ui";
import { FormMessage, SubmitButton } from "../ui-client";

export function InventoryAdjustForm({
  variants,
  canAdjust,
}: {
  variants: VariantOption[];
  canAdjust: boolean;
}) {
  const [state, formAction] = useActionState(adjustInventory, null);

  if (!canAdjust) {
    return (
      <Notice kind="warning">
        Your role can view inventory but cannot adjust stock.
      </Notice>
    );
  }

  if (variants.length === 0) {
    return (
      <p className="aa-muted">
        No variants exist yet. Create a product first, then adjust its stock
        here.
      </p>
    );
  }

  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field aa-field--full">
          <label htmlFor="adjust-variant">Variant</label>
          <select id="adjust-variant" name="variant_id" required defaultValue="">
            <option value="" disabled>
              Choose a variant
            </option>
            {variants.map((variant) => (
              <option key={variant.variantId} value={variant.variantId}>
                {variant.label}
                {variant.onHand !== null
                  ? ` (on hand ${variant.onHand}, available ${variant.available ?? "—"})`
                  : " (no stock record)"}
              </option>
            ))}
          </select>
        </div>
        <div className="aa-field">
          <label htmlFor="adjust-delta">Quantity change</label>
          <input
            id="adjust-delta"
            name="delta"
            inputMode="numeric"
            placeholder="e.g. 10 or -3"
            required
          />
          <p className="aa-hint">
            Positive to add stock, negative to remove. Zero is not allowed,
            and stock can never drop below the reserved quantity.
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor="adjust-reason">Reason (3–500 characters)</label>
          <textarea
            id="adjust-reason"
            name="reason"
            maxLength={500}
            minLength={3}
            placeholder="e.g. Damaged units removed after inspection"
            required
          />
          <p className="aa-hint">
            The reason and your identity are recorded in the movement history.
          </p>
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton pendingLabel="Adjusting…">Adjust stock</SubmitButton>
      </div>
    </form>
  );
}
