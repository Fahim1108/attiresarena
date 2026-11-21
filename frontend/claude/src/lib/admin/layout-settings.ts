import "server-only";

import { revalidatePath } from "next/cache";
import {
  requireStaff,
  actionOk,
  actionError,
  toActionError,
} from "./authorization";
import { staffSession } from "./access";
import { areaRoles } from "./constants";
import {
  CUSTOMIZE_BUTTONS_SCHEMA,
  CUSTOMIZE_TYPOGRAPHY_SCHEMA,
  ERROR_PAGE_SCHEMA,
  LAYOUT_SETTING_AREAS,
  isLayoutSettingKey,
  parseLayoutSetting,
  type LayoutSettingKey,
} from "./reference-adapt";
import type { AdminActionResult } from "./authorization";

type StaffClient = Awaited<ReturnType<typeof staffSession>>["client"];

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function revalidateLayoutSurfaces(): void {
  revalidatePath("/admin/appearance");
  revalidatePath("/admin/catalog/categories");
  revalidatePath("/admin/settings/theme");
  revalidatePath("/admin/system/redirects");
  revalidatePath("/");
}

/**
 * Stored layout settings, parsed per key. Any signed-in staff member may
 * call this; RLS returns only the keys the caller's permissions allow, so
 * catalogue-only staff see an empty map rather than an error. Null when
 * the table cannot be read (migration unapplied).
 */
export async function getLayoutSettings(): Promise<Partial<
  Record<LayoutSettingKey, unknown>
> | null> {
  const session = await staffSession();
  // A rejecting query must degrade to null (unavailable) like an error
  // result — never throw into the calling page's error boundary.
  let result: { data: unknown; error: unknown };
  try {
    result = await session.client
      .from("layout_settings")
      .select("key, value");
  } catch {
    return null;
  }
  if (result.error) return null;
  const settings: Partial<Record<LayoutSettingKey, unknown>> = {};
  const rows = Array.isArray(result.data) ? result.data : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const key = (row as { key?: unknown }).key;
    if (!isLayoutSettingKey(key)) continue;
    const parsed = parseLayoutSetting(key, (row as { value?: unknown }).value);
    if (parsed !== null) settings[key] = parsed;
  }
  return settings;
}

async function writeLayoutSetting(
  client: StaffClient,
  key: LayoutSettingKey,
  value: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await client.rpc("admin_set_layout_setting", {
    p_key: key,
    p_value: value,
  });
  if (result.error) {
    return {
      ok: false,
      error: toActionError(result.error, "Setting could not be saved."),
    };
  }
  revalidateLayoutSurfaces();
  return { ok: true };
}

/**
 * Generic JSON save for the navigation/footer link editors (client forms
 * submit the nested value as a JSON string). Permission follows the key:
 * content keys accept content or settings staff, settings keys need
 * settings.manage — enforced by requireStaff here and by the RPC.
 */
export async function saveLayoutSettingJson(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const key = formText(form, "key");
  if (!isLayoutSettingKey(key)) {
    return actionError("Unknown setting.");
  }
  const session = await requireStaff(areaRoles(LAYOUT_SETTING_AREAS[key]));
  let value: unknown;
  try {
    value = JSON.parse(formText(form, "value"));
  } catch {
    return actionError("Setting value is invalid.");
  }
  const parsed = parseLayoutSetting(key, value);
  if (parsed === null) {
    return actionError("Check the setting value and try again.");
  }
  const written = await writeLayoutSetting(session.client, key, parsed);
  if (!written.ok) return actionError(written.error);
  return actionOk("Setting saved.");
}

/** Error-page editor: plain title/subtitle/image fields, one key per form. */
export async function saveErrorPage(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const key = formText(form, "key");
  if (key !== "error_404" && key !== "error_403") {
    return actionError("Unknown setting.");
  }
  const session = await requireStaff(areaRoles("content"));
  const parsed = ERROR_PAGE_SCHEMA.safeParse({
    title: formText(form, "title"),
    subtitle: formText(form, "subtitle"),
    image_url: formText(form, "image_url"),
  });
  if (!parsed.success) {
    return actionError("Check the error page fields and try again.");
  }
  const written = await writeLayoutSetting(session.client, key, parsed.data);
  if (!written.ok) return actionError(written.error);
  return actionOk("Error page saved.");
}

/** Redirect auto-toggle: the button submits value "true" or "false". */
export async function setRedirectAuto(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const raw = formText(form, "value");
  if (raw !== "true" && raw !== "false") {
    return actionError("Choose on or off and try again.");
  }
  const written = await writeLayoutSetting(
    session.client,
    "redirect_auto",
    raw === "true",
  );
  if (!written.ok) return actionError(written.error);
  return actionOk(
    raw === "true" ? "Automatic redirects turned on." : "Automatic redirects turned off.",
  );
}

/**
 * Customize form: typography + button style in one save. Both values are
 * validated before either is written; if the second write fails, the
 * message says the first was saved.
 */
export async function saveCustomizeSettings(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  let typographyRaw: unknown;
  let buttonsRaw: unknown;
  try {
    typographyRaw = JSON.parse(formText(form, "typography_value"));
    buttonsRaw = JSON.parse(formText(form, "buttons_value"));
  } catch {
    return actionError("Setting value is invalid.");
  }
  const typography = CUSTOMIZE_TYPOGRAPHY_SCHEMA.safeParse(typographyRaw);
  const buttons = CUSTOMIZE_BUTTONS_SCHEMA.safeParse(buttonsRaw);
  if (!typography.success || !buttons.success) {
    return actionError("Check the customize choices and try again.");
  }
  const first = await writeLayoutSetting(
    session.client,
    "customize_typography",
    typography.data,
  );
  if (!first.ok) return actionError(first.error);
  const second = await writeLayoutSetting(
    session.client,
    "customize_buttons",
    buttons.data,
  );
  if (!second.ok) {
    return actionError(
      "Typography was saved, but the button style could not be saved. Try again.",
    );
  }
  return actionOk("Customize settings saved.");
}
