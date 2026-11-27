import { NextResponse, type NextRequest } from "next/server";
import { adminClient, adminConfiguration } from "@/lib/admin/supabase";
import { rolesSchema, staffCallbackDestination } from "@/lib/admin/validation";

export const dynamic = "force-dynamic";

/**
 * Staff password-recovery code exchange. Mirrors the customer
 * /auth/callback, but on the admin client (aa-admin-auth cookie) and
 * with a staff gate: only an account holding a user_roles row may
 * complete a reset through the admin path — a customer account that
 * follows a staff reset link is signed out and sent to staff sign-in
 * (denied). The exchanged session is AAL1 (recovery); MFA is still
 * enforced by staffSession() on /admin, so a reset never weakens
 * authenticator requirements. The only destination is
 * /admin/reset-password (exact-match allowlist).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const providerError = params.get("error");
  if (providerError) {
    // The provider refused before issuing a code. Provider text is
    // never echoed; only the classified outcome is shown.
    return new NextResponse(
      "This link is invalid or expired. Please request a new link.",
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const code = params.get("code");
  if (!adminConfiguration() || !code || code.length > 2048) {
    return new NextResponse("Invalid or unavailable authentication link.", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
  let client;
  try {
    client = await adminClient(true);
  } catch {
    return new NextResponse("Invalid or unavailable authentication link.", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    return new NextResponse(
      "This link is invalid or expired. Please request a new link.",
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError || !user || user.is_anonymous) {
    if (user?.is_anonymous) {
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    }
    return new NextResponse(
      "This link is invalid or expired. Please request a new link.",
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const roles = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const membership = rolesSchema.safeParse(roles.data);
  if (roles.error || !membership.success || !membership.data.length) {
    await client.auth.signOut({ scope: "local" }).catch(() => {});
    return new NextResponse(null, {
      status: 303,
      headers: {
        Location: "/admin/sign-in?denied=1",
        "Cache-Control": "no-store",
      },
    });
  }
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: staffCallbackDestination(params.get("next")),
      "Cache-Control": "no-store",
    },
  });
}
