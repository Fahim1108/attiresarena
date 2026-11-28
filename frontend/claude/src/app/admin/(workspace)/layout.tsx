import { isProductionStorefront } from "@/lib/storefront-policy";
import { staffSession } from "@/lib/admin/access";
import { adminConfiguration } from "@/lib/admin/supabase";
import { readPendingOrderCount } from "@/lib/admin/orders";
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
  // Notification-bell badge: pending (new/unconfirmed) orders. One cheap
  // head-count query per workspace page load; 0 when there is no session
  // (Supabase unconfigured), so the bell renders without a badge.
  const pendingOrderCount = session ? await readPendingOrderCount() : 0;
  return (
    <AdminShell
      roles={session?.roles ?? []}
      pendingOrderCount={pendingOrderCount}
      stagingTools={!isProductionStorefront()}
      taxonomyTools={process.env.STAGING_CATALOGUE_TAXONOMY === "1"}
    >
      {children}
    </AdminShell>
  );
}
