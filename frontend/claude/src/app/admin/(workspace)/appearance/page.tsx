import { Notice } from "@/components/admin/ui";
import { LayoutTabs } from "@/components/admin/LayoutTabs";
import {
  ErrorPageForm,
  FooterLinksForm,
  NavigationLinksForm,
} from "@/components/admin/layout-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import { requireStaff } from "@/lib/admin/authorization";
import { areaRoles } from "@/lib/admin/constants";
import {
  getLayoutSettings,
  saveErrorPage,
  saveLayoutSettingJson,
} from "@/lib/admin/layout-settings";
import {
  DEFAULT_ERROR_403,
  ERROR_PAGE_SCHEMA,
  FOOTER_LINKS_SCHEMA,
  NAV_LINKS_SCHEMA,
  resolveErrorPage,
} from "@/lib/admin/reference-adapt";

export default async function AppearanceLayoutPage() {
  // Layout editors need the content area (settings staff are owners, who
  // are in every area). Staff outside both areas are redirected, like
  // every other admin tool page.
  await requireStaff([
    ...new Set([...areaRoles("content"), ...areaRoles("settings")]),
  ]);
  const settings = await getLayoutSettings();
  const parsedNavigation = NAV_LINKS_SCHEMA.safeParse(settings?.navigation_links);
  const navigationLinks = parsedNavigation.success ? parsedNavigation.data : [];
  const parsedFooter = FOOTER_LINKS_SCHEMA.safeParse(settings?.footer_links);
  const footerLinks = parsedFooter.success ? parsedFooter.data : [];
  const error404 = resolveErrorPage(settings?.error_404);
  const parsed403 = ERROR_PAGE_SCHEMA.safeParse(settings?.error_403);
  const error403 = parsed403.success ? parsed403.data : DEFAULT_ERROR_403;

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Layout"
          description="Navigation links, footer links and error pages. Homepage sections, hero slides, branding text and custom code live on their own tabs."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Appearance
          </p>
        </PageHeader>
        <LayoutTabs current="navigation" />
        <Notice kind="info">
          Homepage section order and visibility are defined in the storefront
          code and shown read-only under Homepage Sections. Hero slides are
          managed under Hero Slider. This page stores navigation, footer and
          error-page content; only the 404 title and subtitle render on the
          storefront today — the rest is stored until its storefront wiring
          is built, and each section below says so.
        </Notice>
        {settings === null ? (
          <Notice kind="warning">
            Layout settings could not be loaded. If the reference-additions
            migration has not applied yet, layout storage is unavailable.
            Saved values will appear once it applies.
          </Notice>
        ) : null}

        <div id="navigation" style={{ scrollMarginTop: "1rem" }}>
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Navigation</CardTitle>
              <CardDescription>
                Header navigation links with optional sub-links.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Notice kind="info">
                Stored only: the storefront header still uses its built-in
                links. Saved links take effect once header wiring reads them.
              </Notice>
              <NavigationLinksForm
                initial={navigationLinks}
                action={saveLayoutSettingJson}
              />
            </CardContent>
          </Card>
        </div>

        <div id="footer-links" style={{ scrollMarginTop: "1rem" }}>
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Footer Links</CardTitle>
              <CardDescription>
                Grouped links for the storefront footer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Notice kind="info">
                Stored only: the storefront footer still uses its built-in
                links. Saved links take effect once footer wiring reads them.
              </Notice>
              <FooterLinksForm
                initial={footerLinks}
                action={saveLayoutSettingJson}
              />
            </CardContent>
          </Card>
        </div>

        <div id="error-pages" className="space-y-6" style={{ scrollMarginTop: "1rem" }}>
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Error Pages — 404</CardTitle>
              <CardDescription>
                Title and subtitle for the storefront &apos;page not found&apos; page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Notice kind="info">
                The 404 title and subtitle apply on the next page load. The
                image URL is stored only: no error page renders an image yet.
              </Notice>
              <ErrorPageForm
                storageKey="error_404"
                initial={error404}
                action={saveErrorPage}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Error Pages — 403</CardTitle>
              <CardDescription>
                Title and subtitle for a future &apos;access denied&apos; page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Notice kind="info">
                Stored only: no 403 page exists in the storefront yet, so these
                values do nothing until one is built.
              </Notice>
              <ErrorPageForm
                storageKey="error_403"
                initial={error403}
                action={saveErrorPage}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
