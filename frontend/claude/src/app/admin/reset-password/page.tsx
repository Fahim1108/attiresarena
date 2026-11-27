import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffResetPassword } from "@/components/admin/access/StaffForms";
import { adminClient, adminConfiguration } from "@/lib/admin/supabase";
import { rolesSchema } from "@/lib/admin/validation";
import { ArrowLeft, LockKeyhole } from "lucide-react";

export const metadata = { title: "Set New Password" };

function ResetShell({
  heading,
  sub,
  children,
}: {
  heading: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="aa-login-layout aa-admin-ds aa-login--ds font-admin-sans"
    >
      <section className="aa-login-panel" aria-labelledby="staff-reset-heading">
        <Image
          src="/brand/logo-maroon.png"
          alt="Official Attires Arena logo"
          className="aa-login-logo"
          width={132}
          height={127}
          unoptimized
        />
        <header className="aa-login-heading">
          <h1 id="staff-reset-heading">{heading}</h1>
          <p>{sub}</p>
        </header>
        {children}
        <div className="aa-login-security">
          <LockKeyhole size={19} strokeWidth={1.6} aria-hidden="true" />
          <p>
            Secure staff access. Password recovery does not remove
            authenticator requirements.
          </p>
        </div>
        <Link className="aa-login-return" href="/admin/sign-in">
          <ArrowLeft size={14} aria-hidden="true" />
          Back to sign in
        </Link>
      </section>
    </main>
  );
}

/**
 * Set-new-password page, reached from the emailed reset link via
 * /admin/auth/callback. Requires a live staff session (recovery
 * session, AAL1): MFA is NOT required here — the visitor is resetting
 * because they cannot sign in — but the authenticator factor survives
 * the password change, so sign-in still requires the code afterwards.
 * Without a session the page says the link expired; without staff
 * roles the visitor is sent to sign-in (denied).
 */
export default async function StaffResetPasswordPage() {
  if (!adminConfiguration()) {
    return (
      <ResetShell
        heading="Set a new password"
        sub="Choose a new password for store administration."
      >
        <p role="alert">
          Development Supabase configuration is missing. Contact the project
          operator.
        </p>
      </ResetShell>
    );
  }
  let client;
  try {
    client = await adminClient(true);
  } catch {
    return (
      <ResetShell
        heading="Set a new password"
        sub="Choose a new password for store administration."
      >
        <p role="alert">
          Development Supabase configuration is missing. Contact the project
          operator.
        </p>
      </ResetShell>
    );
  }
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || user.is_anonymous) {
    return (
      <ResetShell
        heading="Set a new password"
        sub="Choose a new password for store administration."
      >
        <p role="alert">
          This reset link is invalid or expired. Request a new link from the
          sign-in page and try again.
        </p>
      </ResetShell>
    );
  }
  const roles = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const membership = rolesSchema.safeParse(roles.data);
  if (roles.error || !membership.success || !membership.data.length)
    redirect("/admin/sign-in?denied=1");
  return (
    <ResetShell
      heading="Set a new password"
      sub="Choose a new password for store administration."
    >
      <StaffResetPassword />
    </ResetShell>
  );
}
