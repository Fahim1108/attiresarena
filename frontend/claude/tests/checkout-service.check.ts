import { describe, expect, it } from 'vitest';
import { createCheckoutService, checkoutMessagesForTests, type CheckoutRpc, type RpcResult } from '../src/lib/checkout/service';
import { parseCheckoutOrder, parseCheckoutProgress } from '../src/lib/checkout/validation';
import { checkoutCookieOptions, checkoutOrdersConfiguration } from '../src/lib/checkout/config';
import { canPlaceOrder } from '../src/lib/checkout/gate';

const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const CLIENT = 'c'.repeat(64);
const order = (over: Record<string, unknown> = {}) => ({
  customer: { fullName: 'Nasrin Akter', phone: '+880 1712-345678', email: '' },
  address: { fullName: 'x', phone: 'x', division: 'Dhaka', district: 'Gazipur', area: 'Tongi', addressLine: 'House 3, Block B' },
  paymentMethod: 'cod', items: [{ productId: 'ignored', variantId: V1, quantity: 1, unitPrice: 1, total: 1 }], couponCode: 'WELCOME10', saveAddress: true, ...over,
});

/**
 * In-memory stand-in for the database RPCs. It mirrors the rules the database enforces:
 * idempotency per session (CK004 for a different cart), time-independent retries, and refusals.
 */
function fakeDatabase(options: { now?: () => number } = {}) {
  type Session = { completed: boolean; items: { variant_id: string; quantity: number }[]; order?: { order_number: number; total_minor: number; placed_at: string; items: { variant_id: string; quantity: number }[] } };
  const sessions = new Map<string, Session>();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let next = 0; let orders = 0;
  const now = options.now ?? (() => Date.now());
  const bad = <T,>(code: string): RpcResult<T> => ({ ok: false, code });
  const same = (a: { variant_id: string; quantity: number }[], b: { variant_id: string; quantity: number }[]) =>
    JSON.stringify([...a].sort((x, y) => x.variant_id.localeCompare(y.variant_id))) === JSON.stringify([...b].sort((x, y) => x.variant_id.localeCompare(y.variant_id)));
  const rpc: CheckoutRpc = async <T,>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const good = (data: unknown): RpcResult<T> => ({ ok: true, data: data as T });
    if (name === 'start_checkout_session') {
      const token = String(++next).padStart(64, 'a');
      sessions.set(token, { completed: false, items: [] });
      return good({ token, expires_at: '2030-01-08T00:00:00Z' });
    }
    const s = sessions.get(String(args.raw_token));
    if (!s) return bad('22023');
    if (name === 'checkout_session_status') return good({ lifecycle_status: s.completed ? 'completed' : 'active' });
    if (name === 'place_checkout_order') {
      if (s.completed && s.order) {
        const expected = (args.expected_items as { variant_id: string; quantity: number }[] | null) ?? null;
        if (expected && !same(expected, s.order.items)) return bad('CK004');
        return good({ order_number: s.order.order_number, total_minor: s.order.total_minor, placed_at: s.order.placed_at, already_placed: true, items: s.order.items });
      }
      if (!s.items.length) return bad('CK003');
      orders += 1; s.completed = true;
      s.order = { order_number: 10000 + orders, total_minor: 253000, placed_at: new Date(now()).toISOString(), items: s.items };
      return good({ ...s.order, already_placed: false });
    }
    if (s.completed) return bad('22023');
    if (name === 'set_checkout_items') { s.items = args.items as Session['items']; return good({}); }
    if (name === 'update_checkout_contact') return good({});
    return bad('unknown');
  };
  return { rpc, calls, sessions, orderCount: () => orders };
}
function jar(initial?: string) {
  let value = initial; const log: string[] = [];
  return { get: () => value, set: (t: string) => { value = t; log.push('set'); }, clear: () => { value = undefined; log.push('clear'); }, log, value: () => value };
}

describe('checkout input validation', () => {
  it('keeps only variant and quantity, normalises the phone and drops browser prices', () => {
    const parsed = parseCheckoutOrder(order());
    expect(parsed?.customer).toEqual({ fullName: 'Nasrin Akter', phone: '+8801712345678', email: undefined });
    expect(parsed?.items).toEqual([{ variantId: V1, quantity: 1 }]);
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
  it('requires a hashed client key, so rate limits cannot be bypassed by omission', () => {
    expect(() => createCheckoutService(fakeDatabase().rpc, jar(), { clientKey: 'short' })).toThrow();
  });
  it('starts a session, keeps the token only in the cookie jar and never returns it', async () => {
    const db = fakeDatabase(); const cookies = jar();
    const result = await createCheckoutService(db.rpc, cookies, { clientKey: CLIENT }).saveProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [{ variantId: V1, quantity: 1 }] });
    expect(result).toEqual({ ok: true, data: { saved: true } });
    expect(cookies.value()).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain(cookies.value());
  });
  it('sends the client identity with every write, never a price, and the expected items with placement', async () => {
    const db = fakeDatabase(); const cookies = jar();
    await createCheckoutService(db.rpc, cookies, { clientKey: CLIENT }).placeOrder(order());
    for (const c of db.calls.filter((x) => ['start_checkout_session', 'set_checkout_items', 'place_checkout_order'].includes(x.name)))
      expect(c.args.client_key).toBe(CLIENT);
    const place = db.calls.find((c) => c.name === 'place_checkout_order')!;
    expect(Object.keys(place.args).sort()).toEqual(['client_key', 'delivery', 'expected_items', 'order_note', 'payment_method', 'raw_token']);
    expect(place.args.expected_items).toEqual([{ variant_id: V1, quantity: 1 }]);
    expect(JSON.stringify(db.calls)).not.toMatch(/unitPrice|WELCOME10|"total"|"price"/);
  });
  it('places an order and returns the server total, then clears the cookie', async () => {
    const db = fakeDatabase(); const cookies = jar();
    const result = await createCheckoutService(db.rpc, cookies, { clientKey: CLIENT }).placeOrder(order());
    expect(result).toEqual({ ok: true, data: { orderNumber: '10001', total: 2530 } });
    expect(cookies.value()).toBeUndefined();
  });
  it('an immediate retry with the same cart returns the original order', async () => {
    const db = fakeDatabase(); const first = jar();
    const service = createCheckoutService(db.rpc, first, { clientKey: CLIENT });
    await service.saveProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [{ variantId: V1, quantity: 1 }] });
    const token = first.value()!;
    const a = await createCheckoutService(db.rpc, jar(token), { clientKey: CLIENT }).placeOrder(order());
    const b = await createCheckoutService(db.rpc, jar(token), { clientKey: CLIENT }).placeOrder(order());
    expect(a).toEqual(b);
    expect(db.orderCount()).toBe(1);
  });
  it('a DELAYED retry, hours later with the same cart, returns the original order and creates nothing new', async () => {
    let clock = Date.parse('2030-01-01T00:00:00Z');
    const db = fakeDatabase({ now: () => clock }); const cookies = jar();
    await createCheckoutService(db.rpc, cookies, { clientKey: CLIENT }).saveProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [{ variantId: V1, quantity: 1 }] });
    const token = cookies.value()!;
    const first = await createCheckoutService(db.rpc, jar(token), { clientKey: CLIENT }).placeOrder(order());
    clock += 3 * 60 * 60 * 1000;
    const retry = await createCheckoutService(db.rpc, jar(token), { clientKey: CLIENT }).placeOrder(order());
    expect(retry).toEqual(first);
    expect(db.orderCount()).toBe(1);
  });
  it('a different cart with a completed credential starts a NEW checkout, never silently reuses the old order', async () => {
    const db = fakeDatabase(); const cookies = jar();
    const service = createCheckoutService(db.rpc, cookies, { clientKey: CLIENT });
    await service.saveProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [{ variantId: V1, quantity: 1 }] });
    const token = cookies.value()!;
    await createCheckoutService(db.rpc, jar(token), { clientKey: CLIENT }).placeOrder(order());
    const later = await createCheckoutService(db.rpc, jar(token), { clientKey: CLIENT }).placeOrder(order({ items: [{ variantId: V2, quantity: 1 }] }));
    expect(later).toMatchObject({ ok: true, data: { orderNumber: '10002' } });
    expect(db.orderCount()).toBe(2);
  });
  it('a forged or malformed cookie is discarded and never sent to the database', async () => {
    const db = fakeDatabase(); const cookies = jar('f'.repeat(64));
    const result = await createCheckoutService(db.rpc, cookies, { clientKey: CLIENT }).placeOrder(order());
    expect(result).toMatchObject({ ok: true });
    expect(cookies.log[0]).toBe('clear');
    const malformed = jar('<script>');
    await createCheckoutService(db.rpc, malformed, { clientKey: CLIENT }).saveProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [] });
    expect(db.calls.some((c) => c.args.raw_token === '<script>')).toBe(false);
  });
  it('every refusal code maps to a guest message, and no message suggests order tracking', async () => {
    const codes = ['CK001', 'CK002', 'CK003', 'CK005', 'CK006', 'CK007', 'CK008', 'CK010', 'CK011', 'network', 'PGRST202'];
    for (const code of codes) {
      const db = fakeDatabase();
      const rpc: CheckoutRpc = async (name, args) => (name === 'place_checkout_order' ? { ok: false, code } : db.rpc(name, args));
      const cookies = jar();
      const result = await createCheckoutService(rpc, cookies, { clientKey: CLIENT }).placeOrder(order());
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) {
        expect(result.message.length).toBeGreaterThan(10);
        expect(result.message).not.toMatch(/order status|track|tracking|check your order/i);
      }
      expect(cookies.value()).toMatch(/^[0-9a-f]{64}$/); // the checkout survives for a retry
    }
    expect(Object.values(checkoutMessagesForTests).every((m) => !/order status|track/i.test(m))).toBe(true);
  });
  it('rate-limit refusals explain the wait without promising anything else', async () => {
    const db = fakeDatabase();
    const rpc: CheckoutRpc = async (name, args) => (name === 'start_checkout_session' ? { ok: false, code: 'CK005' } : db.rpc(name, args));
    const result = await createCheckoutService(rpc, jar(), { clientKey: CLIENT }).saveProgress({ customer: { fullName: 'Nasrin Akter', phone: '01712345678' }, items: [] });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
    if (!result.ok) expect(result.message).toMatch(/wait/i);
  });
  it('rejects invalid input before contacting the database', async () => {
    const db = fakeDatabase();
    expect(await createCheckoutService(db.rpc, jar(), { clientKey: CLIENT }).placeOrder(order({ items: [] }))).toMatchObject({ ok: false, reason: 'validation' });
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
  it('ordering needs the explicit flag, the verified Staging project and a server-only service key; never production', () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { ...env };
    const set = (values: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(values)) { if (v === undefined) delete env[k]; else env[k] = v; } };
    const staging = { SUPABASE_URL: 'https://jwccyndyaamodxjtjtfo.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_server_only_key_value', VERCEL_ENV: 'preview', CLAUDE_DESIGN_PREVIEW: '1' };
    set({ ...staging, STAGING_CHECKOUT_ORDERS: undefined }); expect(checkoutOrdersConfiguration()).toBeNull();
    set({ ...staging, STAGING_CHECKOUT_ORDERS: '1' }); expect(checkoutOrdersConfiguration()).toMatchObject({ url: 'https://jwccyndyaamodxjtjtfo.supabase.co', serviceKey: 'sb_secret_server_only_key_value' });
    set({ ...staging, STAGING_CHECKOUT_ORDERS: '1', VERCEL_ENV: 'production' }); expect(checkoutOrdersConfiguration()).toBeNull();
    set({ ...staging, STAGING_CHECKOUT_ORDERS: '1', SUPABASE_URL: 'https://euoannuvovsbwxjqnriw.supabase.co' }); expect(checkoutOrdersConfiguration()).toBeNull();
    set({ ...staging, STAGING_CHECKOUT_ORDERS: '1', SUPABASE_SERVICE_ROLE_KEY: undefined }); expect(checkoutOrdersConfiguration()).toBeNull();
    set({ ...staging, STAGING_CHECKOUT_ORDERS: '1', SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_test' }); expect(checkoutOrdersConfiguration()).toBeNull();
    for (const k of Object.keys(env)) if (!(k in saved)) delete env[k];
    Object.assign(env, saved);
  });
});

describe('checkout button gate', () => {
  it('is enabled only by the explicit checkout flag or an available payment configuration', () => {
    expect(canPlaceOrder(true, false)).toBe(true);
    expect(canPlaceOrder(false, true)).toBe(true);
    expect(canPlaceOrder(false, false)).toBe(false);
  });
});
