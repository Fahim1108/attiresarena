import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/account/AuthForms";
import { customerSession } from "@/lib/customer/session";

export const metadata: Metadata = { title: "Set New Password" };

/**
 * Set-new-password page, reached from the emailed reset link via
 * /auth/callback. Requires a live session; without one the visitor is
 * sent to request a fresh link. The password update trusts the session
 * (standard Supabase pattern) — see IMPLEMENTATION_NOTES.md (D10).
 */
export default async function ResetPasswordPage() {
  const session = await customerSession();
  if (!session) redirect("/account/forgot-password");
  return (
    <>
      <h1 className="text-center font-serif text-4xl text-ink">Set a new password</h1>
      <p className="mb-7 mt-2 text-center text-sm text-ink-muted">Choose a new password for your account.</p>
      <ResetPasswordForm />
    </>
  );
}
