import "server-only";
import { cache } from "react";
import { z } from "zod";
import type { AuthError, User } from "@supabase/supabase-js";
import { customerPhoneSchema } from "./validation";
import { customerClient, type CustomerClient } from "./supabase";

export interface CustomerSession {
  client: CustomerClient;
  user: User;
}

/**
 * Minimal client shape the session check needs. The real Supabase
 * client satisfies it; tests pass a fake without mocking the SDK.
 */
export interface CustomerAuthClient {
  auth: {
    getUser: () => Promise<{
      data: { user: User | null };
      error: AuthError | null;
    }>;
  };
}

/**
 * Identity via getUser() only, never getSession() alone. Anonymous
 * users count as not signed in. No MFA, no role check: a staff member
 * signing in as a customer gets a plain customer session with no admin
 * powers (admin access still requires the separate aa-admin-auth
 * session + AAL2).
 */
export async function resolveCustomerSession<C extends CustomerAuthClient>(
  client: C,
): Promise<{ client: C; user: User } | null> {
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || user.is_anonymous) return null;
  return { client, user };
}

/**
 * Per-request deduplicated customer session (React.cache): the layout,
 * page, and header menu each ask, but getUser() runs once per request.
 * Read-only client: cookie refresh happens in the proxy on /account*
 * and /auth/* paths. Server actions use customerClient(true) directly.
 */
export const customerSession = cache(async (): Promise<CustomerSession | null> => {
  const client = await customerClient();
  if (!client) return null;
  return resolveCustomerSession(client);
});

/* ------------------------------------------------------------------ */
/* Profile read                                                        */
/* ------------------------------------------------------------------ */

const profileRowSchema = z.object({
  display_name: z.string(),
  phone: z.string().nullable().optional(),
});

export interface CustomerProfileRead {
  displayName: string;
  phone: string;
}

/**
 * Own-row profile read. The phone column arrives with migration
 * 20261116000700; before it is applied the full select fails, so the
 * display name is read alone and the phone falls back to "" — sign-in
 * and the dashboard keep working, and profile/phone saving fails
 * honestly until the migration lands.
 */
export async function readCustomerProfile(
  client: CustomerClient,
  userId: string,
): Promise<CustomerProfileRead> {
  const full = await client
    .from("profiles")
    .select("display_name, phone")
    .eq("id", userId)
    .maybeSingle();
  const parsed = !full.error
    ? profileRowSchema.safeParse(full.data)
    : null;
  if (parsed?.success) {
    return {
      displayName: parsed.data.display_name,
      phone: parsed.data.phone ?? "",
    };
  }
  const minimal = await client
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  const minimalParsed = !minimal.error
    ? profileRowSchema.safeParse(minimal.data)
    : null;
  if (minimalParsed?.success) {
    return { displayName: minimalParsed.data.display_name, phone: "" };
  }
  return { displayName: "", phone: "" };
}

/* ------------------------------------------------------------------ */
/* Profile sync from Auth metadata (callback + registration transport) */
/* ------------------------------------------------------------------ */

/** Display name carried in Auth metadata (registration or Google profile). */
export function metadataDisplayName(
  metadata: Record<string, unknown> | undefined | null,
): string {
  const raw = metadata?.full_name ?? metadata?.name;
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 120);
}

/** Phone carried in Auth metadata, normalized to the strict stored form. */
export function metadataPhone(
  metadata: Record<string, unknown> | undefined | null,
): string {
  const raw = metadata?.phone;
  if (typeof raw !== "string") return "";
  const parsed = customerPhoneSchema.safeParse(raw);
  return parsed.success ? parsed.data : "";
}

/**
 * Patch that fills EMPTY profile fields from metadata, never overwriting
 * existing values. Metadata is transport only (decision D3): the
 * profile row is the record, and this sync never copies roles,
 * permissions, or anything else from metadata.
 */
export function profileSyncPatch(
  row: { display_name: string | null; phone: string | null } | null,
  metadata: Record<string, unknown> | undefined | null,
): { display_name?: string; phone?: string } {
  const patch: { display_name?: string; phone?: string } = {};
  const name = metadataDisplayName(metadata);
  if (name && !(row?.display_name ?? "").trim()) patch.display_name = name;
  const phone = metadataPhone(metadata);
  if (phone && !(row?.phone ?? "").trim()) patch.phone = phone;
  return patch;
}

/**
 * Best-effort profile sync after a code exchange. Never throws and
 * never blocks sign-in: any failure leaves the profile to be fixed by
 * the profile form. When the profile row is missing entirely (the
 * handle_new_user trigger should have created it), inserts the id +
 * display name, then fills the phone separately so a missing phone
 * column (migration unapplied) cannot lose the display name.
 */
export async function syncCustomerProfileFromMetadata(
  client: CustomerClient,
  user: User,
): Promise<void> {
  try {
    const read = await readSyncRow(client, user.id);
    if (!read) return;
    if (!read.found) {
      const name = metadataDisplayName(user.user_metadata);
      await client
        .from("profiles")
        .insert({ id: user.id, display_name: name });
      const phone = metadataPhone(user.user_metadata);
      if (phone) {
        await client.from("profiles").update({ phone }).eq("id", user.id);
      }
      return;
    }
    const patch = profileSyncPatch(read.row, user.user_metadata);
    if (Object.keys(patch).length === 0) return;
    // Two updates, not one combined patch: a missing phone column
    // (migration unapplied) must not lose the display name.
    if (patch.display_name) {
      await client
        .from("profiles")
        .update({ display_name: patch.display_name })
        .eq("id", user.id);
    }
    if (patch.phone) {
      await client.from("profiles").update({ phone: patch.phone }).eq("id", user.id);
    }
  } catch {
    // Sync is best-effort; sign-in must never fail because of it.
  }
}

/** Sync read with the same missing-phone-column fallback as readCustomerProfile. */
async function readSyncRow(
  client: CustomerClient,
  userId: string,
): Promise<{
  found: boolean;
  row: { display_name: string | null; phone: string | null };
} | null> {
  const full = await client
    .from("profiles")
    .select("display_name, phone")
    .eq("id", userId)
    .maybeSingle();
  if (!full.error) {
    if (!full.data) return { found: false, row: { display_name: null, phone: null } };
    const parsed = profileRowSchema.safeParse(full.data);
    if (!parsed.success) return null;
    return {
      found: true,
      row: { display_name: parsed.data.display_name, phone: parsed.data.phone ?? null },
    };
  }
  const minimal = await client
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (minimal.error) return null;
  if (!minimal.data) return { found: false, row: { display_name: null, phone: null } };
  const parsed = profileRowSchema.safeParse(minimal.data);
  if (!parsed.success) return null;
  return { found: true, row: { display_name: parsed.data.display_name, phone: null } };
}
