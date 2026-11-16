"use client";

import { useActionState, useRef, useState } from "react";
import { ORDER_STATUS_LABELS, canBookCourier, type OrderStatus } from "@/lib/admin/constants";
import { formatDateTime, formatMoney } from "@/lib/admin/format";
import type { ShipmentSummary } from "@/lib/admin/courier";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { SalesAction } from "./types";
import styles from "./courier-panel.module.css";

/**
 * One shared courier panel for the order detail page AND the All Orders
 * expanded card: same component, same server action. Explicit variants
 * (no boolean-mode props): booked / not configured / unavailable /
 * blocked / ready-to-book.
 */

function CourierBooked({ shipment }: { shipment: ShipmentSummary }) {
  return (
    <div>
      <p role="status" className="aa-notice aa-notice--success">
        Sent to Steadfast. This order cannot be booked again.
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>Tracking code</dt>
          <dd className={styles.tracking}>{shipment.tracking_code}</dd>
        </div>
        <div>
          <dt>Consignment ID</dt>
          <dd>{shipment.consignment_id}</dd>
        </div>
        <div>
          <dt>Invoice</dt>
          <dd>{shipment.invoice}</dd>
        </div>
        {shipment.provider_status ? (
          <div>
            <dt>Steadfast status at booking</dt>
            <dd>{shipment.provider_status}</dd>
          </div>
        ) : null}
        <div>
          <dt>Booked</dt>
          <dd>{formatDateTime(shipment.booked_at)}</dd>
        </div>
      </dl>
      <p className={styles.note}>
        Steadfast has no cancel button here — a booked parcel is cancelled
        from the Steadfast portal or through a return request.
      </p>
    </div>
  );
}

function CourierNotConfigured() {
  return (
    <p role="status" className="aa-notice aa-notice--info">
      Steadfast is not configured. Ask the owner to add the Steadfast API
      keys to the server settings — until then, no parcel can be booked
      from this panel.
    </p>
  );
}

function CourierUnavailable() {
  return (
    <p role="status" className="aa-notice aa-notice--warning">
      Courier booking status could not be loaded. The database setup for
      courier bookings may not be applied yet. Booking is unavailable
      until it loads, so a parcel is never booked blind.
    </p>
  );
}

function CourierBlocked({ status }: { status: OrderStatus }) {
  const reason =
    status === "pending"
      ? "Verify the order first — pending orders are not sent to the courier."
      : status === "cancelled" || status === "returned"
        ? "Cancelled and returned orders are never sent to the courier."
        : "This order already left for delivery, so it cannot be booked again.";
  return (
    <p role="status" className="aa-notice aa-notice--info">
      This order is {ORDER_STATUS_LABELS[status]}. Only Confirmed and
      Packed orders can be sent to the courier. {reason}
    </p>
  );
}

function CourierBookForm({
  orderId,
  orderLabel,
  recipientName,
  recipientPhone,
  codMinor,
  action,
}: {
  orderId: string;
  orderLabel: string;
  recipientName: string;
  recipientPhone: string;
  codMinor: number;
  action: SalesAction;
}) {
  const [state, formAction] = useActionState(action, null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div>
      <FormMessage state={dialogOpen ? null : state} />
      <p className={styles.note}>
        Books one parcel with Steadfast using the name, phone, address and
        total saved on this order. Cash on delivery:{" "}
        <strong>{formatMoney(codMinor)}</strong> to {recipientName} (
        {recipientPhone}).
      </p>
      <p className={styles.warning}>
        This creates a real parcel — Steadfast has no test mode. If the
        booking fails, check the Steadfast portal before trying again, so
        a second parcel is not created.
      </p>
      <div className="aa-form-actions">
        <button
          type="button"
          className="aa-button"
          onClick={() => {
            setDialogOpen(true);
            dialog.current?.showModal();
          }}
        >
          Send to courier
        </button>
      </div>

      <dialog
        ref={dialog}
        className="aa-dialog"
        onClose={() => setDialogOpen(false)}
        aria-label="Confirm courier booking"
      >
        {dialogOpen ? (
          <form action={formAction} method="post">
            <h2>Send order {orderLabel} to Steadfast?</h2>
            <p>
              One parcel will be booked for {recipientName} ({recipientPhone}
              ), cash on delivery {formatMoney(codMinor)}, using the
              delivery address saved on this order.
            </p>
            <p>
              This is a real booking and cannot be undone from this panel.
              If anything fails, check the Steadfast portal before trying
              again.
            </p>
            <input type="hidden" name="id" value={orderId} />
            <FormMessage state={state} />
            <div className="aa-dialog-actions">
              <button
                type="button"
                className="aa-secondary"
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
              <SubmitButton pendingLabel="Booking…">Book parcel</SubmitButton>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}

export function CourierBookingPanel({
  orderId,
  orderLabel,
  orderStatus,
  recipientName,
  recipientPhone,
  codMinor,
  shipment,
  shipmentUnavailable,
  configured,
  action,
}: {
  orderId: string;
  orderLabel: string;
  orderStatus: OrderStatus;
  recipientName: string;
  recipientPhone: string;
  codMinor: number;
  shipment: ShipmentSummary | null;
  shipmentUnavailable: boolean;
  configured: boolean;
  action: SalesAction;
}) {
  if (shipment) return <CourierBooked shipment={shipment} />;
  if (shipmentUnavailable) return <CourierUnavailable />;
  if (!configured) return <CourierNotConfigured />;
  if (!canBookCourier(orderStatus)) return <CourierBlocked status={orderStatus} />;
  return (
    <CourierBookForm
      orderId={orderId}
      orderLabel={orderLabel}
      recipientName={recipientName}
      recipientPhone={recipientPhone}
      codMinor={codMinor}
      action={action}
    />
  );
}
