"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";

type FormAction = (
  prev: AdminActionResult | null,
  form: FormData,
) => Promise<AdminActionResult>;

export interface RedirectFormInitial {
  id: string;
  source_path: string;
  target_path: string;
  code: number;
  active: boolean;
}

/** Auto-redirect toggle. The button posts the opposite of the current value. */
export function RedirectAutoForm({
  enabled,
  action,
}: {
  enabled: boolean;
  action: FormAction;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} method="post">
      <FormMessage state={state} />
      <p>
        Automatic redirects are currently{" "}
        <strong>{enabled ? "on" : "off"}</strong>.
      </p>
      <input type="hidden" name="value" value={enabled ? "false" : "true"} />
      <div className="aa-form-actions">
        <SubmitButton pendingLabel="Saving…">
          {enabled ? "Turn automatic redirects off" : "Turn automatic redirects on"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Redirect create/edit form. Saved redirects are enforced on the storefront by src/proxy.ts while redirect_auto is on. */
export function RedirectForm({
  initial,
  action,
}: {
  initial: RedirectFormInitial | null;
  action: FormAction;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} method="post">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="redirect-source">Source path</label>
          <input
            id="redirect-source"
            name="source_path"
            required
            maxLength={500}
            defaultValue={initial?.source_path ?? ""}
            placeholder="/old-page"
            spellCheck={false}
          />
          <p className="aa-hint">A site path starting with /.</p>
        </div>
        <div className="aa-field">
          <label htmlFor="redirect-target">Target</label>
          <input
            id="redirect-target"
            name="target_path"
            required
            maxLength={500}
            defaultValue={initial?.target_path ?? ""}
            placeholder="/new-page"
            spellCheck={false}
          />
          <p className="aa-hint">A site path or a full http(s) URL.</p>
        </div>
        <div className="aa-field">
          <label htmlFor="redirect-code">Redirect code</label>
          <select
            id="redirect-code"
            name="code"
            defaultValue={String(initial?.code ?? 301)}
          >
            <option value="301">301 — Permanent</option>
            <option value="302">302 — Temporary</option>
          </select>
        </div>
      </div>
      <div className="aa-check-row">
        <label>
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial?.active ?? true}
          />{" "}
          Active
        </label>
      </div>
      <div className="aa-form-actions">
        <SubmitButton>
          {initial ? "Save redirect" : "Add redirect"}
        </SubmitButton>
      </div>
    </form>
  );
}
