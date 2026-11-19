import Link from "next/link";
import { hasAnyRole, requireStaff } from "@/lib/admin/authorization";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES, areaRoles } from "@/lib/admin/constants";
import { formatDateTime, formatMoney, formatOrderNumber } from "@/lib/admin/format";
import { readOrderNotices } from "@/lib/admin/orders";
import { resolveDisplayData } from "@/lib/admin/sample-data";
import { SAMPLE_ORDER_NOTICES } from "@/lib/admin/sample-sales";
import {
  deleteTelegramConfig,
  readTelegramStatus,
  saveTelegramConfig,
  sendTelegramTest,
  type TelegramStatus,
} from "@/lib/admin/telegram";
import { Notice, StatusBadge } from "@/components/admin/ui";
import { SampleBadge } from "@/components/admin/SampleBadge";
import { TelegramSettingsForm } from "@/components/admin/sales/TelegramSettingsForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import styles from "@/components/admin/sales/sales-refresh.module.css";

export const metadata = { title: "Notifications" };

function TelegramStatusRow({ status }: { status: TelegramStatus }) {
  if (!status.configured) {
    return (
      <div className={styles.statusRow} role="status">
        <StatusBadge tone="neutral">Not connected</StatusBadge>
        <span className={styles.sectionNote}>
          No bot token or chat ID is saved. Nothing is sent to Telegram.
        </span>
      </div>
    );
  }
  return (
    <div className={styles.statusRow} role="status">
      <StatusBadge tone={status.enabled ? "success" : "warning"}>
        {status.enabled ? "Connected" : "Connected — alerts off"}
      </StatusBadge>
      <span className={styles.statusChip}>Bot token saved (never shown)</span>
      {status.chat_id_masked ? (
        <span className={styles.statusChip}>Chat {status.chat_id_masked}</span>
      ) : null}
      {status.updated_at ? (
        <span className={styles.statusChip}>Updated {formatDateTime(status.updated_at)}</span>
      ) : null}
    </div>
  );
}

export default async function NotificationsPage() {
  const session = await requireStaff();
  const canManageTelegram = hasAnyRole(session, areaRoles("settings"));
  // Independent reads: run them together. The Telegram status is only
  // requested for staff who may manage it; everyone else gets no status.
  const [noticesResult, telegramStatus] = await Promise.all([
    readOrderNotices(),
    canManageTelegram ? readTelegramStatus() : Promise.resolve(undefined),
  ]);
  // Undefined (staff who cannot manage Telegram) collapses to null here;
  // the settings branch below is guarded by canManageTelegram first, so
  // null inside that branch always means "status unavailable".
  const telegram = telegramStatus ?? null;
  // Null means unavailable: show labeled sample notices. A live empty
  // list stays an honest empty state.
  const { items: notices, isSample } = resolveDisplayData(
    noticesResult,
    SAMPLE_ORDER_NOTICES,
  );

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Notifications"
          description="New orders, newest first. Telegram alerts are configured below so new orders are not missed."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            System
          </p>
        </PageHeader>

        {isSample ? (
          <div className={styles.sampleBanner} role="status">
            <SampleBadge />
            <span>
              Live order data is unavailable — recent orders could not be read.
              These sample notices are for testing the layout only.
            </span>
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Recent orders</CardTitle>
            <CardDescription>
              The 20 most recent orders. Open an order to see its details and change its status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {notices.length === 0 ? (
              <p className="text-sm leading-6 text-admin-text">
                No orders yet. New orders placed through checkout appear here.
              </p>
            ) : (
              <ul className={styles.noticeList}>
                {notices.map((notice) => {
                  const label = notice.order_number
                    ? `Order ${formatOrderNumber(notice.order_number)}`
                    : "Order";
                  return (
                    <li key={notice.id} className={styles.noticeItem}>
                      <span className={styles.noticeTitle}>{label}</span>
                      <span>{notice.customer_name}</span>
                      <StatusBadge tone={ORDER_STATUS_TONES[notice.status]}>
                        {ORDER_STATUS_LABELS[notice.status]}
                      </StatusBadge>
                      <span className={styles.money}>{formatMoney(notice.total_minor)}</span>
                      <span className={styles.noticeMeta}>
                        {formatDateTime(notice.placed_at)}
                      </span>
                      {isSample ? null : (
                        <Link
                          className={styles.noticeLink}
                          href={`/admin/sales/orders/${notice.id}`}
                          aria-label={`View ${label} for ${notice.customer_name}`}
                        >
                          View order
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Where else to look</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
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
            <p className="mt-4 text-sm leading-6 text-admin-text-secondary">
              No email or SMS is sent from this panel. Telegram is the only
              external notification channel, configured below.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Telegram alerts</CardTitle>
            <CardDescription>
              Connect a Telegram bot so a test message can confirm delivery to your chat. The bot token is stored as a secret and is never shown again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!canManageTelegram ? (
              <Notice kind="info">
                Telegram settings are managed by the store owner. Ask the owner to
                connect Telegram if alerts are needed.
              </Notice>
            ) : telegram === null ? (
              <>
                <Notice kind="warning">
                  Telegram settings could not be loaded. The database setup for
                  Telegram may not be applied yet. Saving or testing will fail
                  until it is.
                </Notice>
                <TelegramSettingsForm
                  status={null}
                  saveAction={saveTelegramConfig}
                  testAction={sendTelegramTest}
                  deleteAction={deleteTelegramConfig}
                />
              </>
            ) : (
              <>
                <TelegramStatusRow status={telegram} />
                <TelegramSettingsForm
                  status={telegram}
                  saveAction={saveTelegramConfig}
                  testAction={sendTelegramTest}
                  deleteAction={deleteTelegramConfig}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
