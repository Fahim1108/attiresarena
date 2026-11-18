'use client';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { useCart } from '@/context/CartContext';
import { couponReasonMessage, fromMinorUnits, isCouponFresh, isWellFormedCouponCode, normalizeCouponCode, toMinorUnits } from '@/lib/checkout/coupons';
import { formatPrice } from '@/lib/format';
import { checkCouponAction } from '@/services/coupon-actions';

/**
 * Coupon field for the cart and checkout pages. Guests may check a coupon;
 * only first-order-only coupons need a signed-in customer, and the server
 * says so. The discount shown is always the amount the server validated
 * for the current cart subtotal and phone: when either changes, the coupon
 * is re-checked automatically, and a coupon that no longer applies is
 * removed. A failed check (network, expired session) keeps the coupon and
 * shows a retry message — only a definitive server refusal removes it.
 *
 * `phone` (checkout only) is the customer's normalized mobile number when
 * the delivery form has a valid one; it lets the server count per-customer
 * usage for guests. The cart page passes none.
 */
export function CouponField({ phone }: { phone?: string | null }) {
  const id = useId();
  const { items, coupon, applyCoupon, removeCoupon } = useCart();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const subtotalMinor = toMinorUnits(items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0));
  const normalizedPhone = phone ?? null;
  const fresh = isCouponFresh(coupon, subtotalMinor, normalizedPhone);
  // Key of the subtotal+phone pair already re-validated (or in flight).
  // Reset when a check is cancelled or fails transiently, so a later
  // effect run can retry; a definitive answer keeps the key.
  const revalidatedFor = useRef<string | null>(null);

  // Re-check a stale coupon once per subtotal+phone pair. The order itself
  // is always re-validated server-side at place time, so this is display
  // freshness, not a security boundary.
  useEffect(() => {
    if (!coupon) return;
    const key = `${subtotalMinor}:${normalizedPhone ?? ''}`;
    if (isCouponFresh(coupon, subtotalMinor, normalizedPhone)) {
      revalidatedFor.current = key;
      return;
    }
    if (subtotalMinor === 0) {
      removeCoupon();
      return;
    }
    if (revalidatedFor.current === key) return;
    revalidatedFor.current = key;
    let cancelled = false;
    let completed = false;
    start(async () => {
      try {
        const result = await checkCouponAction({ code: coupon.code, phone: normalizedPhone, subtotalMinor });
        if (cancelled) return;
        completed = true;
        if (result.ok && result.valid) {
          applyCoupon({ code: result.code, discountMinor: result.discountMinor, validatedSubtotalMinor: subtotalMinor, validatedPhone: normalizedPhone });
          setMessage({ ok: true, text: `Coupon applied: ${formatPrice(fromMinorUnits(result.discountMinor))} off.` });
        } else if (result.ok) {
          removeCoupon();
          setMessage({ ok: false, text: couponReasonMessage(result.reason) });
        } else {
          // Transient failure: keep the coupon so the customer is not forced
          // to retype the code, and allow a retry on the next effect run.
          revalidatedFor.current = null;
          setMessage({ ok: false, text: result.message });
        }
      } catch {
        if (cancelled) return;
        completed = true;
        revalidatedFor.current = null;
        setMessage({ ok: false, text: 'The coupon could not be checked. Please try again.' });
      }
    });
    return () => {
      cancelled = true;
      // A cancelled check answered nothing: allow a retry for this pair.
      if (!completed) revalidatedFor.current = null;
    };
  }, [coupon, subtotalMinor, normalizedPhone, applyCoupon, removeCoupon, start]);

  const handleRemove = () => {
    removeCoupon();
    setMessage(null);
  };

  if (coupon) {
    return (
      <div>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate rounded-control border border-line bg-white px-3 py-2.5 text-sm">
            <span className="font-semibold">{coupon.code}</span>
            <span className="text-ink-muted"> — {fresh ? `${formatPrice(fromMinorUnits(coupon.discountMinor))} off` : pending ? 'Checking…' : 'Not applied'}</span>
          </p>
          <Button type="button" variant="outline" onClick={handleRemove} disabled={pending}>Remove</Button>
        </div>
        {message && <p role="status" className={`mt-2 text-xs ${message.ok ? 'text-success' : 'text-danger'}`}>{message.text}</p>}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const normalized = normalizeCouponCode(code);
        if (!isWellFormedCouponCode(normalized)) {
          setMessage({ ok: false, text: 'Enter a valid coupon code.' });
          return;
        }
        if (subtotalMinor <= 0) {
          setMessage({ ok: false, text: 'Add an item to your cart before applying a coupon.' });
          return;
        }
        start(async () => {
          try {
            const result = await checkCouponAction({ code: normalized, phone: normalizedPhone, subtotalMinor });
            if (result.ok && result.valid) {
              applyCoupon({ code: result.code, discountMinor: result.discountMinor, validatedSubtotalMinor: subtotalMinor, validatedPhone: normalizedPhone });
              setCode('');
              setMessage({ ok: true, text: `Coupon applied: ${formatPrice(fromMinorUnits(result.discountMinor))} off.` });
            } else if (result.ok) {
              setMessage({ ok: false, text: couponReasonMessage(result.reason) });
            } else {
              setMessage({ ok: false, text: result.message });
            }
          } catch {
            setMessage({ ok: false, text: 'The coupon could not be checked. Please try again.' });
          }
        });
      }}
    >
      <div className="flex gap-2">
        <label htmlFor={id} className="sr-only">Coupon code</label>
        <input
          id={id}
          name="couponCode"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={30}
          placeholder="Enter coupon code"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="h-11 min-w-0 flex-1 rounded-control border border-line bg-white px-3 text-base focus:border-primary md:text-sm"
        />
        <Button type="submit" variant="outline" loading={pending}>Apply</Button>
      </div>
      {/* A success message here is always stale: a successful apply switches
          to the applied-chip view. Only failures belong under the form. */}
      {message && !message.ok && <p role="status" className="mt-2 text-xs text-danger">{message.text}</p>}
    </form>
  );
}
