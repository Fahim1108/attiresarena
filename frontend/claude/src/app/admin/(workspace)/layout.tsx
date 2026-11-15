import { isProductionStorefront } from "@/lib/storefront-policy";
import { staffSession } from "@/lib/admin/access";
import { adminConfiguration } from "@/lib/admin/supabase";
import { AdminShell } from "@/components/admin/access/AdminShell";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Staff protection is unchanged: with Supabase configured, every workspace
  // page requires a signed-in, MFA-verified staff session (staffSession
  // redirects otherwise). Only when Supabase is not configured at all does
  // the layout render the shell without a session, so the dashboard can show
  // its honest "data unavailable" notice instead of crashing; no staff data
  // is reachable in that state because every query needs the same config.
  const session = adminConfiguration() ? await staffSession() : null;
  return (
    <AdminShell
      roles={session?.roles ?? []}
      stagingTools={!isProductionStorefront()}
      taxonomyTools={process.env.STAGING_CATALOGUE_TAXONOMY === "1"}
    >
      {children}
    </AdminShell>
  );
}
