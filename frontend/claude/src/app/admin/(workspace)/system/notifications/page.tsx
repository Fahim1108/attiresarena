import Link from "next/link";
import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import { requireStaff } from "@/lib/admin/authorization";

export default async function NotificationsPage() {
  await requireStaff();

  return (
    <main id="main" tabIndex={-1} className="aa-main">
      <PageHeading
        eyebrow="System"
        title="Notifications"
        description="Order and customer events, as they are available today."
      />
      <Notice kind="warning">
        No notification system is connected. Order and customer events are
        visible in their modules; no email or SMS is sent from this panel.
      </Notice>
      <Panel title="Where to look instead">
        <ul>
          <li>
            <Link href="/admin/sales/orders">Orders</Link> — new and changing
            orders, by status.
          </li>
          <li>
            <Link href="/admin/sales/incomplete">Incomplete orders</Link> —
            abandoned checkouts awaiting recovery.
          </li>
          <li>
            <Link href="/admin/sales/customers">Customers</Link> — customer
            activity and order history.
          </li>
        </ul>
        <p className="aa-muted">
          The links above point at the sales and customer modules built by
          the rest of this panel.
        </p>
      </Panel>
    </main>
  );
}
