import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireStaff, actionOk, actionError } from "./authorization";
import { adminClient, adminConfiguration } from "./supabase";
import type { AdminActionResult } from "./authorization";

/**
 * Change the current staff member's own password. The CURRENT password is
 * always required first: the session user's email + the supplied current
 * password are verified against Supabase Auth before anything changes.
 * A wrong current password is a clear error and NO change happens.
 *
 * Reauthentication uses a throwaway in-memory client (no cookies), so the
 * MFA-verified staff session is never disturbed by the password check.
 * The actual update uses the staff session client with cookie writes
 * (the Supabase auth mutation may rotate the session), following the
 * setup-actions pattern.
 *
 * The same throwaway-client check is reused by the test-data erase
 * (verifyStaffPassword below): for an MFA-enrolled user
 * signInWithPassword returns an AAL1 session, which still proves
 * knowledge of the password — the erase itself runs under the
 * already MFA-verified staff session. The throwaway session is
 * discarded immediately; nothing is persisted, logged or stored.
 */
/** Shared staff-password strength rule (own change + staff creation). */
export const NEW_STAFF_PASSWORD_SCHEMA = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128)
  .refine(
    (value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value),
    "Include at least one letter and one number.",
  );

export const PASSWORD_SCHEMA = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Enter your current password.")
      .max(128),
    password: NEW_STAFF_PASSWORD_SCHEMA,
    confirmPassword: z.string().min(12).max(128),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords must match.",
    path: ["confirmPassword"],
  })
  .refine((value) => value.password !== value.currentPassword, {
    message: "Use a new password that is different from the current password.",
    path: ["password"],
  });

/**
 * Verify a staff member's login password against Supabase Auth, server-side
 * only. Uses a throwaway in-memory client (persistSession: false, no
 * cookies), so the caller's MFA-verified staff session is never disturbed
 * and no session is persisted. The password is never logged or stored;
 * the result is a single boolean. For an MFA-enrolled user
 * signInWithPassword returns an AAL1 session — that still proves knowledge
 * of the password, which is all this check is for. Wrong passwords follow
 * the same behaviour as staff sign-in: a plain failure, with Supabase
 * Auth's own rate limiting as the backstop — no custom lockout that could
 * lock the owner out of admin.
 */
export async function verifyStaffPassword(
  email: string,
  password: string,
): Promise<boolean> {
  const config = adminConfiguration();
  if (!email || !password || !config) return false;
  const verifier = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await verifier.auth.signInWithPassword({
    email,
    password,
  });
  return !verified.error && !!verified.data.user;
}

export async function changeOwnPassword(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff();
  const rawCurrent = form.get("currentPassword");
  const rawPassword = form.get("password");
  const rawConfirm = form.get("confirmPassword");
  const parsed = PASSWORD_SCHEMA.safeParse({
    currentPassword: typeof rawCurrent === "string" ? rawCurrent : "",
    password: typeof rawPassword === "string" ? rawPassword : "",
    confirmPassword: typeof rawConfirm === "string" ? rawConfirm : "",
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(
      first?.message ?? "Use matching passwords of 12–128 characters.",
    );
  }
  const email = session.user.email;
  // Reauthenticate BEFORE updating: wrong current password = no change.
  if (!email || !(await verifyStaffPassword(email, parsed.data.currentPassword))) {
    return actionError(
      "The current password is incorrect. Nothing was changed.",
    );
  }
  const client = await adminClient(true);
  const result = await client.auth.updateUser({
    password: parsed.data.password,
  });
  if (result.error) {
    return actionError(
      "Password could not be saved. Use a stronger password and try again.",
    );
  }
  return actionOk(
    "Password changed. If you are signed out on another device, sign in again with the new password.",
  );
}
