"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";

type FormAction = (
  prev: AdminActionResult | null,
  form: FormData,
) => Promise<AdminActionResult>;

/** Featured-categories count card: number input + Save. Stored only. */
export function FeaturedCountForm({
  initialCount,
  action,
}: {
  initialCount: number | null;
  action: FormAction;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} method="post">
      <FormMessage state={state} />
      <div className="aa-field">
        <label htmlFor="featured-count">Number of categories</label>
        <input
          id="featured-count"
          name="count"
          type="number"
          min={1}
          max={24}
          step={1}
          defaultValue={initialCount ?? ""}
          placeholder="6"
        />
        <p className="aa-hint">
          The number of categories in the Featured Categories section,
          sorted by Display Order.
        </p>
      </div>
      <div className="aa-form-actions">
        <SubmitButton>Save</SubmitButton>
      </div>
    </form>
  );
}
