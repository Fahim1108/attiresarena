import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  requireStaff,
  actionOk,
  actionError,
  toActionError,
} from "./authorization";
import { areaRoles } from "./constants";
import {
  REDIRECT_ROW_SCHEMA,
  REDIRECT_SCHEMA,
  normalizeRedirectSource,
  normalizeRedirectTarget,
  type Redirect,
} from "./reference-adapt";
import { getLayoutSettings } from "./layout-settings";
import type { AdminActionResult } from "./authorization";

const REDIRECT_COLUMNS = "id, source_path, target_path, code, active, created_at, updated_at";

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** All stored redirects in source order. Null when unavailable. */
export async function getRedirects(): Promise<Redirect[] | null> {
  const session = await requireStaff(areaRoles("settings"));
  const result = await session.client
    .from("url_redirects")
    .select(REDIRECT_COLUMNS)
    .order("source_path", { ascending: true });
  if (result.error) return null;
  const parsed = z.array(REDIRECT_ROW_SCHEMA).safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

/** Stored auto-redirect toggle. False when unset or unavailable. */
export async function getRedirectAuto(): Promise<boolean> {
  const settings = await getLayoutSettings();
  return settings?.redirect_auto === true;
}

/** Create or update a redirect (migration 013 RPC). Enforced on the storefront by src/proxy.ts while redirect_auto is on. */
export async function saveRedirect(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const id = formText(form, "id");
  const source = normalizeRedirectSource(formText(form, "source_path"));
  const target = normalizeRedirectTarget(formText(form, "target_path"));
  const code = Number(formText(form, "code"));
  const parsed = REDIRECT_SCHEMA.safeParse({
    id: id === "" ? null : id,
    source_path: source ?? formText(form, "source_path"),
    target_path: target ?? formText(form, "target_path"),
    code,
    active: form.get("active") === "on",
  });
  if (!parsed.success) {
    return actionError("Check the redirect fields and try again.");
  }
  const result = await session.client.rpc("admin_save_redirect", {
    p_id: parsed.data.id,
    p_source_path: parsed.data.source_path,
    p_target_path: parsed.data.target_path,
    p_code: parsed.data.code,
    p_active: parsed.data.active,
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Redirect could not be saved."),
    );
  }
  revalidatePath("/admin/system/redirects");
  return actionOk("Redirect saved.");
}

export async function deleteRedirect(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const id = formText(form, "id");
  if (!id) return actionError("Choose a redirect to delete.");
  const result = await session.client.rpc("admin_delete_redirect", { p_id: id });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Redirect could not be deleted."),
    );
  }
  revalidatePath("/admin/system/redirects");
  return actionOk("Redirect deleted.");
}

export async function toggleRedirectActive(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const id = formText(form, "id");
  if (!id) return actionError("Choose a redirect to enable or disable.");
  const found = await session.client
    .from("url_redirects")
    .select(REDIRECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (found.error || !found.data) {
    return actionError("Redirect not found. It may have been deleted.");
  }
  const parsed = REDIRECT_ROW_SCHEMA.safeParse(found.data);
  if (!parsed.success) {
    return actionError("Redirect could not be loaded. Try again.");
  }
  const redirect = parsed.data;
  const result = await session.client.rpc("admin_save_redirect", {
    p_id: redirect.id,
    p_source_path: redirect.source_path,
    p_target_path: redirect.target_path,
    p_code: redirect.code,
    p_active: !redirect.active,
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Redirect could not be updated."),
    );
  }
  revalidatePath("/admin/system/redirects");
  return actionOk(redirect.active ? "Redirect disabled." : "Redirect enabled.");
}
