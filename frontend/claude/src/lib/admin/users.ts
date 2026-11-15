import "server-only";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  requireStaff,
  actionOk,
  actionError,
  toActionError,
} from "./authorization";
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSION_DEFAULTS,
  areaRoles,
  isPermissionName,
  isStaffRole,
  STAFF_ROLES,
  type PermissionName,
  type StaffRole,
} from "./constants";
import { NEW_STAFF_PASSWORD_SCHEMA } from "./account";
import {
  MATRIX_ROLES,
  isMatrixRole,
  matrixGrantViolations,
  type MatrixRole,
} from "./reference-adapt";
import { adminConfiguration } from "./supabase";
import type { AdminActionResult } from "./authorization";

export interface StaffMember {
  userId: string;
  displayName: string;
  roles: StaffRole[];
  /** Effective permissions: role grants plus per-user grants, in fixed order. */
  permissions: PermissionName[];
  /** Per-user grants only (from user_permissions, migration 010). */
  userGrants: PermissionName[];
}

export interface StaffList {
  members: StaffMember[];
  /**
   * True when the live role_permissions rows could not be read and the
   * role-granted half of each member's permissions was derived from the
   * documented role defaults instead. The UI must say so.
   */
  permissionsFromDefaults: boolean;
}

/** Effective permissions for one member from role rows + user grants. */
export function effectivePermissions(
  roles: readonly StaffRole[],
  roleGrants: ReadonlyMap<string, readonly PermissionName[]>,
  userGrants: readonly PermissionName[],
): PermissionName[] {
  const found = new Set<PermissionName>(userGrants);
  for (const role of roles) {
    for (const permission of roleGrants.get(role) ?? []) found.add(permission);
  }
  return ALL_PERMISSIONS.filter((permission) => found.has(permission));
}

/**
 * List staff members: user_roles joined with profiles, role_permissions
 * and user_permissions. Email addresses live in Supabase Auth and are not
 * queryable here, so the UI shows the display name, roles and access only
 * — never emails. Null when unavailable (for example, before migration
 * 006 applies, RLS returns only own rows or none — the page says so
 * honestly). Before migration 010 applies, user_permissions reads fail
 * and grants are treated as empty; role rows still load.
 */
export async function getStaffMembers(): Promise<StaffList | null> {
  const session = await requireStaff(areaRoles("users"));
  // allSettled: a rejected query degrades exactly like an errored one
  // (roles read failing means unavailable; the others fall back to
  // defaults/empty), so a transient failure never crashes the page.
  // NOTE: the live "role-permission data could not be loaded" state is
  // NOT a code bug — no migration ever granted SELECT on
  // role_permissions, so that read always fails (see migration
  // 20261115001500, unapplied). Until it applies, the defaults fallback
  // below is the honest behaviour.
  const settled = await Promise.allSettled([
    session.client.from("user_roles").select("user_id, role"),
    session.client.from("profiles").select("id, display_name"),
    session.client.from("role_permissions").select("role, permission"),
    session.client.from("user_permissions").select("user_id, permission"),
  ]);
  const asResult = <T,>(
    entry: PromiseSettledResult<T>,
  ): T | { data: null; error: { message: string } } =>
    entry.status === "fulfilled"
      ? entry.value
      : { data: null, error: { message: "Query failed." } };
  const rolesResult = asResult(settled[0]);
  const profilesResult = asResult(settled[1]);
  const grantsResult = asResult(settled[2]);
  const userGrantsResult = asResult(settled[3]);
  if (rolesResult.error) return null;
  const names = new Map<string, string>();
  if (!profilesResult.error) {
    for (const profile of profilesResult.data ?? []) {
      names.set(profile.id, profile.display_name);
    }
  }
  const roleGrants = new Map<string, PermissionName[]>();
  let permissionsFromDefaults = false;
  if (grantsResult.error) {
    permissionsFromDefaults = true;
    for (const role of STAFF_ROLES) {
      roleGrants.set(role, [...ROLE_PERMISSION_DEFAULTS[role]]);
    }
  } else {
    for (const row of grantsResult.data ?? []) {
      if (!isPermissionName(row.permission)) continue;
      const existing = roleGrants.get(row.role) ?? [];
      if (!existing.includes(row.permission)) existing.push(row.permission);
      roleGrants.set(row.role, existing);
    }
  }
  const grantsByUser = new Map<string, PermissionName[]>();
  if (!userGrantsResult.error) {
    for (const row of userGrantsResult.data ?? []) {
      if (!isPermissionName(row.permission)) continue;
      const existing = grantsByUser.get(row.user_id) ?? [];
      if (!existing.includes(row.permission)) existing.push(row.permission);
      grantsByUser.set(row.user_id, existing);
    }
  }
  const grouped = new Map<string, StaffRole[]>();
  for (const row of rolesResult.data ?? []) {
    if (!isStaffRole(row.role)) continue;
    const existing = grouped.get(row.user_id) ?? [];
    if (!existing.includes(row.role)) existing.push(row.role);
    grouped.set(row.user_id, existing);
  }
  const members: StaffMember[] = [...grouped.entries()].map(
    ([userId, roles]) => {
      const sortedRoles = [...roles].sort(
        (a, b) => STAFF_ROLES.indexOf(a) - STAFF_ROLES.indexOf(b),
      );
      const userGrants = ALL_PERMISSIONS.filter((permission) =>
        (grantsByUser.get(userId) ?? []).includes(permission),
      );
      return {
        userId,
        displayName: names.get(userId) ?? "",
        roles: sortedRoles,
        permissions: effectivePermissions(sortedRoles, roleGrants, userGrants),
        userGrants,
      };
    },
  );
  members.sort((a, b) => {
    const aName = a.displayName || a.userId;
    const bName = b.displayName || b.userId;
    return aName.localeCompare(bName);
  });
  return { members, permissionsFromDefaults };
}

/** Count owners excluding one user — mirrors the last-owner guard. */
export function countOtherOwners(
  members: readonly { userId: string; roles: readonly StaffRole[] }[],
  excludeUserId: string,
): number {
  return members.filter(
    (member) =>
      member.userId !== excludeUserId && member.roles.includes("owner"),
  ).length;
}

export interface RoleMatrix {
  /** Live role_permissions rows per matrix role, in ALL_PERMISSIONS order. */
  grants: Record<MatrixRole, PermissionName[]>;
  /**
   * True when the live role_permissions rows could not be read and the
   * documented role defaults were used instead. The UI must say so.
   */
  fromDefaults: boolean;
}

/**
 * Role grants for the access-control matrix: the SAME role_permissions
 * rows migration 010 defines, read directly (no per-user grants). Falls
 * back to the documented role defaults when the rows cannot be read.
 */
export async function getRolePermissionMatrix(): Promise<RoleMatrix> {
  const session = await requireStaff(areaRoles("users"));
  const defaults = (): RoleMatrix => {
    const grants: Record<MatrixRole, PermissionName[]> = {
      moderator: [],
      editor: [],
      admin: [],
    };
    for (const role of MATRIX_ROLES) {
      grants[role] = [...ROLE_PERMISSION_DEFAULTS[role]];
    }
    return { grants, fromDefaults: true };
  };
  let result: { data: unknown; error: unknown };
  try {
    result = await session.client
      .from("role_permissions")
      .select("role, permission");
  } catch {
    // A rejected read degrades to defaults, like an errored one.
    return defaults();
  }
  const grants: Record<MatrixRole, PermissionName[]> = {
    moderator: [],
    editor: [],
    admin: [],
  };
  if (result.error) {
    return defaults();
  }
  const collected = new Map<MatrixRole, PermissionName[]>();
  const rows = Array.isArray(result.data) ? result.data : [];
  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object" ||
      !isMatrixRole((row as { role: unknown }).role) ||
      !isPermissionName((row as { permission: unknown }).permission)
    ) {
      continue;
    }
    const role = (row as { role: MatrixRole }).role;
    const permission = (row as { permission: PermissionName }).permission;
    const existing = collected.get(role) ?? [];
    if (!existing.includes(permission)) existing.push(permission);
    collected.set(role, existing);
  }
  for (const role of MATRIX_ROLES) {
    grants[role] = ALL_PERMISSIONS.filter((permission) =>
      (collected.get(role) ?? []).includes(permission),
    );
  }
  return { grants, fromDefaults: false };
}

const ROLES_FORM_SCHEMA = z.object({
  user_id: z.uuid(),
  roles: z.array(z.enum(STAFF_ROLES)).max(STAFF_ROLES.length),
});

const PERMISSIONS_FORM_SCHEMA = z.object({
  user_id: z.uuid(),
  permissions: z.array(z.string()).max(ALL_PERMISSIONS.length),
});

const ROLE_GRANTS_FORM_SCHEMA = z.object({
  role: z.string(),
  permissions: z.array(z.string()).max(ALL_PERMISSIONS.length),
});

const STAFF_CREATION_SCHEMA = z.object({
  email: z.email().trim().max(254),
  password: NEW_STAFF_PASSWORD_SCHEMA,
  roles: z.array(z.enum(STAFF_ROLES)).min(1).max(STAFF_ROLES.length),
  permissions: z.array(z.string()).max(ALL_PERMISSIONS.length),
});

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function formValues(form: FormData, name: string): string[] {
  return form
    .getAll(name)
    .filter((value): value is string => typeof value === "string");
}

export async function setUserRoles(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("users"));
  const parsed = ROLES_FORM_SCHEMA.safeParse({
    user_id: formText(form, "user_id"),
    roles: formValues(form, "roles"),
  });
  if (!parsed.success) {
    return actionError("Choose valid roles and try again.");
  }
  const result = await session.client.rpc("admin_set_user_roles", {
    target_user: parsed.data.user_id,
    new_roles: parsed.data.roles,
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Roles could not be updated."),
    );
  }
  revalidatePath("/admin/system/users");
  return actionOk("Staff roles updated.");
}

/**
 * Replace one user's per-user permission grants (migration 010). Role
 * grants are untouched: unchecking a permission here removes only the
 * personal grant, so a permission that also comes from a role stays
 * effective. The form disables role-granted boxes to make this clear.
 */
export async function setUserPermissions(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("users"));
  const parsed = PERMISSIONS_FORM_SCHEMA.safeParse({
    user_id: formText(form, "user_id"),
    permissions: formValues(form, "permissions"),
  });
  if (!parsed.success) {
    return actionError("Choose valid permissions and try again.");
  }
  const grants = [...new Set(parsed.data.permissions)].filter(isPermissionName);
  if (grants.length !== parsed.data.permissions.length) {
    return actionError("Choose valid permissions and try again.");
  }
  const result = await session.client.rpc("admin_set_user_permissions", {
    target_user: parsed.data.user_id,
    new_permissions: grants,
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Permissions could not be updated."),
    );
  }
  revalidatePath("/admin/system/users");
  return actionOk("Access updated.");
}

/**
 * Replace one role's matrix-editable grants (migration 013 RPC). The
 * matrix rules are enforced here AND in the RPC: settings.manage and
 * users.manage can never be granted (owner-only), and costs.read can
 * never be granted to moderator or editor. Owner-only grants already on
 * the role are preserved by the RPC, not stripped.
 */
export async function setRolePermissions(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("users"));
  const parsed = ROLE_GRANTS_FORM_SCHEMA.safeParse({
    role: formText(form, "role"),
    permissions: formValues(form, "permissions"),
  });
  if (!parsed.success) {
    return actionError("Choose a valid role and try again.");
  }
  if (!isMatrixRole(parsed.data.role)) {
    return actionError("This role cannot be edited through the access matrix.");
  }
  if (!parsed.data.permissions.every(isPermissionName)) {
    return actionError("Choose valid permissions and try again.");
  }
  const grants = [...new Set(parsed.data.permissions)];
  const violations = matrixGrantViolations(parsed.data.role, grants);
  if (violations.length > 0) {
    return actionError(
      "That change is not allowed: settings and user management stay owner-only, and moderators and editors never see cost prices.",
    );
  }
  const result = await session.client.rpc("admin_set_role_permissions", {
    p_role: parsed.data.role,
    p_permissions: grants,
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Role access could not be updated."),
    );
  }
  revalidatePath("/admin/system/users");
  return actionOk("Role access updated.");
}

export async function removeStaffAccess(form: FormData): Promise<void> {
  "use server";
  const session = await requireStaff(areaRoles("users"));
  const userId = formText(form, "user_id");
  if (!z.uuid().safeParse(userId).success) return;
  await session.client.rpc("admin_remove_staff", { target_user: userId });
  revalidatePath("/admin/system/users");
}

/**
 * Create a staff account with an email + password set at creation and a
 * role assigned at creation time. This needs Supabase Auth administration,
 * which requires a service-role key held server-side only.
 *
 * Honest failure: no service-role key exists in this environment, so this
 * action fails closed with a clear message until an operator configures
 * SUPABASE_SERVICE_ROLE_KEY for the deployment (never in client code, never
 * displayed). The password is handled server-side only: never logged,
 * never returned, never shown in the UI. The list never shows emails.
 *
 * Provisioning prerequisite (operator): set SUPABASE_SERVICE_ROLE_KEY on
 * the deployment, apply migrations 001/006/010, and confirm the new staff
 * member completes MFA enrolment before first use (staffSession requires
 * AAL2). Role assignment runs through the staff session's RPC so the
 * last-owner guard and audit log apply exactly as for role edits.
 */
export async function createStaffMember(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("users"));
  const parsed = STAFF_CREATION_SCHEMA.safeParse({
    email: formText(form, "email"),
    password: formText(form, "password"),
    roles: formValues(form, "roles"),
    permissions: formValues(form, "permissions"),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(
      first?.message ?? "Check the new-user fields and try again.",
    );
  }
  const grants = [...new Set(parsed.data.permissions)].filter(isPermissionName);
  if (grants.length !== parsed.data.permissions.length) {
    return actionError("Choose valid permissions and try again.");
  }
  const config = adminConfiguration();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!config || !serviceKey) {
    return actionError(
      "Staff creation is not configured: the deployment has no service-role key. " +
        "Ask the operator to configure it, then try again. Nothing was created.",
    );
  }
  const admin = createClient(config.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const created = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    const message = created.error?.message ?? "";
    if (/already/i.test(message)) {
      return actionError(
        "An account with that email already exists. Assign roles to the existing account instead.",
      );
    }
    return actionError("The staff account could not be created. Try again later.");
  }
  const targetUser = created.data.user.id;
  const rolesResult = await session.client.rpc("admin_set_user_roles", {
    target_user: targetUser,
    new_roles: parsed.data.roles,
  });
  if (rolesResult.error) {
    return actionError(
      "The account was created, but roles could not be assigned. Assign roles from the list below.",
    );
  }
  if (grants.length > 0) {
    const grantsResult = await session.client.rpc(
      "admin_set_user_permissions",
      { target_user: targetUser, new_permissions: grants },
    );
    if (grantsResult.error) {
      return actionError(
        "The account was created and roles assigned, but extra access could not be saved. Update access from the list below.",
      );
    }
  }
  revalidatePath("/admin/system/users");
  return actionOk(
    "Staff account created with the chosen role. The new member must complete authenticator (MFA) setup before signing in to the admin.",
  );
}
