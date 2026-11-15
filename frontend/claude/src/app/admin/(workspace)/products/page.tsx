import { redirect } from "next/navigation";

/**
 * REMOVED (owner item 13): Garments intake ("Product drafts") was removed
 * from the admin UI. This route redirects to the dashboard. The file is
 * kept, and no intake code or components were deleted; the catalogue tools
 * live at /admin/catalog/*.
 */
export default function ProductsPage() {
  redirect("/admin");
}
