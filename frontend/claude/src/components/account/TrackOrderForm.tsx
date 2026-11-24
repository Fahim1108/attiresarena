"use client";

import { PackageSearch } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { parseCustomerOrderNumber } from "@/lib/customer/orders";
import { isValidBdPhone } from "@/lib/validation";
import { getOrderByNumberAction, getOrdersByPhoneAction } from "@/services/actions";
import type { Order } from "@/types";
import { OrderDetail } from "./OrderDetail";

/**
 * Guest track-order form. The phone is the lookup key and is always
 * required; the order number is optional — blank means "list every
 * order placed with this phone, newest first", a number means "show
 * that one order".
 *
 * LAYOUT: the three grid columns share one top baseline
 * (sm:items-start). Both fields always occupy their message line
 * (a hint, an error, or a reserved blank line), and the Track button
 * sits in a wrapper with a label-height spacer and the same h-11
 * height as the inputs — so typing a value or showing an error can
 * never push one column below the other (the bug in the 2026-11-24
 * screenshot, where the error under the left field dropped the right
 * field's baseline).
 */
export function TrackOrderForm() {
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [orderError, setOrderError] = useState<string>();
  const [phoneError, setPhoneError] = useState<string>();
  const [found, setFound] = useState<Order[] | undefined>(undefined);
  const [mode, setMode] = useState<"single" | "list">("list");
  const [pending, start] = useTransition();
  const focusFirstError = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());
  return (
    <div className="space-y-6">
      <form
        noValidate
        className="grid gap-4 rounded-card border border-line p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-start sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          const trimmedNumber = orderNumber.trim();
          if (trimmedNumber && parseCustomerOrderNumber(trimmedNumber) === null) {
            setOrderError("Enter a valid order number, e.g. AA-10004");
            return focusFirstError("track-orderNumber");
          }
          if (!phone.trim()) {
            setPhoneError("Enter the phone number from your order");
            return focusFirstError("track-phone");
          }
          if (!isValidBdPhone(phone)) {
            setPhoneError("Enter a valid phone number, e.g. 01XXXXXXXXX");
            return focusFirstError("track-phone");
          }
          setOrderError(undefined);
          setPhoneError(undefined);
          setFound(undefined);
          setMode(trimmedNumber ? "single" : "list");
          start(async () => {
            try {
              if (trimmedNumber) {
                const order = await getOrderByNumberAction(orderNumber, phone);
                setFound(order ? [order] : []);
              } else {
                setFound(await getOrdersByPhoneAction(phone));
              }
            } catch {
              setOrderError("Tracking is unavailable. Please try again.");
              focusFirstError("track-orderNumber");
            }
          });
        }}
      >
        <Input
          id="track-orderNumber"
          name="order-number"
          label="Order Number (optional)"
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. AA-10004"
          hint="Leave blank to see all your orders."
          reserveMessageSpace
          value={orderNumber}
          onChange={(e) => { setOrderNumber(e.target.value); setOrderError(undefined); }}
          error={orderError}
        />
        <Input
          id="track-phone"
          name="tel"
          label="Phone Number"
          type="tel"
          autoComplete="tel"
          placeholder="01XXXXXXXXX"
          hint="The number you ordered with."
          reserveMessageSpace
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setPhoneError(undefined); }}
          error={phoneError}
          required
        />
        <div className="space-y-1.5">
          <span aria-hidden="true" className="block text-xs font-medium text-ink">
            &nbsp;
          </span>
          <Button type="submit" size="md" loading={pending}>
            Track
          </Button>
        </div>
      </form>
      {found !== undefined && found.length === 0 && (
        <EmptyState
          icon={<PackageSearch className="h-7 w-7" />}
          title={mode === "list" ? "No orders found" : "Order not found"}
          description={
            mode === "list"
              ? "We couldn't find any orders for this phone number. Check the number from your confirmation SMS and try again."
              : "Check the order number and phone number from your confirmation SMS and try again."
          }
        />
      )}
      {found !== undefined && found.length > 0 && (
        <div className="space-y-6" aria-live="polite">
          {mode === "list" && (
            <p className="text-sm text-ink-muted">
              {found.length} {found.length === 1 ? "order" : "orders"} found for this phone number, newest first.
            </p>
          )}
          {found.map((order) => (
            <section key={order.id} className="rounded-card border border-line p-5 sm:p-6">
              <OrderDetail order={order} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
