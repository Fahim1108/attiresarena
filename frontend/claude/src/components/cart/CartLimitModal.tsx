"use client";

import { ShoppingBag } from "lucide-react";
import { useState } from "react";
import { Button, ButtonLink, Modal } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { cartLimitRuleText, type CartLimitRefusal } from "@/lib/cart-limits";

/** The popup body, kept presentational so tests can render it without a DOM. */
export function CartLimitNoticeContent({ currentUnits, limit }: { currentUnits: number; limit: number }) {
  return (
    <div className="space-y-3" data-cart-limit-notice>
      <p className="flex items-start gap-2.5 text-sm leading-relaxed text-ink">
        <ShoppingBag className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <span>
          Your cart already has <strong className="font-semibold">{currentUnits} {currentUnits === 1 ? "item" : "items"}</strong>, and nothing was
          added — your cart is unchanged.
        </span>
      </p>
      <p className="text-sm leading-relaxed text-ink-muted">{cartLimitRuleText(limit)}</p>
    </div>
  );
}

/**
 * Global order-limit popup. Mounted once (next to the cart drawer); it opens
 * whenever the cart refuses an add or quantity increase past the per-order
 * unit limit, whichever add path the customer used.
 */
export function CartLimitModal() {
  const { limitNotice, dismissLimitNotice } = useCart();
  // Keep the last notice for the modal's exit animation after dismissal:
  // the previous-value pattern (same as CatalogContext) adjusts state during
  // render instead of in an effect.
  const [shownNotice, setShownNotice] = useState<CartLimitRefusal | null>(null);
  const [prevNotice, setPrevNotice] = useState(limitNotice);
  if (limitNotice !== prevNotice) {
    setPrevNotice(limitNotice);
    if (limitNotice) setShownNotice(limitNotice);
  }
  const notice = limitNotice ?? shownNotice;
  return (
    <Modal
      open={limitNotice !== null}
      onClose={dismissLimitNotice}
      title="Order limit reached"
      // Above the cart drawer (z-[60]) regardless of portal mount order, so a
      // refusal is never hidden under an open drawer.
      zIndexClass="z-[70]"
      description={notice ? `Your cart already has ${notice.currentUnits} of ${notice.limit} items.` : undefined}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <ButtonLink href="/cart" variant="outline" onClick={dismissLimitNotice}>
            View Cart
          </ButtonLink>
          <Button variant="primary" onClick={dismissLimitNotice}>
            Got It
          </Button>
        </div>
      }
    >
      {notice && <CartLimitNoticeContent currentUnits={notice.currentUnits} limit={notice.limit} />}
    </Modal>
  );
}
