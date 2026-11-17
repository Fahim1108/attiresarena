import { Notice } from "@/components/admin/ui";
import { WidgetList } from "@/components/admin/content/widget-list";
import { WidgetForm, type WidgetFormInitial } from "@/components/admin/content/widget-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import { getWidgets, saveWidget, withWidgetStatus } from "@/lib/admin/widgets";
import { toDatetimeLocal } from "@/lib/admin/coupons";

export default async function WidgetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : "";
  const widgets = await getWidgets();
  const listed = widgets === null ? null : withWidgetStatus(widgets);
  const editing = (widgets ?? []).find((widget) => widget.id === editId);
  const initial: WidgetFormInitial | null = editing
    ? {
        id: editing.id,
        title: editing.title,
        type: editing.type,
        placement: editing.placement,
        title_visible: editing.title_visible,
        title_alignment: editing.title_alignment,
        title_size: editing.title_size,
        subtitle: editing.subtitle,
        ends_at: toDatetimeLocal(editing.ends_at),
        offer_title: editing.offer_title,
        discount_text: editing.discount_text,
        style_theme: editing.style_theme,
        use_theme_color: editing.use_theme_color,
        background_color: editing.background_color,
        accent_color: editing.accent_color,
        title_color: editing.title_color,
        content_color: editing.content_color,
        sort_position: String(editing.sort_position),
        active: editing.active,
      }
    : null;

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Widgets"
          description="Homepage countdown timers and announcements, placed after a homepage section."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Content
          </p>
        </PageHeader>
        <Notice kind="info">
          Only active widgets render on the homepage, after their placement
          section, and only while that section is enabled. Countdowns stop
          rendering at their end date. Inactive and ended widgets are stored
          but never shown.
        </Notice>
        {editing ? (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">{`Edit widget — ${editing.title}`}</CardTitle>
            </CardHeader>
            <CardContent>
              <WidgetForm action={saveWidget} initial={initial} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Add widget</CardTitle>
            </CardHeader>
            <CardContent>
              <WidgetForm action={saveWidget} initial={null} />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">All widgets</CardTitle>
          </CardHeader>
          <CardContent>
            {listed === null ? (
              <Notice kind="warning">
                Widgets could not be loaded. If the reference-additions migration
                has not applied yet, widget storage is unavailable. Try again later.
              </Notice>
            ) : (
              <WidgetList
                widgets={listed}
                emptyTitle="No widgets yet"
                emptyDescription="Add a widget above. Until one is active, the homepage renders exactly as before."
                editHref={(id) => `/admin/content/widgets?edit=${id}`}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
