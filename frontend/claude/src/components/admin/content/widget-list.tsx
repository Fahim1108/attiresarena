import Link from "next/link";
import { ConfirmSubmit, SubmitButton } from "@/components/admin/ui-client";
import { EmptyState, StatusBadge } from "@/components/admin/ui";
import {
  deleteWidget,
  toggleWidgetActive,
  type WidgetWithStatus,
} from "@/lib/admin/widgets";
import {
  WIDGET_PLACEMENT_LABELS,
  WIDGET_TYPE_LABELS,
} from "@/lib/admin/reference-adapt";
import { formatDateTime } from "@/lib/admin/format";

export function WidgetList({
  widgets,
  emptyTitle,
  emptyDescription,
  editHref,
}: {
  widgets: WidgetWithStatus[];
  emptyTitle: string;
  emptyDescription: string;
  editHref: (id: string) => string;
}) {
  if (widgets.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="aa-table-scroll">
      <table className="aa-table">
        <thead>
          <tr>
            <th scope="col">Widget</th>
            <th scope="col">Type</th>
            <th scope="col">Placement</th>
            <th scope="col">Ends</th>
            <th scope="col">Order</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {widgets.map((widget) => {
            const ended = widget.ended;
            return (
              <tr key={widget.id}>
                <th scope="row">
                  <span className="aa-cell-main">{widget.title}</span>
                  {widget.subtitle ? (
                    <span className="aa-cell-sub">{widget.subtitle}</span>
                  ) : null}
                </th>
                <td data-label="Type">{WIDGET_TYPE_LABELS[widget.type]}</td>
                <td data-label="Placement">{WIDGET_PLACEMENT_LABELS[widget.placement]}</td>
                <td data-label="Ends">
                  {widget.ends_at ? formatDateTime(widget.ends_at) : "—"}
                </td>
                <td data-label="Order">{widget.sort_position}</td>
                <td data-label="Status">
                  <StatusBadge
                    tone={!widget.active || ended ? "neutral" : "success"}
                  >
                    {!widget.active ? "Inactive" : ended ? "Ended" : "Active"}
                  </StatusBadge>
                </td>
                <td data-label="Actions" className="aa-cell-actions">
                  <Link
                    className="aa-row-action"
                    href={editHref(widget.id)}
                    aria-label={`Edit widget ${widget.title}`}
                  >
                    Edit
                  </Link>{" "}
                  <form action={toggleWidgetActive} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={widget.id} />
                    <SubmitButton
                      pendingLabel="Working…"
                      className="aa-row-action"
                      ariaLabel={`${widget.active ? "Deactivate" : "Activate"} widget ${widget.title}`}
                    >
                      {widget.active ? "Deactivate" : "Activate"}
                    </SubmitButton>
                  </form>{" "}
                  <ConfirmSubmit
                    action={deleteWidget}
                    fields={{ id: widget.id }}
                    buttonLabel="Delete"
                    ariaLabel={`Delete widget ${widget.title}`}
                    confirmTitle="Delete widget?"
                    confirmBody={`“${widget.title}” will be removed from the storefront and cannot be restored.`}
                    confirmLabel="Delete widget"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
