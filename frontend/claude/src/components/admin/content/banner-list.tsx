import Link from "next/link";
import { ConfirmSubmit } from "@/components/admin/ui-client";
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
              <td>{banner.placement === "hero" ? "Hero" : "Promotional"}</td>
              <td>{banner.link_url ?? "—"}</td>
              <td>{formatDateTime(banner.created_at)}</td>
              <td>
                <StatusBadge tone={banner.visible ? "success" : "neutral"}>
                  {banner.visible ? "Visible" : "Hidden"}
                </StatusBadge>
              </td>
              <td className="aa-cell-actions">
                <Link className="aa-row-action" href={editHref(banner.id)} aria-label={`Edit banner ${banner.title}`}>
                  Edit
                </Link>{" "}
                <form action={toggleBannerVisibility} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={banner.id} />
                  <button type="submit" className="aa-row-action" aria-label={`${banner.visible ? "Hide" : "Show"} banner ${banner.title}`}>
                    {banner.visible ? "Hide" : "Show"}
                  </button>
                </form>{" "}
                <form action={moveBanner} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={banner.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button
                    type="submit"
                    className="aa-row-action"
                    disabled={index === 0}
                    aria-label={`Move ${banner.title} up`}
                  >
                    ↑ Up
                  </button>
                </form>{" "}
                <form action={moveBanner} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={banner.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button
                    type="submit"
                    className="aa-row-action"
                    disabled={index === banners.length - 1}
                    aria-label={`Move ${banner.title} down`}
                  >
                    ↓ Down
                  </button>
                </form>{" "}
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
