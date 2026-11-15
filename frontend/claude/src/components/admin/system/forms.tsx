"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";
import {
  STAFF_ROLES,
  STAFF_ROLE_GROUPS,
  STAFF_ROLE_LABELS,
  type StaffRole,
} from "@/lib/admin/constants";

export function RoleAssignmentForm({
  action,
  userId,
  currentRoles,
  isSoleOwner,
}: {
  action: (
    prev: AdminActionResult | null,
    form: FormData,
  ) => Promise<AdminActionResult>;
  userId: string;
  currentRoles: StaffRole[];
  isSoleOwner: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <input type="hidden" name="user_id" value={userId} />
      <div className="aa-check-row">
        {STAFF_ROLES.map((role) => {
          const locked = role === "owner" && isSoleOwner;
          return (
            <label key={role}>
              <input
                type="checkbox"
                name="roles"
                value={role}
                defaultChecked={currentRoles.includes(role)}
                disabled={locked}
              />{" "}
              {STAFF_ROLE_LABELS[role]} ({STAFF_ROLE_GROUPS[role]})
              {locked ? " — last owner, cannot be removed" : ""}
            </label>
          );
        })}
      </div>
      {isSoleOwner ? (
        <p className="aa-hint">
          This is the only owner account. Add another owner before removing
          this one.
        </p>
      ) : null}
      <div className="aa-form-actions">
        <SubmitButton>Save roles</SubmitButton>
      </div>
    </form>
  );
}
