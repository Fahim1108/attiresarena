import "server-only";
import { redirect } from "next/navigation";
import { staffSession } from "./access";
import { COST_VIEWING_ROLES } from "./constants";
import type { StaffRole } from "./constants";

export type StaffSession = Awaited<ReturnType<typeof staffSession>>;

/**
 * Require a signed-in staff session (MFA AAL2 enforced by staffSession) whose
 * roles intersect `allowed`. Redirects to the staff sign-in page otherwise.
 * Every new admin page and Server Action must go through this helper (or
 * staffSession directly) — never trust a role passed from the client.
 */
export async function requireStaff(
  allowed?: readonly StaffRole[],
): Promise<StaffSession> {
  const session = await staffSession();
  if (allowed && allowed.length > 0) {
    const ok = session.roles.some((role) =>
      (allowed as readonly string[]).includes(role),
    );
    if (!ok) redirect("/admin/sign-in?denied=1");
  }
  return session;
}

export function hasAnyRole(
  session: Pick<StaffSession, "roles">,
  allowed: readonly string[],
): boolean {
  return session.roles.some((role) => allowed.includes(role));
}

export function isOwner(session: Pick<StaffSession, "roles">): boolean {
  return session.roles.includes("owner");
}

/**
 * Whether the session may view product cost prices. Moderators and editors
 * must never see costs; only owner, admin and product_manager roles may.
 *
 * This is a role-based forward path for loaders: the authoritative check is
 * the database `costs.read` permission (private.has_permission, extended by
 * migration 010 to include per-user grants). A session whose roles are
 * outside COST_VIEWING_ROLES but who holds a per-user costs.read grant is
 * rare by design (grants are owner-managed); loaders that need exactness
 * must call the `admin_can_view_product_costs` RPC instead of this helper.
 * Never use this helper to decide what to SELECT from product_variants
 * directly: direct PostgREST reads still return the cost column to anyone
 * with catalogue.read until loaders switch to the cost RPC (see the build
 * report for the residual).
 */
export function canViewProductCosts(
  session: Pick<StaffSession, "roles">,
): boolean {
  return session.roles.some((role) =>
    (COST_VIEWING_ROLES as readonly string[]).includes(role),
  );
}

/** Result shape for admin Server Actions: never throw user-facing errors. */
export type AdminActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export function actionOk(message: string): AdminActionResult {
  return { ok: true, message };
}

export function actionError(error: string): AdminActionResult {
  return { ok: false, error };
}

/** Map a Supabase/PostgREST error to a safe user-facing message. */
export function toActionError(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      // Database exceptions raised by the admin RPCs carry safe messages.
      if (
        /reload|not available|not authorized|permission|MFA|Invalid|not found|insufficient|duplicate|already exists|required/i.test(
          message,
        )
      ) {
        return message;
      }
    }
  }
  return fallback;
}
