"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  ORDER_TRANSITIONS,
  PAYMENT_STATUS_LABELS,
  type OrderStatus,
} from "@/lib/admin/constants";
import { formatDateTime, formatMoney } from "@/lib/admin/format";
import { StatusBadge } from "@/components/admin/ui";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import { OrderStatusForm } from "./OrderStatusForm";
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
  payment_status: string;
  total_minor: number;
  placed_at: string;
  updated_at: string;
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
}: {
  rows: OrderListRow[];
  exportFilters: { q: string; status: string; payment: string; from: string; to: string; sort: string };
  bulkAction: SalesAction;
  exportAction: OrdersExportAction;
  /** Per-order status-change action (transitionOrder), reused by expanded cards. */
  statusAction: SalesAction;
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
        <button type="button" className="aa-secondary" onClick={runExport} disabled={exportState.busy}>
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
            const label = row.order_number ? `#${row.order_number}` : "Order";
            return (
              <li key={row.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardSelect}>
                    <input
                      type="checkbox"
                      aria-label={`Select order ${row.order_number ?? row.id}`}
                      checked={selected.includes(row.id)}
                      onChange={(event) => toggle(row.id, event.target.checked)}
                    />
                  </span>
                  <Link
                    href={`/admin/sales/orders/${row.id}`}
                    className={styles.cardOrder}
                  >
                    {label}
                  </Link>
                  <span className={styles.cardCustomer}>{row.customer_name}</span>
                  <StatusBadge tone={ORDER_STATUS_TONES[row.status]}>
                    {ORDER_STATUS_LABELS[row.status]}
                  </StatusBadge>
                  <span className={styles.cardTotal}>{formatMoney(row.total_minor)}</span>
                  <button
                    type="button"
                    className={styles.expandButton}
                    aria-expanded={expanded}
                    aria-controls={`order-card-${row.id}`}
                    onClick={() => setExpandedId(expanded ? null : row.id)}
                  >
                    {expanded ? "Hide details" : "Show details"}
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
                        <dd>{PAYMENT_STATUS_LABELS[row.payment_status] ?? row.payment_status}</dd>
                      </div>
                    </dl>
                    <OrderStatusForm
                      orderId={row.id}
                      currentStatus={row.status}
                      expectedUpdatedAt={row.updated_at}
                      action={statusAction}
                      idPrefix={`order-${row.id}`}
                    />
                    <div className={styles.cardActions}>
                      <Link
                        className="aa-row-action"
                        href={`/admin/sales/orders/${row.id}`}
                        aria-label={`View order ${row.order_number ? `#${row.order_number}` : row.id}`}
                      >
                        View order details
                      </Link>
                    </div>
                    <p className={styles.cardNote}>
                      Line items and invoice printing live on the order details
                      page.
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
