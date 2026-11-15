import { redirect } from "next/navigation";

/**
 * REMOVED (owner item 13): the Activity log was removed from the admin UI.
 * This route redirects to the dashboard. The file is kept; the underlying
 * admin_audit_logs records are untouched and are still written by the
 * admin RPCs — only this viewing page was removed.
 */
export default function AuditPage() {
  redirect("/admin");
}
