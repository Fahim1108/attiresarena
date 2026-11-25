import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { adminClient } from "./supabase";
import { rolesSchema, snapshotSchema } from "./validation";

/**
 * Client feedback item 17 (admin speed): the staff session check
 * gates every admin page — the workspace layout awaits it before
 * the shell can stream, and pages call it again for their data
 * client, so a dashboard load used to run it twice (6 sequential
 * Supabase calls: getUser, roles, MFA, twice). Two changes:
 *
 * 1. getUser and the MFA assurance check run in PARALLEL: they are
 *    independent (the assurance level needs no user id). The
 *    redirect ORDER is unchanged — no user, then no roles, then MFA
 *    — so a signed-out or role-less caller still lands on the same
 *    page as before.
 * 2. React cache() dedupes the check per request: the layout's call
 *    and the page's call share one execution (same args). Server
 *    actions get the same dedupe within one invocation.
 */
export const staffSession = cache(async function staffSession(requireMfa = true) {
  const client = await adminClient();
  const [userResult, assurance] = await Promise.all([
    client.auth.getUser(),
    client.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const {
    data: { user },
    error,
  } = userResult;
  if (error || !user || user.is_anonymous) redirect("/admin/sign-in");
  const roles = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const parsed = rolesSchema.safeParse(roles.data);
  if (roles.error || !parsed.success || parsed.data.length === 0)
    redirect("/admin/sign-in?denied=1");
  if (assurance.error) throw new Error("Unable to verify staff session.");
  if (requireMfa && assurance.data.currentLevel !== "aal2")
    redirect("/admin/mfa");
  return {
    client,
    user,
    roles: parsed.data.map((r) => r.role),
    aal: assurance.data.currentLevel,
  };
});
export async function catalogueSnapshot() {
  const session = await staffSession();
  if (
    !session.roles.some((r) =>
      ["owner", "product_manager", "order_manager", "analyst"].includes(r),
    )
  )
    return { session, snapshot: null };
  const result = await session.client.rpc("admin_catalogue_snapshot");
  if (result.error)
    throw new Error(
      "Catalogue unavailable. Check the development admin migration and session.",
    );
  return { session, snapshot: snapshotSchema.parse(result.data) };
}
