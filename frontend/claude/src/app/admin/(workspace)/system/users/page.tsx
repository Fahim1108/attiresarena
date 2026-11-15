import Link from "next/link";
import { PageHeading, Panel, StatusBadge, Notice } from "@/components/admin/ui";
import { ConfirmSubmit } from "@/components/admin/ui-client";
import {
  CreateStaffForm,
  PermissionGrantsForm,
  RoleAssignmentForm,
  RoleMatrixForm,
} from "@/components/admin/system/forms";
import {
  countOtherOwners,
  createStaffMember,
  getRolePermissionMatrix,
  getStaffMembers,
  removeStaffAccess,
  setRolePermissions,
  setUserPermissions,
  setUserRoles,
} from "@/lib/admin/users";
import { MATRIX_ROLES } from "@/lib/admin/reference-adapt";
import {
  PERMISSION_LABELS,
  STAFF_ROLE_GROUPS,
  STAFF_ROLE_LABELS,
} from "@/lib/admin/constants";
import { requireStaff } from "@/lib/admin/authorization";

export default async function UserRolePage() {
  const session = await requireStaff();
  const staff = await getStaffMembers();
  const matrix = await getRolePermissionMatrix();
  const members = staff?.members ?? [];
  const ownerCount = members.filter((member) =>
    member.roles.includes("owner"),
  ).length;

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="System"
        title="User role"
        description="Staff accounts, roles and granular access. Only owners can manage users."
        actions={
          <Link className="aa-button" href="/admin/accept-invite">
            Invite flow
          </Link>
        }
      />
      <Notice kind="info">
        The list shows each member&apos;s name, roles and access only —
        email addresses and passwords are never shown here. Removing staff
        access deletes role assignments only; the account itself is not
        deleted. The invite flow at /admin/accept-invite is Staging-only —
        on Production it is unavailable and invitations are handled in
        Supabase Auth.
      </Notice>
      {staff?.permissionsFromDefaults ? (
        <Notice kind="warning">
          Live role-permission data could not be loaded, so role access
          below is shown from the documented role defaults. Personal grants
          are still shown from live data when available.
        </Notice>
      ) : null}
      <Panel
        title="Add a user"
        description="Set the email and password at creation and assign a role at the same time. The new member must complete authenticator (MFA) setup before signing in."
      >
        <CreateStaffForm action={createStaffMember} />
      </Panel>
      <Panel
        title="Role access matrix"
        description="What each role can access. Changes apply to every member with that role. Owner access is never edited here."
      >
        {matrix.fromDefaults ? (
          <Notice kind="warning">
            Live role-permission data could not be loaded, so the matrix
            shows the documented role defaults. Saving still writes through
            the role-grant action once the roles migration has applied.
          </Notice>
        ) : null}
        <div style={{ display: "grid", gap: "1.5rem" }}>
          {MATRIX_ROLES.map((role) => (
            <RoleMatrixForm
              key={role}
              action={setRolePermissions}
              role={role}
              granted={matrix.grants[role]}
            />
          ))}
        </div>
      </Panel>
      {staff === null ? (
        <Notice kind="warning">
          Staff members could not be loaded. If the users migration has not
          applied yet, only your own roles are visible.
        </Notice>
      ) : members.length === 0 ? (
        <Panel title="No staff members found">
          <p>
            No role assignments were returned. This can mean the users
            migration has not applied yet or your account lacks the
            users.manage permission.
          </p>
        </Panel>
      ) : (
        members.map((member) => {
          const isSelf = member.userId === session.user.id;
          const isSoleOwner =
            member.roles.includes("owner") && ownerCount <= 1;
          const others = countOtherOwners(members, member.userId);
          const roleGranted = member.permissions.filter(
            (permission) => !member.userGrants.includes(permission),
          );
          return (
            <Panel
              key={member.userId}
              title={member.displayName || "No display name"}
              description={isSelf ? "This is you" : undefined}
            >
              <p>
                {member.roles.map((role) => (
                  <span key={role} style={{ marginRight: "0.4rem" }}>
                    <StatusBadge tone="info">
                      {STAFF_ROLE_LABELS[role]} · {STAFF_ROLE_GROUPS[role]}
                    </StatusBadge>
                  </span>
                ))}
              </p>
              <p className="aa-muted">
                Access:{" "}
                {member.permissions.length > 0
                  ? member.permissions
                      .map((permission) => PERMISSION_LABELS[permission])
                      .join(", ")
                  : "No access"}
                {member.permissions.includes("costs.read")
                  ? " (can view cost prices)"
                  : " (cost prices hidden)"}
              </p>
              <RoleAssignmentForm
                action={setUserRoles}
                userId={member.userId}
                currentRoles={member.roles}
                isSoleOwner={isSoleOwner}
              />
              <div style={{ marginTop: "1rem" }}>
                <PermissionGrantsForm
                  action={setUserPermissions}
                  userId={member.userId}
                  userGrants={member.userGrants}
                  roleGranted={roleGranted}
                />
              </div>
              <div style={{ marginTop: "1rem" }}>
                <ConfirmSubmit
                  action={removeStaffAccess}
                  fields={{ user_id: member.userId }}
                  buttonLabel="Remove staff access"
                  ariaLabel={`Remove staff access for ${member.displayName || "this member"}`}
                  confirmTitle="Remove staff access?"
                  confirmBody={
                    others === 0 && member.roles.includes("owner")
                      ? "This is the last owner, so removal will be refused. Add another owner first."
                      : "Role assignments are deleted and the account loses staff access. The account itself is not deleted and can be re-added by assigning roles again."
                  }
                  confirmLabel="Remove access"
                />
              </div>
            </Panel>
          );
        })
      )}
    </main>
  );
}
