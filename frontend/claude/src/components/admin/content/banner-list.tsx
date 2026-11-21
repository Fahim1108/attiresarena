import Link from "next/link";
import { ConfirmSubmit, RowActionForm } from "@/components/admin/ui-client";
import { EmptyState, StatusBadge } from "@/components/admin/ui";
import {
  deleteBanner,
  moveBanner,
  toggleBannerVisibility,
  type Banner,
} from "@/lib/admin/content";
import { formatDateTime } from "@/lib/admin/format";

export function BannerList({
  banners,
  emptyTitle,
  emptyDescription,
  editHref,
}: {
  banners: Banner[];
  emptyTitle: string;
  emptyDescription: string;
  editHref: (id: string) => string;
}) {
  if (banners.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="aa-table-scroll">
      <table className="aa-table">
        <thead>
          <tr>
            <th scope="col">Banner</th>
            <th scope="col">Placement</th>
            <th scope="col">Link</th>
            <th scope="col">Updated</th>
            <th scope="col">Visibility</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {banners.map((banner, index) => (
            <tr key={banner.id}>
              <th scope="row">
                <span className="aa-cell-main">{banner.title}</span>
                {banner.subtitle ? (
                  <span className="aa-cell-sub">{banner.subtitle}</span>
                ) : null}
              </th>
              <td data-label="Placement">{banner.placement === "hero" ? "Hero" : "Promotional"}</td>
              <td data-label="Link">{banner.link_url ?? "—"}</td>
              <td data-label="Updated">{formatDateTime(banner.created_at)}</td>
              <td data-label="Visibility">
                <StatusBadge tone={banner.visible ? "success" : "neutral"}>
                  {banner.visible ? "Visible" : "Hidden"}
                </StatusBadge>
              </td>
              <td data-label="Actions" className="aa-cell-actions">
                <Link className="aa-row-action" href={editHref(banner.id)} aria-label={`Edit banner ${banner.title}`}>
                  Edit
                </Link>{" "}
                <RowActionForm
                  action={toggleBannerVisibility}
                  fields={{ id: banner.id }}
                  buttonLabel={banner.visible ? "Hide" : "Show"}
                  ariaLabel={`${banner.visible ? "Hide" : "Show"} banner ${banner.title}`}
                />{" "}
                <RowActionForm
                  action={moveBanner}
                  fields={{ id: banner.id, direction: "up" }}
                  buttonLabel="↑ Up"
                  ariaLabel={`Move ${banner.title} up`}
                  disabled={index === 0}
                />{" "}
                <RowActionForm
                  action={moveBanner}
                  fields={{ id: banner.id, direction: "down" }}
                  buttonLabel="↓ Down"
                  ariaLabel={`Move ${banner.title} down`}
                  disabled={index === banners.length - 1}
                />{" "}
                <ConfirmSubmit
                  action={deleteBanner}
                  fields={{ id: banner.id, image_storage_path: banner.image_storage_path }}
                  buttonLabel="Delete"
                  ariaLabel={`Delete banner ${banner.title}`}
                  confirmTitle="Delete banner?"
                  confirmBody={`“${banner.title}” will be removed. Its image file is also removed when possible.`}
                  confirmLabel="Delete banner"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
