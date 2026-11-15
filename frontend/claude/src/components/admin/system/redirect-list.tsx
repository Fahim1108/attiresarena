import Link from "next/link";
import { ConfirmSubmit } from "@/components/admin/ui-client";
import { EmptyState, StatusBadge } from "@/components/admin/ui";
import {
  deleteRedirect,
  toggleRedirectActive,
} from "@/lib/admin/redirects";
import type { Redirect } from "@/lib/admin/reference-adapt";

export function RedirectList({
  redirects,
  emptyTitle,
  emptyDescription,
  editHref,
}: {
  redirects: Redirect[];
  emptyTitle: string;
  emptyDescription: string;
  editHref: (id: string) => string;
}) {
  if (redirects.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="aa-table-scroll">
      <table className="aa-table">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Target</th>
            <th scope="col">Code</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {redirects.map((redirect) => (
            <tr key={redirect.id}>
              <th scope="row">
                <span className="aa-cell-main">{redirect.source_path}</span>
              </th>
              <td>{redirect.target_path}</td>
              <td>{redirect.code}</td>
              <td>
                <StatusBadge tone={redirect.active ? "success" : "neutral"}>
                  {redirect.active ? "Active" : "Disabled"}
                </StatusBadge>
              </td>
              <td className="aa-cell-actions">
                <Link
                  className="aa-row-action"
                  href={editHref(redirect.id)}
                  aria-label={`Edit redirect ${redirect.source_path}`}
                >
                  Edit
                </Link>{" "}
                <form action={toggleRedirectActive} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={redirect.id} />
                  <button
                    type="submit"
                    className="aa-row-action"
                    aria-label={`${redirect.active ? "Disable" : "Enable"} redirect ${redirect.source_path}`}
                  >
                    {redirect.active ? "Disable" : "Enable"}
                  </button>
                </form>{" "}
                <ConfirmSubmit
                  action={deleteRedirect}
                  fields={{ id: redirect.id }}
                  buttonLabel="Delete"
                  ariaLabel={`Delete redirect ${redirect.source_path}`}
                  confirmTitle="Delete redirect?"
                  confirmBody={`“${redirect.source_path}” will be removed and cannot be restored.`}
                  confirmLabel="Delete redirect"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
