import { describe, expect, it } from 'vitest';
import { createCheckoutService, type CheckoutRpc, type RpcResult } from '../src/lib/checkout/service';
import { parseCheckoutOrder, parseCheckoutProgress } from '../src/lib/checkout/validation';
import { checkoutCookieOptions, checkoutOrdersConfiguration } from '../src/lib/checkout/config';

const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const order = (over: Record<string, unknown> = {}) => ({
  customer: { fullName: 'Nasrin Akter', phone: '+880 1712-345678', email: '' },
  address: { fullName: 'x', phone: 'x', division: 'Dhaka', district: 'Gazipur', area: 'Tongi', addressLine: 'House 3, Block B' },
  paymentMethod: 'cod', items: [{ productId: 'ignored', variantId: V1, quantity: 2, unitPrice: 1, total: 1 }], couponCode: 'WELCOME10', saveAddress: true, ...over,
});

/** In-memory stand-in for the database functions, with the same observable rules. */
function fakeDatabase() {
  type Session = { completed: boolean; items: { variant_id: string; quantity: number }[]; phone: string; order?: Record<string, unknown> };
  const sessions = new Map<string, Session>();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let next = 0; let orders = 0; let placedAt = Date.now();
  const bad = <T,>(code: string): RpcResult<T> => ({ ok: false, code });
  const rpc: CheckoutRpc = async <T,>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const good = (data: unknown): RpcResult<T> => ({ ok: true, data: data as T });
    if (name === 'start_checkout_session') {
      const token = String(++next).padStart(64, 'a');
      sessions.set(token, { completed: false, items: [], phone: String(args.phone) });
      return good({ token, expires_at: '2030-01-08T00:00:00Z' });
    }
    const s = sessions.get(String(args.raw_token));
    if (!s) return bad('22023');
    if (name === 'checkout_session_status') return good({ lifecycle_status: s.completed ? 'completed' : 'active' });
    if (name === 'place_checkout_order') {
      if (s.completed) return good({ ...s.order, already_placed: true });
      if (!s.items.length) return bad('CK003');
      orders += 1; s.completed = true;
      s.order = { order_number: 10000 + orders, total_minor: 253000, placed_at: new Date(placedAt).toISOString(), items: s.items };
      return good({ ...s.order, already_placed: false });
    }
    if (s.completed) return bad('22023');
    if (name === 'update_checkout_contact') { s.phone = String(args.phone); return good({}); }
    if (name === 'set_checkout_items') { s.items = args.items as Session['items']; return good({}); }
    return bad('unknown');
  };
  return { rpc, calls, sessions, orderCount: () => orders, setPlacedAt: (t: number) => { placedAt = t; } };
}
function jar(initial?: string) {
  let value = initial; const log: string[] = [];
  return { get: () => value, set: (t: string) => { value = t; log.push('set'); }, clear: () => { value = undefined; log.push('clear'); }, log, value: () => value };
}
const WINDOW = 15 * 60 * 1000;

describe('checkout input validation', () => {
  it('keeps only variant and quantity, normalises the phone and drops browser prices', () => {
    const parsed = parseCheckoutOrder(order());
    expect(parsed?.customer).toEqual({ fullName: 'Nasrin Akter', phone: '+8801712345678', email: undefined });
    expect(parsed?.items).toEqual([{ variantId: V1, quantity: 2 }]);
    expect(JSON.stringify(parsed)).not.toMatch(/unitPrice|total|coupon|productId/);
  });
  it('rejects bad quantities, duplicate lines, non-UUID variants and an empty cart', () => {
    for (const items of [[{ variantId: V1, quantity: 0 }], [{ variantId: V1, quantity: 100 }], [{ variantId: V1, quantity: 1.5 }], [{ variantId: V1, quantity: '2' }], [{ variantId: 'aa-shirt-001', quantity: 1 }], [{ variantId: V1, quantity: 1 }, { variantId: V1.toUpperCase(), quantity: 1 }], []])
      expect(parseCheckoutOrder(order({ items }))).toBeNull();
  });
  it('rejects a district outside its division, a short address, a bad phone and non-COD payment', () => {
    expect(parseCheckoutOrder(order({ address: { division: 'Sylhet', district: 'Dhaka', area: 'A', addressLine: 'House 3, Block B' } }))).toBeNull();
    expect(parseCheckoutOrder(order({ address: { division: 'Dhaka', district: 'Dhaka', area: 'A', addressLine: 'short' } }))).toBeNull();
    expect(parseCheckoutOrder(order({ customer: { fullName: 'Nasrin Akter', phone: '0123456' } }))).toBeNull();
    expect(parseCheckoutOrder(order({ paymentMethod: 'online' }))).toBeNull();
  });
  it('allows saving progress with an empty cart but still requires a valid contact', () => {
    expect(parseCheckoutProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [] })).not.toBeNull();
    expect(parseCheckoutProgress({ customer: { fullName: 'N', phone: '01712345678' }, items: [] })).toBeNull();
  });
});

describe('checkout server flow', () => {
  it('starts a session, keeps the token only in the cookie jar and never returns it', async () => {
    const db = fakeDatabase(); const cookies = jar();
    const result = await createCheckoutService(db.rpc, cookies, { duplicateWindowMs: WINDOW }).saveProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [{ variantId: V1, quantity: 1 }] });
    expect(result).toEqual({ ok: true, data: { saved: true } });
    expect(cookies.value()).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain(cookies.value());
  });
  it('places an order from database items, returns the server total and clears the cookie', async () => {
    const db = fakeDatabase(); const cookies = jar();
    const result = await createCheckoutService(db.rpc, cookies, { duplicateWindowMs: WINDOW }).placeOrder(order());
    expect(result).toEqual({ ok: true, data: { orderNumber: '10001', total: 2530 } });
    expect(cookies.value()).toBeUndefined();
    const place = db.calls.find((c) => c.name === 'place_checkout_order')!;
    expect(Object.keys(place.args).sort()).toEqual(['delivery', 'order_note', 'payment_method', 'raw_token']);
    expect(JSON.stringify(db.calls)).not.toMatch(/unitPrice|WELCOME10|"total"/);
  });
  it('a repeated submission of the same purchase resolves to the same single order', async () => {
    const db = fakeDatabase(); const first = jar();
    const service = createCheckoutService(db.rpc, first, { duplicateWindowMs: WINDOW });
    await service.saveProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [{ variantId: V1, quantity: 2 }] });
    const token = first.value()!;
    // Two requests carrying the same cookie (double click / retry after a lost response).
    const a = await createCheckoutService(db.rpc, jar(token), { duplicateWindowMs: WINDOW }).placeOrder(order());
    const b = await createCheckoutService(db.rpc, jar(token), { duplicateWindowMs: WINDOW }).placeOrder(order());
    expect(a).toEqual(b);
    expect(db.orderCount()).toBe(1);
  });
  it('a different cart with a stale completed credential becomes a new order, not the old one', async () => {
    const db = fakeDatabase(); const cookies = jar();
    const service = createCheckoutService(db.rpc, cookies, { duplicateWindowMs: WINDOW });
    await service.saveProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [{ variantId: V1, quantity: 2 }] });
    const token = cookies.value()!;
    await createCheckoutService(db.rpc, jar(token), { duplicateWindowMs: WINDOW }).placeOrder(order());
    const later = await createCheckoutService(db.rpc, jar(token), { duplicateWindowMs: WINDOW }).placeOrder(order({ items: [{ variantId: V2, quantity: 1 }] }));
    expect(later).toMatchObject({ ok: true, data: { orderNumber: '10002' } });
    expect(db.orderCount()).toBe(2);
  });
  it('the same cart resubmitted after the duplicate window is a new order', async () => {
    const db = fakeDatabase(); const cookies = jar();
    await createCheckoutService(db.rpc, cookies, { duplicateWindowMs: WINDOW }).saveProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [{ variantId: V1, quantity: 2 }] });
    const token = cookies.value()!;
    db.setPlacedAt(Date.now() - WINDOW - 1000);
    await createCheckoutService(db.rpc, jar(token), { duplicateWindowMs: WINDOW }).placeOrder(order());
    db.setPlacedAt(Date.now());
    const again = await createCheckoutService(db.rpc, jar(token), { duplicateWindowMs: WINDOW }).placeOrder(order());
    expect(again).toMatchObject({ ok: true, data: { orderNumber: '10002' } });
  });
  it('a forged or expired cookie is discarded and never trusted', async () => {
    const db = fakeDatabase(); const cookies = jar('f'.repeat(64));
    const result = await createCheckoutService(db.rpc, cookies, { duplicateWindowMs: WINDOW }).placeOrder(order());
    expect(result).toMatchObject({ ok: true });
    expect(cookies.log[0]).toBe('clear');
    expect(db.sessions.has('f'.repeat(64))).toBe(false);
    const malformed = jar('<script>');
    await createCheckoutService(db.rpc, malformed, { duplicateWindowMs: WINDOW }).saveProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [] });
    expect(db.calls.some((c) => c.args.raw_token === '<script>')).toBe(false);
  });
  it('maps database refusals to honest messages and creates no order', async () => {
    for (const [code, reason] of [['CK001', 'validation'], ['CK002', 'validation'], ['CK003', 'validation'], ['network', 'not_connected'], ['PGRST202', 'not_connected']] as const) {
      const db = fakeDatabase();
      const rpc: CheckoutRpc = async (name, args) => (name === 'place_checkout_order' ? { ok: false, code } : db.rpc(name, args));
      const cookies = jar();
      const result = await createCheckoutService(rpc, cookies, { duplicateWindowMs: WINDOW }).placeOrder(order());
      expect(result).toMatchObject({ ok: false, reason });
      expect(cookies.value()).toMatch(/^[0-9a-f]{64}$/); // the checkout survives for a retry
    }
  });
  it('rejects invalid input before contacting the database', async () => {
    const db = fakeDatabase();
    expect(await createCheckoutService(db.rpc, jar(), { duplicateWindowMs: WINDOW }).placeOrder(order({ items: [] }))).toMatchObject({ ok: false, reason: 'validation' });
    expect(db.calls).toHaveLength(0);
  });
});

describe('checkout configuration', () => {
  it('cookie is HttpOnly, SameSite=Lax, scoped to checkout and Secure in production builds', () => {
    const env = process.env as Record<string, string | undefined>; const before = env.NODE_ENV;
    env.NODE_ENV = 'production';
    expect(checkoutCookieOptions(new Date('2030-01-08T00:00:00Z'))).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/checkout' });
    env.NODE_ENV = before;
    expect(checkoutCookieOptions()).toMatchObject({ httpOnly: true, maxAge: 604800 });
  });
  it('ordering is off without the Staging flag, on Production, or against any other project', () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { ...env };
    const set = (values: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(values)) { if (v === undefined) delete env[k]; else env[k] = v; } };
    const staging = { SUPABASE_URL: 'https://jwccyndyaamodxjtjtfo.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined, VERCEL_ENV: 'preview', CLAUDE_DESIGN_PREVIEW: '1' };
    set({ ...staging, STAGING_CHECKOUT_ORDERS: undefined }); expect(checkoutOrdersConfiguration()).toBeNull();
    set({ ...staging, STAGING_CHECKOUT_ORDERS: '1' }); expect(checkoutOrdersConfiguration()).not.toBeNull();
    set({ ...staging, STAGING_CHECKOUT_ORDERS: '1', VERCEL_ENV: 'production' }); expect(checkoutOrdersConfiguration()).toBeNull();
    set({ ...staging, STAGING_CHECKOUT_ORDERS: '1', SUPABASE_URL: 'https://euoannuvovsbwxjqnriw.supabase.co' }); expect(checkoutOrdersConfiguration()).toBeNull();
    for (const k of Object.keys(env)) if (!(k in saved)) delete env[k];
    Object.assign(env, saved);
  });
});
