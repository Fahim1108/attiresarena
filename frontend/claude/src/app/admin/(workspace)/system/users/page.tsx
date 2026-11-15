import Link from "next/link";
import { PageHeading, Panel, StatusBadge, Notice } from "@/components/admin/ui";
import { ConfirmSubmit } from "@/components/admin/ui-client";
import { RoleAssignmentForm } from "@/components/admin/system/forms";
import {
  countOtherOwners,
  getStaffMembers,
  removeStaffAccess,
  setUserRoles,
} from "@/lib/admin/users";
import { STAFF_ROLE_GROUPS, STAFF_ROLE_LABELS } from "@/lib/admin/constants";
import { requireStaff } from "@/lib/admin/authorization";

export default async function AdminUsersPage() {
  const session = await requireStaff();
  const members = await getStaffMembers();
  const ownerCount = (members ?? []).filter((member) =>
    member.roles.includes("owner"),
  ).length;

  return (
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="System"
        title="Admin users"
        description="Staff accounts, roles and access. Only owners can manage users."
        actions={
          <Link className="aa-button" href="/admin/accept-invite">
            Invite flow
          </Link>
        }
      />
      <Notice kind="info">
        Email addresses live in Supabase Auth and are not shown here; the
        short user id and display name identify each account. The invite
        flow at /admin/accept-invite is Staging-only — on Production it is
        unavailable and invitations are handled in Supabase Auth. Removing
        staff access deletes role assignments only; the account itself is
        not deleted.
      </Notice>
      {members === null ? (
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
          return (
            <Panel
              key={member.userId}
              title={member.displayName || "No display name"}
              description={`User ${member.userId.slice(0, 8)}…${isSelf ? " · This is you" : ""}`}
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
              <RoleAssignmentForm
                action={setUserRoles}
                userId={member.userId}
                currentRoles={member.roles}
                isSoleOwner={isSoleOwner}
              />
              <div style={{ marginTop: "1rem" }}>
                <ConfirmSubmit
                  action={removeStaffAccess}
                  fields={{ user_id: member.userId }}
                  buttonLabel="Remove staff access"
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
