"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {reconcileCartLines} from "@/lib/cart-catalogue";
import { applyCartAdd, applyCartQuantity, cartUnitCount, MAX_UNITS_PER_ORDER, type CartLimitRefusal } from "@/lib/cart-limits";
import type {Product} from "@/types";
import { commerce } from "@/config";
import { isInsideDhaka } from "@/data/bangladesh";
import { readStorage, STORAGE_KEYS, writeStorage } from "@/lib/storage";
import type { CartItem, Coupon, OrderSummary } from "@/types";

/**
 * Outcome of an add-to-cart or quantity attempt. `added: false` only ever
 * means the per-order unit limit refused it — the limit popup is already
 * showing, so callers must not open the drawer or navigate to checkout.
 * Every other path (including today's silent no-ops for unavailable or
 * already-maxed lines) reports `added: true`, preserving caller behaviour.
 */
export type CartAddOutcome = { added: true } | { added: false; reason: "limit" };

interface CartContextValue {
  items: CartItem[];
  hydrated: boolean;
  itemCount: number;
  /** Maximum total units in one order (mirrors the database checkout setting). */
  maxUnitsPerOrder: number;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => CartAddOutcome;
  updateQuantity: (lineId: string, quantity: number) => CartAddOutcome;
  removeItem: (lineId: string) => void;
  clear: () => void;
  coupon?: Coupon;
  applyCoupon: (code: string) => { ok: boolean; message: string };
  removeCoupon: () => void;
  /** Summary for a given delivery district (defaults to inside Dhaka). */
  getSummary: (district?: string) => OrderSummary;
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  /** Set when an add or quantity increase is refused by the order limit; drives the limit popup. */
  limitNotice: CartLimitRefusal | null;
  dismissLimitNotice: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

/**
 * Local cart state persisted to localStorage.
 * Codex: when a server cart exists, sync `items` with it here (the API of this
 * context can stay the same, so components need no changes).
 */
export function CartProvider({ children, initialItems = [], approvedVariantIds = initialItems.map(i=>i.variantId), approvedProducts=[] }: { children: ReactNode; initialItems?: CartItem[]; approvedVariantIds?: string[]; approvedProducts?:Product[] }) {
  const [approvedIds] = useState(()=>new Set(approvedVariantIds));
  const [initialSeed] = useState(initialItems);
  const [items, setItems] = useState<CartItem[]>([]);
  // Synchronous mirror of `items` for cart mutations. Outcomes (added vs
  // refused) must be computed from the latest committed lines, and state
  // updaters may run later than the dispatch — so every mutation computes
  // from this ref and updates it in the same handler. All mutations go
  // through addItem/updateQuantity/removeItem/clear and the hydration
  // effect below, which keep the ref and the state in step.
  const itemsRef = useRef<CartItem[]>([]);
  const [coupon, setCoupon] = useState<Coupon | undefined>();
  const [hydrated, setHydrated] = useState(false);
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [limitNotice, setLimitNotice] = useState<CartLimitRefusal | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
    const stored = readStorage<CartItem[] | null>(STORAGE_KEYS.cart, null);
    const seeded = readStorage<boolean>(STORAGE_KEYS.cartSeeded, false);
    let restored: CartItem[] | null = null;
    if (stored) restored = reconcileCartLines(stored,approvedProducts).filter(item=>approvedIds.has(item.variantId));
    else if (initialSeed.length && !seeded) {
      restored = initialSeed;
      writeStorage(STORAGE_KEYS.cartSeeded, true);
    }
    if (restored) {
      itemsRef.current = restored;
      setItems(restored);
      // A stored cart written before the cap (or hand-edited) can exceed the
      // limit: keep the items, but explain the rule at once instead of
      // failing silently at checkout.
      if (cartUnitCount(restored) > MAX_UNITS_PER_ORDER) {
        setLimitNotice({ currentUnits: cartUnitCount(restored), attemptedUnits: 0, limit: MAX_UNITS_PER_ORDER });
      }
    }
    setHydrated(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialSeed, approvedIds, approvedProducts]);

  useEffect(() => {
    if (hydrated) writeStorage(STORAGE_KEYS.cart, items);
  }, [items, hydrated]);

  const addItem = useCallback<CartContextValue["addItem"]>((item, quantity = 1) => {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || item.maxQuantity < 1) return { added: true };
    const approved=reconcileCartLines([{variantId:item.variantId,quantity}],approvedProducts)[0];
    if(!approved||!approvedIds.has(approved.variantId))return { added: true };
    item=approved;
    const { lines, result } = applyCartAdd(itemsRef.current, item, quantity);
    itemsRef.current = lines;
    setItems(lines);
    if (result.refused) {
      setLimitNotice(result.refusal);
      return { added: false, reason: "limit" };
    }
    return { added: true };
  }, [approvedProducts,approvedIds]);

  const updateQuantity = useCallback<CartContextValue["updateQuantity"]>((lineId, quantity) => {
    const { lines, result } = applyCartQuantity(itemsRef.current, lineId, quantity);
    itemsRef.current = lines;
    setItems(lines);
    if (result.refused) {
      setLimitNotice(result.refusal);
      return { added: false, reason: "limit" };
    }
    return { added: true };
  }, []);

  const dismissLimitNotice = useCallback(() => setLimitNotice(null), []);

  const removeItem = useCallback((lineId: string) => {
    const next = itemsRef.current.filter((i) => i.id !== lineId);
    itemsRef.current = next;
    setItems(next);
  }, []);
  const clear = useCallback(() => {
    itemsRef.current = [];
    setItems([]);
  }, []);

  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  const applyCoupon = useCallback(() => ({ok:false,message:'Please sign in to redeem your coupon. Server validation is required.'}), []);

  const getSummary = useCallback(
    (district?: string): OrderSummary => {
      const itemCount = items.reduce((n, i) => n + i.quantity, 0);
      let discount = 0;
      if (coupon?.type === "percent") discount = Math.round((subtotal * coupon.value) / 100);
      if (coupon?.type === "fixed") discount = Math.min(coupon.value, subtotal);
      const baseDelivery = district && !isInsideDhaka(district) ? commerce.deliveryCharges.outsideDhaka : commerce.deliveryCharges.insideDhaka;
      const free = coupon?.type === "free-shipping" || subtotal >= commerce.freeDeliveryThreshold;
      const deliveryCharge = itemCount === 0 || free ? 0 : baseDelivery;
      return { itemCount, subtotal, discount, deliveryCharge, total: Math.max(0, subtotal - discount + deliveryCharge), coupon };
    },
    [items, coupon, subtotal],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      hydrated,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      maxUnitsPerOrder: MAX_UNITS_PER_ORDER,
      addItem,
      updateQuantity,
      removeItem,
      clear,
      coupon,
      applyCoupon,
      removeCoupon: () => setCoupon(undefined),
      getSummary,
      isDrawerOpen,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      limitNotice,
      dismissLimitNotice,
    }),
    [items, hydrated, addItem, updateQuantity, removeItem, clear, coupon, applyCoupon, getSummary, isDrawerOpen, limitNotice, dismissLimitNotice],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
