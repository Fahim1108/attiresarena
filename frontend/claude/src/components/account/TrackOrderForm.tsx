"use client";

import { PackageSearch } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { isValidBdPhone } from "@/lib/validation";
import { getOrderByNumberAction } from "@/services/actions";
import type { Order } from "@/types";
import { OrderStatusBadge } from "./OrderStatusBadge";
import { OrderTimeline } from "./OrderTimeline";

export function TrackOrderForm() {
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [orderError, setOrderError] = useState<string>();
  const [phoneError, setPhoneError] = useState<string>();
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [pending, start] = useTransition();
  const focusFirstError = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());
  return (
    <div className="space-y-6">
      <form
        noValidate
        className="grid gap-4 rounded-card border border-line p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          if (!orderNumber.trim()) {
            setOrderError("Enter your order number");
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
          setOrder(undefined);
          start(async () => {
            try { setOrder(await getOrderByNumberAction(orderNumber, phone)); }
            catch {
              setOrderError("Tracking is unavailable. Please try again.");
              focusFirstError("track-orderNumber");
            }
          });
        }}
      >
        <Input id="track-orderNumber" name="order-number" label="Order Number" autoComplete="off" spellCheck={false} placeholder="AA-10004" value={orderNumber} onChange={(e) => { setOrderNumber(e.target.value); setOrderError(undefined); }} error={orderError} />
        <Input id="track-phone" name="tel" label="Phone Number" type="tel" autoComplete="tel" placeholder="01XXXXXXXXX" value={phone} onChange={(e) => { setPhone(e.target.value); setPhoneError(undefined); }} error={phoneError} required />
        <Button type="submit" size="lg" loading={pending}>
          Track
        </Button>
      </form>
      {order === null && <EmptyState icon={<PackageSearch className="h-7 w-7" />} title="Order not found" description="Check the order number and phone number from your confirmation SMS and try again." />}
      {order && (
        <section className="rounded-card border border-line p-5 sm:p-6" aria-live="polite">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <h2 className="break-words font-serif text-2xl text-ink">{order.orderNumber}</h2>
            <OrderStatusBadge status={order.status} />
          </div>
          <OrderTimeline events={order.timeline} status={order.status} />
        </section>
      )}
    </div>
  );
}
