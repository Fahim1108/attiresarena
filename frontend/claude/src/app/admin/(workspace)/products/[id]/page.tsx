import { redirect } from "next/navigation";

/**
 * REMOVED (owner item 13): the intake product record / workspace page was
 * removed from the admin UI. This route redirects to the dashboard. The
 * file is kept, and no intake code or components were deleted; catalogue
 * product records live at /admin/catalog/products/[id].
 */
export default function ProductRecord() {
  redirect("/admin");
}
