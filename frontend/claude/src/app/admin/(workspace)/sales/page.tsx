import { redirect } from "next/navigation";

export default function SalesIndex() {
  redirect("/admin/sales/orders");
}
