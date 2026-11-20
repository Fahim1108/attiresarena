import { Notice } from "@/components/admin/ui";
import { BrandImageForm, StoreNameForm } from "@/components/admin/settings/forms";
import { CustomizeForm } from "@/components/admin/settings/customize-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import {
  clearBrandImage,
  getStoreSettingsMap,
  saveStoreSettings,
  settingString,
  signedStorageUrl,
  uploadBrandImage,
} from "@/lib/admin/settings";
import {
  getLayoutSettings,
  saveCustomizeSettings,
} from "@/lib/admin/layout-settings";
import {
  CUSTOMIZE_BUTTONS_SCHEMA,
  CUSTOMIZE_TYPOGRAPHY_SCHEMA,
  DEFAULT_CUSTOMIZE_BUTTONS,
  DEFAULT_CUSTOMIZE_TYPOGRAPHY,
} from "@/lib/admin/reference-adapt";
import { theme } from "@/config";

export default async function ThemeSettingsPage() {
  const settings = await getStoreSettingsMap();
  const layoutSettings = await getLayoutSettings();
  const parsedTypography = CUSTOMIZE_TYPOGRAPHY_SCHEMA.safeParse(
    layoutSettings?.customize_typography,
  );
  const parsedButtons = CUSTOMIZE_BUTTONS_SCHEMA.safeParse(
    layoutSettings?.customize_buttons,
  );
  const typography = parsedTypography.success
    ? parsedTypography.data
    : DEFAULT_CUSTOMIZE_TYPOGRAPHY;
  const buttons = parsedButtons.success
    ? parsedButtons.data
    : DEFAULT_CUSTOMIZE_BUTTONS;
  const logoPath = settingString(settings, "logo_storage_path");
  const faviconPath = settingString(settings, "favicon_storage_path");
  const [logoUrl, faviconUrl] = await Promise.all([
    signedStorageUrl(logoPath || null),
    signedStorageUrl(faviconPath || null),
  ]);
  const palette: [string, string][] = [
    ["Primary", theme.colors.primary],
    ["Primary dark", theme.colors.primaryDark],
    ["Background", theme.colors.background],
    ["Surface", theme.colors.surface],
    ["Text", theme.colors.text],
    ["Muted text", theme.colors.textMuted],
    ["Border", theme.colors.border],
    ["Selected", theme.colors.selected],
  ];

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Theme settings"
          description="Logo, favicon and store name. Only owners can change settings."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Settings
          </p>
        </PageHeader>
        {settings === null ? (
          <Notice kind="warning">
            Settings could not be loaded. Try again later.
          </Notice>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Store name</CardTitle>
          </CardHeader>
          <CardContent>
            <StoreNameForm action={saveStoreSettings} settings={settings ?? {}} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Logo</CardTitle>
            <CardDescription>
              Uploading a logo stores it privately. The saved logo replaces the header logo on the next page load.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BrandImageForm
              action={uploadBrandImage}
              clearAction={clearBrandImage}
              kind="logo"
              label="Logo"
              currentUrl={logoUrl}
              hasCurrent={Boolean(logoPath)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Favicon</CardTitle>
            <CardDescription>
              Uploading a favicon stores it privately. The saved favicon replaces the browser tab icon on the next page load.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BrandImageForm
              action={uploadBrandImage}
              clearAction={clearBrandImage}
              kind="favicon"
              label="Favicon"
              currentUrl={faviconUrl}
              hasCurrent={Boolean(faviconPath)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Customize</CardTitle>
            <CardDescription>
              Typography and button style, with a live preview. Stored only — the storefront theme is unchanged until a follow-up wires these values.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {layoutSettings === null ? (
              <Notice kind="warning">
                Customize settings could not be loaded. If the
                reference-additions migration has not applied yet, customize
                storage is unavailable.
              </Notice>
            ) : null}
            <CustomizeForm
              initialTypography={typography}
              initialButtons={buttons}
              action={saveCustomizeSettings}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Current palette (read-only)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-admin-text-secondary">
              Colors and fonts follow the storefront theme and are changed in
              code. The values below are the live theme tokens.
            </p>
            <dl className="aa-fact-grid">
              {palette.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    <span
                      aria-hidden
                      style={{
                        display: "inline-block",
                        width: "1rem",
                        height: "1rem",
                        border: "1px solid rgb(var(--admin-border))",
                        background: value,
                        verticalAlign: "middle",
                        marginRight: "0.5rem",
                      }}
                    />
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-sm leading-6 text-admin-text-secondary">
              Serif: {theme.typography.serif} — Sans: {theme.typography.sans}
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
