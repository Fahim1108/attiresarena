import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { adminClient } from "./supabase";
import { rolesSchema, snapshotSchema } from "./validation";
/**
 * Staff session, deduplicated per server request with React cache():
 * the workspace layout AND the page both resolve the session (three
 * serial Supabase round trips each: getUser, roles, MFA assurance),
 * so every admin page paid for the session twice before any data
 * loaded. cache() keys on the argument, so staffSession() and
 * staffSession(false) stay separate entries, and the memo lives only
 * for one request — no cross-request sharing. A redirect still
 * throws on every call in the request, exactly as re-running it
 * would. The shared client is the same one the loaders already
 * reuse across their parallel queries.
 */
export const staffSession = cache(async function staffSession(
  requireMfa = true,
) {
  const client = await adminClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || user.is_anonymous) redirect("/admin/sign-in");
  const roles = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const parsed = rolesSchema.safeParse(roles.data);
  if (roles.error || !parsed.success || parsed.data.length === 0)
    redirect("/admin/sign-in?denied=1");
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
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
