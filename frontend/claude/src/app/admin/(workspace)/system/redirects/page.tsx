import { Notice } from "@/components/admin/ui";
import {
  RedirectAutoForm,
  RedirectForm,
  type RedirectFormInitial,
} from "@/components/admin/system/redirect-forms";
import { RedirectList } from "@/components/admin/system/redirect-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import {
  getRedirectAuto,
  getRedirects,
  saveRedirect,
} from "@/lib/admin/redirects";
import { setRedirectAuto } from "@/lib/admin/layout-settings";

export default async function RedirectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : "";
  const [redirects, autoEnabled] = await Promise.all([
    getRedirects(),
    getRedirectAuto(),
  ]);
  const editing = (redirects ?? []).find((redirect) => redirect.id === editId);
  const initial: RedirectFormInitial | null = editing
    ? {
        id: editing.id,
        source_path: editing.source_path,
        target_path: editing.target_path,
        code: editing.code,
        active: editing.active,
      }
    : null;

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Redirects"
          description="Stored URL redirects. Only owners can change settings."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            System
          </p>
        </PageHeader>
        <Notice kind="info">
          Redirects saved here take effect on the storefront while
          Automatic redirects (below) is on: a visitor to a saved old path
          is sent to its target. Turn the toggle off to pause all redirects
          without deleting them.
        </Notice>
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Automatic redirects</CardTitle>
            <CardDescription>
              When on, the storefront redirects saved old URLs to their targets. When off, saved redirects do nothing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RedirectAutoForm enabled={autoEnabled} action={setRedirectAuto} />
          </CardContent>
        </Card>
        {editing ? (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">{`Edit redirect — ${editing.source_path}`}</CardTitle>
            </CardHeader>
            <CardContent>
              <RedirectForm action={saveRedirect} initial={initial} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Add redirect</CardTitle>
            </CardHeader>
            <CardContent>
              <RedirectForm action={saveRedirect} initial={null} />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Active redirects</CardTitle>
          </CardHeader>
          <CardContent>
            {redirects === null ? (
              <Notice kind="warning">
                Redirects could not be loaded. If the reference-additions
                migration has not applied yet, redirect storage is unavailable.
                Try again later.
              </Notice>
            ) : (
              <RedirectList
                redirects={redirects}
                emptyTitle="No redirects yet"
                emptyDescription="Add a redirect above. Redirects only take effect while Automatic redirects is on."
                editHref={(id) => `/admin/system/redirects?edit=${id}`}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
