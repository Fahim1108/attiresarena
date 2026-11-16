import { NextResponse, type NextRequest } from "next/server";
import { customerCallbackDestination } from "@/lib/customer/redirects";
import { syncCustomerProfileFromMetadata } from "@/lib/customer/session";
import { customerClient } from "@/lib/customer/supabase";
import {
  GOOGLE_IDENTITY_CONFLICT_MESSAGE,
  isIdentityConflictText,
} from "@/lib/customer/validation";

export const dynamic = "force-dynamic";

/**
 * PKCE/email/OAuth code exchange for customer auth. Mirrors the root
 * app's callback: requires configuration + a bounded code, exchanges
 * exactly once, rejects anonymous sessions, syncs the profile from
 * metadata (never overwriting), then 303s to an exact-match allowlist
 * destination. No-store throughout. The only mutation this GET
 * performs is the standard Supabase code exchange.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const providerError = params.get("error");
  if (providerError) {
    // The provider refused before issuing a code (e.g. the Google
    // email already has a password account). Provider text is never
    // echoed; only the classified outcome is shown.
    const description = params.get("error_description") ?? "";
    const conflict = isIdentityConflictText(
      `${providerError} ${description}`,
    );
    return new NextResponse(
      conflict
        ? GOOGLE_IDENTITY_CONFLICT_MESSAGE
        : "This link is invalid or expired. Please request a new link.",
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const code = params.get("code");
  const client = await customerClient(true);
  if (!client || !code || code.length > 2048) {
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
  await syncCustomerProfileFromMetadata(client, user);
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: customerCallbackDestination(params.get("next")),
      "Cache-Control": "no-store",
    },
  });
}
