import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  requireStaff,
  actionOk,
  actionError,
  toActionError,
} from "./authorization";
import {
  areaRoles,
  isStaffRole,
  STAFF_ROLES,
  type StaffRole,
} from "./constants";
import type { AdminActionResult } from "./authorization";

export interface StaffMember {
  userId: string;
  displayName: string;
  roles: StaffRole[];
}

/**
 * List staff members: user_roles joined with profiles. Email addresses
 * live in Supabase Auth and are not queryable here, so the UI shows the
 * user id (shortened) and display name instead. Null when unavailable
 * (for example, before migration 006 applies, RLS returns only own rows
 * or none — the page says so honestly).
 */
export async function getStaffMembers(): Promise<StaffMember[] | null> {
  const session = await requireStaff(areaRoles("users"));
  const rolesResult = await session.client
    .from("user_roles")
    .select("user_id, role");
  if (rolesResult.error) return null;
  const profilesResult = await session.client
    .from("profiles")
    .select("id, display_name");
  const names = new Map<string, string>();
  if (!profilesResult.error) {
    for (const profile of profilesResult.data ?? []) {
      names.set(profile.id, profile.display_name);
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
    ([userId, roles]) => ({
      userId,
      displayName: names.get(userId) ?? "",
      roles: [...roles].sort(
        (a, b) => STAFF_ROLES.indexOf(a) - STAFF_ROLES.indexOf(b),
      ),
    }),
  );
  members.sort((a, b) => {
    const aName = a.displayName || a.userId;
    const bName = b.displayName || b.userId;
    return aName.localeCompare(bName);
  });
  return members;
}

/** Count owners excluding one user — mirrors the last-owner guard. */
export function countOtherOwners(
  members: readonly StaffMember[],
  excludeUserId: string,
): number {
  return members.filter(
    (member) =>
      member.userId !== excludeUserId && member.roles.includes("owner"),
  ).length;
}

const ROLES_FORM_SCHEMA = z.object({
  user_id: z.uuid(),
  roles: z.array(z.enum(STAFF_ROLES)).max(STAFF_ROLES.length),
});

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function setUserRoles(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("users"));
  const roles = form
    .getAll("roles")
    .filter((value): value is string => typeof value === "string");
  const parsed = ROLES_FORM_SCHEMA.safeParse({
    user_id: formText(form, "user_id"),
    roles,
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

export async function removeStaffAccess(form: FormData): Promise<void> {
  "use server";
  const session = await requireStaff(areaRoles("users"));
  const userId = formText(form, "user_id");
  if (!z.uuid().safeParse(userId).success) return;
  await session.client.rpc("admin_remove_staff", { target_user: userId });
  revalidatePath("/admin/system/users");
}
