import "server-only";

import { z } from "zod";
import { requireStaff, actionOk, actionError } from "./authorization";
import { adminClient } from "./supabase";
import type { AdminActionResult } from "./authorization";

/**
 * Change the current staff member's own password. Uses the staff session
 * client with cookie writes (the Supabase auth mutation may rotate the
 * session), following the setup-actions pattern. The session is already
 * MFA-verified (aal2) via requireStaff, so no current-password field is
 * collected.
 */
export const PASSWORD_SCHEMA = z
  .object({
    password: z
      .string()
      .min(12, "Use at least 12 characters.")
      .max(128)
      .refine(
        (value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value),
        "Include at least one letter and one number.",
      ),
    confirmPassword: z.string().min(12).max(128),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords must match.",
    path: ["confirmPassword"],
  });

export async function changeOwnPassword(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  await requireStaff();
  const rawPassword = form.get("password");
  const rawConfirm = form.get("confirmPassword");
  const parsed = PASSWORD_SCHEMA.safeParse({
    password: typeof rawPassword === "string" ? rawPassword : "",
    confirmPassword: typeof rawConfirm === "string" ? rawConfirm : "",
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(
      first?.message ?? "Use matching passwords of 12–128 characters.",
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
