import { redirect } from "next/navigation";

/**
 * REMOVED (owner item 13): the intake "Add product draft" page was removed
 * from the admin UI. This route redirects to the dashboard. The file is
 * kept, and no intake code or components were deleted; new catalogue
 * products are created at /admin/catalog/products/new.
 */
export default function NewProduct() {
  redirect("/admin");
}
