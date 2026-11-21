"use client";

import { ShoppingBag } from "lucide-react";
import { ButtonLink, Drawer, EmptyState } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { formatPrice } from "@/lib/format";
import { CartItem } from "./CartItem";

export function CartDrawer() {
  const { items, isDrawerOpen, closeDrawer, getSummary, itemCount } = useCart();
  const summary = getSummary();

  return (
    <Drawer
      open={isDrawerOpen}
      onClose={closeDrawer}
      title={`Your Cart (${itemCount})`}
      footer={
        items.length ? (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-muted">Subtotal</span>
              <span className="text-lg font-semibold text-ink">{formatPrice(summary.subtotal)}</span>
            </div>
            <p className="text-xs text-ink-muted">Delivery and discounts are calculated at checkout.</p>
            <div className="grid grid-cols-2 gap-2">
              <ButtonLink href="/cart" variant="outline" onClick={closeDrawer}>
                View Cart
              </ButtonLink>
              <ButtonLink href="/checkout" onClick={closeDrawer}>
                Checkout
              </ButtonLink>
            </div>
          </div>
        ) : undefined
      }
    >
      {items.length ? (
        <div className="px-5">
          <div className="divide-y divide-line">
            {items.map((item) => (
              <CartItem key={item.id} item={item} compact onNavigate={closeDrawer} />
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<ShoppingBag className="h-7 w-7" aria-hidden />}
          title="Your cart is empty"
          description="Discover new arrivals and timeless essentials."
          action={
            <ButtonLink href="/shop" onClick={closeDrawer}>
              Start Shopping
            </ButtonLink>
          }
        />
      )}
    </Drawer>
  );
}
