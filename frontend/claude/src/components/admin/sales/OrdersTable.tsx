"use client";

import Link from "next/link";
import { ChevronDown, Download } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import {
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  PAYMENT_STATUS_LABELS,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/admin/constants";
import {
  formatDateTime,
  formatMoney,
  formatOrderNumber,
  paymentProviderLabel,
  paymentSubmissionStatusLabel,
  shortTransactionId,
} from "@/lib/admin/format";
import type { ShipmentSummary } from "@/lib/admin/courier";
import { ProductThumbnail } from "@/components/admin/access/ProductThumbnail";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import { CourierBookingPanel } from "./CourierBookingPanel";
import { OrderStatusForm } from "./OrderStatusForm";
import { PaymentStatusForm } from "./PaymentStatusForm";
import styles from "./order-cards.module.css";
import {
  downloadCsv,
  type CsvExportResult,
  type OrdersExportAction,
  type SalesAction,
} from "./types";

export interface OrderListRow {
  id: string;
  order_number: number | null;
  customer_name: string;
  phone: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  total_minor: number;
  placed_at: string;
  updated_at: string;
  /** Latest advance-payment submission, when one was recorded. */
  payment?: {
    provider: string;
    transaction_id: string;
    status: string;
  } | null;
  /** First ordered item's cover photo (desktop only; mobile cards stay text-only). */
  coverUrl?: string | null;
  coverAlt?: string;
}

function commonTransitions(statuses: readonly OrderStatus[]): OrderStatus[] {
  if (statuses.length === 0) return [];
  const first = ORDER_TRANSITIONS[statuses[0] as OrderStatus];
  return first.filter((candidate) =>
    statuses.every((status) => ORDER_TRANSITIONS[status].includes(candidate)),
  );
}

function stockNote(status: OrderStatus): string | null {
  if (status === "delivered") {
    return "Delivered sets available stock to zero for every item in each selected order.";
  }
  if (status === "cancelled" || status === "returned") {
    return "This restores the ordered quantities to stock for each selected order.";
  }
  return null;
}

export function OrdersTable({
  rows,
  exportFilters,
  bulkAction,
  exportAction,
  statusAction,
  paymentAction,
  courierAction,
  shipments,
  shipmentsUnavailable,
  courierConfigured,
}: {
  rows: OrderListRow[];
  exportFilters: { q: string; status: string; payment: string; verify?: string; from: string; to: string; sort: string };
  bulkAction: SalesAction;
  exportAction: OrdersExportAction;
  /** Per-order status-change action (transitionOrder), reused by expanded cards. */
  statusAction: SalesAction;
  /** Per-order payment-status action (setPaymentStatus), reused by expanded cards. */
  paymentAction: SalesAction;
  /** One-tap courier booking action (sendOrderToCourier), shared with the detail page. */
  courierAction: SalesAction;
  /** Booked shipments by order id, for the expanded cards. */
  shipments: Record<string, ShipmentSummary>;
  /** True when the shipment read failed: cards show an honest notice instead of booking blind. */
  shipmentsUnavailable: boolean;
  /** True when the Steadfast API keys are configured server-side. */
  courierConfigured: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [target, setTarget] = useState<OrderStatus | "">("");
  const [exportState, setExportState] = useState<{
    busy: boolean;
    message: { text: string; kind: "info" | "error" } | null;
  }>({
    busy: false,
    message: null,
  });
  const [bulkState, bulkFormAction] = useActionState(bulkAction, null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seenBulkState, setSeenBulkState] = useState(bulkState);

  // A successful bulk change makes the loaded versions stale; clear the
  // selection when a new successful result arrives, so the next action
  // starts from freshly loaded rows. (State adjusted during render, per
  // the React pattern for responding to a changed action result.)
  if (bulkState !== seenBulkState) {
    setSeenBulkState(bulkState);
    if (bulkState?.ok) setSelected([]);
  }

  const selectedRows = rows.filter((row) => selected.includes(row.id));
  const common = commonTransitions(selectedRows.map((row) => row.status));
  const effectiveTarget: OrderStatus | "" = target !== "" && common.includes(target) ? target : (common[0] ?? "");

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((item) => item !== id)));
  };
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? rows.map((row) => row.id) : []);
  };

  const runExport = async () => {
    setExportState({ busy: true, message: null });
    let result: CsvExportResult;
    try {
      result = await exportAction(exportFilters);
    } catch {
      setExportState({ busy: false, message: { text: "Export failed. Try again.", kind: "error" } });
      return;
    }
    if (!result.ok) {
      setExportState({ busy: false, message: { text: result.error, kind: "error" } });
      return;
    }
    downloadCsv(result.csv, result.filename);
    setExportState({
      busy: false,
      message: {
        text: result.truncated
          ? `Exported ${result.total} matching orders (list truncated to 1,000 rows — narrow the filters for a complete export).`
          : `Exported ${result.total} order${result.total === 1 ? "" : "s"}.`,
        kind: "info",
      },
    });
  };

  return (
    <div>
      <div className="aa-toolbar" role="group" aria-label="Order actions">
        <button type="button" className="aa-secondary gap-2" onClick={runExport} disabled={exportState.busy}>
          <Download size={16} strokeWidth={1.6} aria-hidden="true" />
          {exportState.busy ? "Exporting…" : "Export CSV"}
        </button>
        <label className={styles.selectAll}>
          <input
            type="checkbox"
            aria-label="Select all orders on this page"
            checked={rows.length > 0 && selected.length === rows.length}
            onChange={(event) => toggleAll(event.target.checked)}
          />
          Select all
        </label>
        {selected.length > 0 ? (
          <span role="status">
            {selected.length} selected
            {common.length === 0
              ? " — no status change is legal for all of them"
              : ""}
          </span>
        ) : null}
        {selected.length > 0 && common.length > 0 ? (
          <>
            <label className="aa-field">
              <span>Change selected to</span>
              <select
                value={effectiveTarget}
                onChange={(event) => setTarget(event.target.value as OrderStatus)}
                aria-label="Status for selected orders"
              >
                {common.map((status) => (
                  <option key={status} value={status}>
                    {ORDER_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="aa-button"
              disabled={effectiveTarget === ""}
              onClick={() => {
                setDialogOpen(true);
                dialog.current?.showModal();
              }}
            >
              Update {selected.length} order{selected.length === 1 ? "" : "s"}
            </button>
          </>
        ) : null}
      </div>
      {exportState.message ? (
        <p
          role={exportState.message.kind === "error" ? "alert" : "status"}
          className={`aa-notice aa-notice--${exportState.message.kind === "error" ? "error" : "info"}`}
        >
          {exportState.message.text}
        </p>
      ) : null}
      {bulkState && !dialogOpen ? <FormMessage state={bulkState} /> : null}

      {rows.length === 0 ? (
        <p className="aa-panel">No orders match these filters.</p>
      ) : (
        <ul className={styles.cards}>
          {rows.map((row) => {
            const expanded = expandedId === row.id;
            const label = formatOrderNumber(row.order_number);
            return (
              <li
                key={row.id}
                className={
                  selected.includes(row.id)
                    ? `${styles.card} ${styles.cardSelected}`
                    : styles.card
                }
              >
                <div className={styles.cardHeader}>
                  <span className={styles.cardSelect}>
                    <input
                      type="checkbox"
                      aria-label={`Select order ${row.order_number ? formatOrderNumber(row.order_number) : row.id}`}
                      checked={selected.includes(row.id)}
                      onChange={(event) => toggle(row.id, event.target.checked)}
                    />
                  </span>
                  <span className={styles.cardOrderBlock}>
                    {row.coverUrl ? (
                      <span className={styles.cardThumb}>
                        <ProductThumbnail
                          url={row.coverUrl}
                          alt={row.coverAlt ?? "Ordered product"}
                        />
                      </span>
                    ) : null}
                    <span className={styles.cardOrderText}>
                      <Link
                        href={`/admin/sales/orders/${row.id}`}
                        className={styles.cardOrder}
                      >
                        {label}
                      </Link>
                      <span className={styles.cardSub}>{formatDateTime(row.placed_at)}</span>
                    </span>
                  </span>
                  <span className={styles.cardCustomerBlock}>
                    <span className={styles.cardCustomer}>{row.customer_name}</span>
                    <span className={styles.cardSub}>{row.phone}</span>
                  </span>
                  <StatusBadge status={row.status} className={styles.cardBadge} />
                  <span className={styles.cardTotal}>{formatMoney(row.total_minor)}</span>
                  <button
                    type="button"
                    className={`${styles.expandButton} aa-secondary`}
                    aria-expanded={expanded}
                    aria-controls={`order-card-${row.id}`}
                    onClick={() => setExpandedId(expanded ? null : row.id)}
                  >
                    {expanded ? "Hide details" : "Show details"}
                    <ChevronDown
                      size={16}
                      strokeWidth={2}
                      aria-hidden="true"
                      className={styles.chevron}
                    />
                  </button>
                </div>
                {expanded ? (
                  <div className={styles.cardBody} id={`order-card-${row.id}`}>
                    <dl className={styles.cardFacts}>
                      <div>
                        <dt>Phone</dt>
                        <dd>{row.phone}</dd>
                      </div>
                      <div>
                        <dt>Placed</dt>
                        <dd>{formatDateTime(row.placed_at)}</dd>
                      </div>
                      <div>
                        <dt>Payment</dt>
                        <dd>
                          {PAYMENT_STATUS_LABELS[row.payment_status] ?? row.payment_status}
                          {row.payment ? (
                            <span className={styles.paymentSubmission}>
                              <span
                                className={styles.paymentTxid}
                                title={`${paymentProviderLabel(row.payment.provider)} TxID ${row.payment.transaction_id}`}
                              >
                                {paymentProviderLabel(row.payment.provider)} ·{" "}
                                {shortTransactionId(row.payment.transaction_id)}
                              </span>
                              {row.payment_status === "unpaid" &&
                              row.payment.status === "submitted" ? (
                                <Badge tone="warning">Needs verification</Badge>
                              ) : (
                                <Badge
                                  tone={
                                    row.payment.status === "verified"
                                      ? "success"
                                      : "neutral"
                                  }
                                >
                                  {paymentSubmissionStatusLabel(row.payment.status)}
                                </Badge>
                              )}
                            </span>
                          ) : null}
                        </dd>
                      </div>
                    </dl>
                    <div className={styles.inlineForms}>
                      <section aria-label={`Change status for order ${label}`}>
                        <h3 className={styles.inlineFormTitle}>Order status</h3>
                        <OrderStatusForm
                          orderId={row.id}
                          currentStatus={row.status}
                          expectedUpdatedAt={row.updated_at}
                          action={statusAction}
                          idPrefix={`order-${row.id}`}
                        />
                      </section>
                      <section aria-label={`Change payment status for order ${label}`}>
                        <h3 className={styles.inlineFormTitle}>Payment status</h3>
                        <PaymentStatusForm
                          orderId={row.id}
                          currentPaymentStatus={row.payment_status}
                          expectedUpdatedAt={row.updated_at}
                          action={paymentAction}
                          idPrefix={`payment-${row.id}`}
                        />
                      </section>
                      <section
                        className={styles.courierSection}
                        aria-label={`Courier booking for order ${label}`}
                      >
                        <h3 className={styles.inlineFormTitle}>Courier</h3>
                        <CourierBookingPanel
                          orderId={row.id}
                          orderLabel={label}
                          orderStatus={row.status}
                          recipientName={row.customer_name}
                          recipientPhone={row.phone}
                          codMinor={row.total_minor}
                          shipment={shipments[row.id] ?? null}
                          shipmentUnavailable={shipmentsUnavailable}
                          configured={courierConfigured}
                          action={courierAction}
                        />
                      </section>
                    </div>
                    <div className={styles.cardActions}>
                      <Link
                        className="aa-row-action"
                        href={`/admin/sales/orders/${row.id}`}
                        aria-label={`View order ${row.order_number ? formatOrderNumber(row.order_number) : row.id}`}
                      >
                        View order details
                      </Link>
                    </div>
                    <p className={styles.cardNote}>
                      Line items, invoice printing and previous orders live
                      on the order details page.
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <dialog
        ref={dialog}
        className="aa-dialog"
        onClose={() => setDialogOpen(false)}
        aria-label="Confirm bulk status change"
      >
        {dialogOpen && effectiveTarget !== "" ? (
          <form action={bulkFormAction} method="post">
            <h2>Change {selectedRows.length} order{selectedRows.length === 1 ? "" : "s"}?</h2>
            <p>
              Every selected order will move to {ORDER_STATUS_LABELS[effectiveTarget]}. Orders
              that changed since this page loaded, or cannot legally make this move, stop the
              whole update and nothing is changed.
            </p>
            {stockNote(effectiveTarget) ? <p>{stockNote(effectiveTarget)}</p> : null}
            {selectedRows.map((row) => (
              <span key={row.id}>
                <input type="hidden" name="orderId" value={row.id} />
                <input type="hidden" name="expected" value={row.updated_at} />
              </span>
            ))}
            <input type="hidden" name="new_status" value={effectiveTarget} />
            <FormMessage state={bulkState} />
            <div className="aa-dialog-actions">
              <button
                type="button"
                className="aa-secondary"
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
              <SubmitButton pendingLabel="Updating…">Confirm change</SubmitButton>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
