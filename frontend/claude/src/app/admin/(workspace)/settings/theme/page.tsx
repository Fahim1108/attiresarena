import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import { BrandImageForm, StoreNameForm } from "@/components/admin/settings/forms";
import { CustomizeForm } from "@/components/admin/settings/customize-forms";
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
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="Settings"
        title="Theme settings"
        description="Logo, favicon and store name. Only owners can change settings."
      />
      {settings === null ? (
        <Notice kind="warning">
          Settings could not be loaded. Try again later.
        </Notice>
      ) : null}
      <Panel title="Store name">
        <StoreNameForm action={saveStoreSettings} settings={settings ?? {}} />
      </Panel>
      <Panel
        title="Logo"
        description="Uploading a logo stores it privately. It applies once the header wiring reads the stored setting."
      >
        <BrandImageForm
          action={uploadBrandImage}
          clearAction={clearBrandImage}
          kind="logo"
          label="Logo"
          currentUrl={logoUrl}
          hasCurrent={Boolean(logoPath)}
        />
      </Panel>
      <Panel
        title="Favicon"
        description="Uploading a favicon stores it privately. It applies once the document metadata wiring reads the stored setting."
      >
        <BrandImageForm
          action={uploadBrandImage}
          clearAction={clearBrandImage}
          kind="favicon"
          label="Favicon"
          currentUrl={faviconUrl}
          hasCurrent={Boolean(faviconPath)}
        />
      </Panel>
      <Panel
        title="Customize"
        description="Typography and button style, with a live preview. Stored only — the storefront theme is unchanged until a follow-up wires these values."
      >
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
      </Panel>
      <Panel title="Current palette (read-only)">
        <p className="aa-muted">
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
                    border: "1px solid #ccc",
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
        <p className="aa-muted">
          Serif: {theme.typography.serif} — Sans: {theme.typography.sans}
        </p>
      </Panel>
    </main>
  );
}
