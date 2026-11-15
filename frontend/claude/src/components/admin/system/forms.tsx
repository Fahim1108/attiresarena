"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  STAFF_ROLES,
  STAFF_ROLE_GROUPS,
  STAFF_ROLE_LABELS,
  type PermissionName,
  type StaffRole,
} from "@/lib/admin/constants";
import {
  matrixSectionsForRole,
  type MatrixRole,
} from "@/lib/admin/reference-adapt";
import styles from "@/components/admin/admin-v2-forms.module.css";

type FormAction = (
  prev: AdminActionResult | null,
  form: FormData,
) => Promise<AdminActionResult>;

export function RoleAssignmentForm({
  action,
  userId,
  currentRoles,
  isSoleOwner,
}: {
  action: FormAction;
  userId: string;
  currentRoles: StaffRole[];
  isSoleOwner: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <input type="hidden" name="user_id" value={userId} />
      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Roles</legend>
        <div className={styles.checkList}>
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
                />
                <span>
                  {STAFF_ROLE_LABELS[role]} ({STAFF_ROLE_GROUPS[role]})
                  {locked ? (
                    <span className={styles.roleTag}>
                      {" "}— last owner, cannot be removed
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
        {isSoleOwner ? (
          <p className={styles.groupNote}>
            This is the only owner account. Add another owner before removing
            this one.
          </p>
        ) : null}
      </fieldset>
      <div className="aa-form-actions">
        <SubmitButton>Save roles</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Per-user permission grants, grouped by section. Permissions that already
 * come from the member's roles are shown checked and disabled: unchecking
 * a grant here never removes role access, and the disabled state says so.
 * Only enabled (personal-grant) boxes are submitted.
 */
export function PermissionGrantsForm({
  action,
  userId,
  userGrants,
  roleGranted,
}: {
  action: FormAction;
  userId: string;
  userGrants: PermissionName[];
  roleGranted: PermissionName[];
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <input type="hidden" name="user_id" value={userId} />
      <div className={styles.groupGrid}>
        {PERMISSION_GROUPS.map((group) => (
          <fieldset className={styles.group} key={group.section}>
            <legend className={styles.groupTitle}>{group.section}</legend>
            <div className={styles.checkList}>
              {group.permissions.map((permission) => {
                const fromRole = roleGranted.includes(permission);
                return (
                  <label key={permission}>
                    <input
                      type="checkbox"
                      name="permissions"
                      value={permission}
                      defaultChecked={
                        fromRole || userGrants.includes(permission)
                      }
                      disabled={fromRole}
                    />
                    <span>
                      {PERMISSION_LABELS[permission]}
                      {fromRole ? (
                        <span className={styles.roleTag}>
                          {" "}(from role)
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <p className="aa-hint">
        Extra access adds to what the member&apos;s roles already allow. To
        remove role access, change the roles above instead.
      </p>
      <div className="aa-form-actions">
        <SubmitButton>Save extra access</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Per-role access matrix card: section checkboxes for one role's grants
 * (the same role_permissions rows migration 010 defines), with Select
 * All / Clear. Saving replaces that role's matrix-editable grants.
 * Owner-only grants already on the role are shown as a note and are
 * preserved by the RPC — they are never editable here. Sections cover
 * only areas that exist in this project; Costs appears only for Admin.
 */
export function RoleMatrixForm({
  action,
  role,
  granted,
}: {
  action: FormAction;
  role: MatrixRole;
  granted: PermissionName[];
}) {
  const [state, formAction] = useActionState(action, null);
  const sections = matrixSectionsForRole(role);
  const editable = sections.flatMap((group) => group.permissions);
  const locked = granted.filter((permission) => !editable.includes(permission));
  const [checked, setChecked] = useState<PermissionName[]>(() =>
    granted.filter((permission) => editable.includes(permission)),
  );
  const allChecked = editable.every((permission) => checked.includes(permission));
  const toggle = (permission: PermissionName, on: boolean) => {
    setChecked((prev) =>
      on ? [...prev, permission] : prev.filter((item) => item !== permission),
    );
  };
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <input type="hidden" name="role" value={role} />
      <h3>{STAFF_ROLE_LABELS[role]}</h3>
      <div className={styles.groupGrid}>
        {sections.map((group) => (
          <fieldset className={styles.group} key={group.section}>
            <legend className={styles.groupTitle}>{group.section}</legend>
            <div className={styles.checkList}>
              {group.permissions.map((permission) => (
                <label key={permission}>
                  <input
                    type="checkbox"
                    name="permissions"
                    value={permission}
                    checked={checked.includes(permission)}
                    onChange={(event) => toggle(permission, event.target.checked)}
                  />
                  <span>{PERMISSION_LABELS[permission]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      {locked.length > 0 ? (
        <p className="aa-hint">
          Owner-only access ({locked.map((permission) => PERMISSION_LABELS[permission]).join(", ")})
          is unchanged by saving here.
        </p>
      ) : null}
      <p className="aa-hint">
        {role === "admin"
          ? "Admins may view cost prices when the Costs box is checked."
          : "Moderators and editors never see cost prices."}{" "}
        Changes apply to every member with this role. Personal grants stay
        in the per-member forms below.
      </p>
      <div className="aa-form-actions">
        <button
          type="button"
          className="aa-secondary"
          onClick={() => setChecked([...editable])}
          disabled={allChecked}
        >
          Select all
        </button>
        <button
          type="button"
          className="aa-secondary"
          onClick={() => setChecked([])}
          disabled={checked.length === 0}
        >
          Clear
        </button>
        <SubmitButton>Save {STAFF_ROLE_LABELS[role]} access</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Add a staff member: email + password set at creation, role assigned at
 * creation time, plus optional extra access. Passwords are never shown
 * anywhere else in the panel, and the staff list never shows emails.
 */
export function CreateStaffForm({ action }: { action: FormAction }) {
  const [state, formAction] = useActionState(action, null);
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form action={formAction}>
      <FormMessage state={state} />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor="new-staff-email">Email address</label>
          <input
            id="new-staff-email"
            name="email"
            type="email"
            autoComplete="off"
            spellCheck={false}
            maxLength={254}
            placeholder="name@example.com…"
            required
          />
          <p className="aa-hint">
            Used only to sign in. Email addresses are never shown in the
            staff list.
          </p>
        </div>
        <div className="aa-field">
          <label htmlFor="new-staff-password">Password</label>
          <input
            id="new-staff-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            spellCheck={false}
            minLength={12}
            maxLength={128}
            required
          />
          <p className="aa-hint">
            12–128 characters, with at least one letter and one number. The
            password is never shown again after creation.
          </p>
        </div>
      </div>
      <div className="aa-check-row" style={{ marginTop: "0.75rem" }}>
        <label>
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(event) => setShowPassword(event.target.checked)}
          />{" "}
          Show password while typing
        </label>
      </div>
      <fieldset className={styles.group} style={{ marginTop: "1rem" }}>
        <legend className={styles.groupTitle}>Role at creation</legend>
        <div className={styles.checkList}>
          {STAFF_ROLES.map((role) => (
            <label key={role}>
              <input type="checkbox" name="roles" value={role} />
              <span>
                {STAFF_ROLE_LABELS[role]} ({STAFF_ROLE_GROUPS[role]})
              </span>
            </label>
          ))}
        </div>
        <p className={styles.groupNote}>
          Choose at least one role. Owner is the only role that can manage
          settings, custom code and other users.
        </p>
      </fieldset>
      <div className={styles.groupGrid} style={{ marginTop: "0.75rem" }}>
        {PERMISSION_GROUPS.map((group) => (
          <fieldset className={styles.group} key={group.section}>
            <legend className={styles.groupTitle}>
              Extra access — {group.section}
            </legend>
            <div className={styles.checkList}>
              {group.permissions.map((permission) => (
                <label key={permission}>
                  <input
                    type="checkbox"
                    name="permissions"
                    value={permission}
                  />
                  <span>{PERMISSION_LABELS[permission]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <p className="aa-hint">
        Extra access is optional and adds to the chosen role. Cost prices
        stay hidden from moderators and editors unless this access is
        granted explicitly by an owner.
      </p>
      <div className="aa-form-actions">
        <SubmitButton pendingLabel="Creating…">Create staff account</SubmitButton>
      </div>
    </form>
  );
}
