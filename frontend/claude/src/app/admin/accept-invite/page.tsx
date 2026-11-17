import Image from "next/image";
import { notFound } from "next/navigation";
import { isProductionStorefront } from "@/lib/storefront-policy";
import { AcceptInviteForm } from "@/components/admin/access/AcceptInviteForm";
export const metadata = {
  title: "Secure Staging account setup | Attires Arena",
  referrer: "no-referrer" as const,
};
export default function AcceptInvitePage() {
  if (isProductionStorefront()) notFound();
  return (
    <main id="main" tabIndex={-1} className="aa-login-layout aa-admin-ds aa-login--ds font-admin-sans">
      <section className="aa-login-panel" aria-labelledby="accept-invite-heading">
        <Image
          src="/brand/logo-maroon.png"
          alt="Official Attires Arena logo"
          className="aa-login-logo"
          width={132}
          height={127}
          unoptimized
        />
        <header className="aa-login-heading">
          <h1 id="accept-invite-heading">Set up your Staging account</h1>
        </header>
        <AcceptInviteForm />
      </section>
    </main>
  );
}
