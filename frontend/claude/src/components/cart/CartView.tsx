"use client";

import { ArrowLeft, ArrowRight, Lock, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, ButtonLink, EmptyState, CartSkeleton, Modal } from "@/components/ui";
import { commerce } from "@/config";
import { useCart } from "@/context/CartContext";
import { formatPrice } from "@/lib/format";
import { CartItem } from "./CartItem";
import { CouponField } from "./CouponField";
import { OrderSummary } from "./OrderSummary";

export function CartView() {
  const { items, hydrated, getSummary, itemCount, clear } = useCart();
  const [confirmClear, setConfirmClear] = useState(false);
  const summary = getSummary();

  if (!hydrated) return <CartSkeleton/>;

  if (!items.length)
    return (
      <EmptyState
        icon={<ShoppingBag className="h-7 w-7" aria-hidden />}
        title="Your cart is empty"
        description="Looks like you haven't added anything yet. Explore our latest arrivals."
        action={<ButtonLink href="/shop">Start Shopping</ButtonLink>}
      />
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-12 [&>*]:min-w-0">
      <section aria-label="Cart items">
        <div className="flex items-center justify-between border-b border-line pb-3 text-xs text-ink-muted">
          <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
          <button type="button" onClick={() => setConfirmClear(true)} className="underline underline-offset-4 hover:text-primary">
            Clear cart
          </button>
        </div>
        <div className="divide-y divide-line">
          {items.map((item) => (
            <CartItem key={item.id} item={item} />
          ))}
        </div>
        <Link href="/shop" className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Continue shopping
        </Link>
      </section>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <div className="space-y-5 rounded-card border border-line p-5 sm:p-6">
          <CouponField />
          <OrderSummary summary={summary} deliveryNote={`Inside Barishal City shown (${formatPrice(commerce.deliveryCharges.insideBarishalCity)}). Outside Barishal City: ${formatPrice(commerce.deliveryCharges.outsideBarishalCity)} — calculated at checkout.`} />
          <ButtonLink href="/checkout" size="lg" fullWidth rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}>
            Proceed to Checkout
          </ButtonLink>
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-ink-muted">
            <Lock className="h-3 w-3" aria-hidden /> Cash on Delivery available across Bangladesh
          </p>
        </div>
      </aside>
      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear your cart?"
        description="All items will be removed from your cart. This cannot be undone."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Keep items
            </Button>
            <Button
              variant="burgundy"
              onClick={() => {
                clear();
                setConfirmClear(false);
              }}
            >
              Clear cart
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-muted">You can add items back from the shop afterwards.</p>
      </Modal>
    </div>
  );
}
