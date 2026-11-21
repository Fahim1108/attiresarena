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
import { fromDatetimeLocal } from "./coupons";
import {
  WIDGET_ROW_SCHEMA,
  WIDGET_SCHEMA,
  type Widget,
} from "./reference-adapt";
import type { AdminActionResult } from "./authorization";

const WIDGET_COLUMNS =
  "id, title, type, placement, title_visible, title_alignment, title_size, subtitle, ends_at, offer_title, discount_text, style_theme, use_theme_color, background_color, accent_color, title_color, content_color, sort_position, active, created_at, updated_at";

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function formInt(form: FormData, name: string, fallback: number): number {
  const parsed = Number.parseInt(formText(form, name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** All widgets in display order. Null when unavailable (migration unapplied). */
export async function getWidgets(): Promise<Widget[] | null> {
  const session = await requireStaff(areaRoles("content"));
  const result = await session.client
    .from("homepage_widgets")
    .select(WIDGET_COLUMNS)
    .order("sort_position", { ascending: true })
    .order("created_at", { ascending: true });
  if (result.error) return null;
  const parsed = z.array(WIDGET_ROW_SCHEMA).safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

export interface WidgetWithStatus extends Widget {
  /** True when a countdown's end date has passed. */
  ended: boolean;
}

/**
 * Annotate widgets with their ended status for the admin list. The clock
 * read lives in the default parameter (a plain function, not a
 * component), so the list component stays pure.
 */
export function withWidgetStatus(
  widgets: readonly Widget[],
  nowMs: number = Date.now(),
): WidgetWithStatus[] {
  return widgets.map((widget) => ({
    ...widget,
    ended:
      widget.type === "countdown" &&
      widget.ends_at !== null &&
      Date.parse(widget.ends_at) <= nowMs,
  }));
}

/** Create or update a widget (migration 013 RPC). */
export async function saveWidget(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("content"));
  const id = formText(form, "id");
  const parsed = WIDGET_SCHEMA.safeParse({
    id: id === "" ? null : id,
    title: formText(form, "title"),
    type: formText(form, "type"),
    placement: formText(form, "placement"),
    title_visible: form.get("title_visible") === "on",
    title_alignment: formText(form, "title_alignment"),
    title_size: formText(form, "title_size"),
    subtitle: formText(form, "subtitle"),
    ends_at: fromDatetimeLocal(formText(form, "ends_at")),
    offer_title: formText(form, "offer_title"),
    discount_text: formText(form, "discount_text"),
    style_theme: formText(form, "style_theme"),
    use_theme_color: form.get("use_theme_color") === "on",
    background_color: formText(form, "background_color"),
    accent_color: formText(form, "accent_color"),
    title_color: formText(form, "title_color"),
    content_color: formText(form, "content_color"),
    sort_position: formInt(form, "sort_position", 0),
    active: form.get("active") === "on",
  });
  if (!parsed.success) {
    return actionError("Check the widget fields and try again.");
  }
  const result = await session.client.rpc("admin_save_widget", {
    p_id: parsed.data.id,
    p_title: parsed.data.title,
    p_type: parsed.data.type,
    p_placement: parsed.data.placement,
    p_title_visible: parsed.data.title_visible,
    p_title_alignment: parsed.data.title_alignment,
    p_title_size: parsed.data.title_size,
    p_subtitle: parsed.data.subtitle,
    p_ends_at: parsed.data.ends_at,
    p_offer_title: parsed.data.offer_title,
    p_discount_text: parsed.data.discount_text,
    p_style_theme: parsed.data.style_theme,
    p_use_theme_color: parsed.data.use_theme_color,
    p_background_color: parsed.data.background_color,
    p_accent_color: parsed.data.accent_color,
    p_title_color: parsed.data.title_color,
    p_content_color: parsed.data.content_color,
    p_sort_position: parsed.data.sort_position,
    p_active: parsed.data.active,
  });
  if (result.error) {
    return actionError(toActionError(result.error, "Widget could not be saved."));
  }
  revalidatePath("/admin/content/widgets");
  revalidatePath("/");
  return actionOk("Widget saved.");
}

export async function deleteWidget(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("content"));
  const id = formText(form, "id");
  if (!id) return actionError("Choose a widget to delete.");
  const result = await session.client.rpc("admin_delete_widget", { p_id: id });
  if (result.error) {
    return actionError(toActionError(result.error, "Widget could not be deleted."));
  }
  revalidatePath("/admin/content/widgets");
  revalidatePath("/");
  return actionOk("Widget deleted.");
}

export async function toggleWidgetActive(
  _prev: AdminActionResult | null,
  form: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("content"));
  const id = formText(form, "id");
  if (!id) return actionError("Choose a widget to activate or deactivate.");
  const found = await session.client
    .from("homepage_widgets")
    .select(WIDGET_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (found.error || !found.data) {
    return actionError("Widget not found. It may have been deleted.");
  }
  const parsed = WIDGET_ROW_SCHEMA.safeParse(found.data);
  if (!parsed.success) {
    return actionError("Widget could not be loaded. Try again.");
  }
  const widget = parsed.data;
  const result = await session.client.rpc("admin_save_widget", {
    p_id: widget.id,
    p_title: widget.title,
    p_type: widget.type,
    p_placement: widget.placement,
    p_title_visible: widget.title_visible,
    p_title_alignment: widget.title_alignment,
    p_title_size: widget.title_size,
    p_subtitle: widget.subtitle,
    p_ends_at: widget.ends_at,
    p_offer_title: widget.offer_title,
    p_discount_text: widget.discount_text,
    p_style_theme: widget.style_theme,
    p_use_theme_color: widget.use_theme_color,
    p_background_color: widget.background_color,
    p_accent_color: widget.accent_color,
    p_title_color: widget.title_color,
    p_content_color: widget.content_color,
    p_sort_position: widget.sort_position,
    p_active: !widget.active,
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Widget could not be updated."),
    );
  }
  revalidatePath("/admin/content/widgets");
  revalidatePath("/");
  return actionOk(widget.active ? "Widget deactivated." : "Widget activated.");
}
