import Image from "next/image";
import { redirect } from "next/navigation";
import { staffSession } from "@/lib/admin/access";
import { StaffMfa } from "@/components/admin/access/StaffForms";
import { signOutStaff } from "@/lib/admin/actions";
export default async function MfaPage() {
  const session = await staffSession(false);
  if (session.aal === "aal2") redirect("/admin");
  const factors = await session.client.auth.mfa.listFactors();
  if (factors.error)
    throw new Error("Authenticator settings unavailable. Please retry.");
  return (
    <main id="main" tabIndex={-1} className="aa-login-layout">
      <section className="aa-login-panel" aria-labelledby="mfa-heading">
        <Image
          src="/brand/logo-maroon.png"
          alt="Official Attires Arena logo"
          className="aa-login-logo"
          width={132}
          height={127}
          unoptimized
        />
        <header className="aa-login-heading">
          <h1 id="mfa-heading">Two-step verification</h1>
          <p>Authenticator verification is required.</p>
        </header>
        <StaffMfa factorId={factors.data.totp[0]?.id} />
        <form action={signOutStaff} style={{ marginTop: "1rem", textAlign: "center" }}>
          <button className="aa-secondary">Sign out</button>
        </form>
      </section>
    </main>
  );
}
