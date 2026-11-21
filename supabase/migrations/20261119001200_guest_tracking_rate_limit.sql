begin;
-- Guest order tracking rate limit (follow-up to 20261119000500).
--
-- WHY: the guest lookup takes an order number (5 digits, 10000-99999)
-- plus a phone. The phone is the second factor, but nothing stopped
-- automated bulk probing: unlimited lookups against any order number
-- with any phone. This adds a generous rate limit so a real customer
-- checking their own order a few times is never blocked, while bulk
-- guessing is throttled.
--
-- HOW: reuses the existing checkout rate ledger
-- (private.consume_checkout_rate, 20261113000300) with a new action
-- 'track', counted separately from checkout 'start'/'write'/'place':
--   * per order number: 10 lookups / 1 hour  ('order:<number>')
--   * per phone:        30 lookups / 1 hour  ('phone:<number>')
-- The per-phone limit stops one phone probing many order numbers; the
-- per-order limit stops many phones hammering one order number.
-- The ledger's action CHECK is widened to include 'track' (the
-- constraint is found by its definition, not by an assumed name).
--
-- VOLATILITY: the original function was STABLE, but writing to the
-- rate ledger is a side effect, and a STABLE function cannot write —
-- so the replacement drops STABLE (now VOLATILE, the default). The
-- signature, grants, payload and null-on-miss behaviour are unchanged.
-- On limit, consume_checkout_rate raises CK005 ('Too many checkout
-- requests'); the app's tracking path treats any RPC failure as
-- "Order not found" today, so a rate-limited lookup shows that state
-- rather than a distinct message — a real customer at 10/hour on one
-- order or 30/hour on one phone will not reach it. A distinct
-- "too many attempts" message is a small follow-up in the app.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run, after a schema-drift check.

-- 1. Widen the rate ledger's action check to include 'track'.
do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'private.checkout_rate_events'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%start%';
  if v_constraint is not null then
    execute format('alter table private.checkout_rate_events drop constraint %I', v_constraint);
  end if;
end $$;
alter table private.checkout_rate_events
  add constraint checkout_rate_events_action_check
  check (action in ('start', 'write', 'place', 'track'));

-- 2. Same lookup, now rate-limited. CREATE OR REPLACE keeps the
--    existing grants; the revoke/grant below restates them verbatim.
create or replace function public.customer_track_order_by_phone(p_order_number integer, p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_phone text;
  o public.orders;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Guest order tracking is not allowed' using errcode = '42501';
  end if;
  if p_order_number is null or p_order_number < 10000 or p_order_number > 99999 then
    return null;
  end if;
  v_phone := private.normalize_bd_phone(p_phone);
  if v_phone !~ '^01[3-9][0-9]{8}$' then
    return null;
  end if;
  perform private.consume_checkout_rate('track', 'order:' || p_order_number::text, interval '1 hour', 10);
  perform private.consume_checkout_rate('track', 'phone:' || v_phone, interval '1 hour', 30);
  select * into o from public.orders
    where order_number = p_order_number and phone = v_phone;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'customer_name', o.customer_name,
      'phone', o.phone,
      'email', o.email,
      'division', o.division,
      'district', o.district,
      'area', o.area,
      'address_line', o.address_line,
      'payment_method', o.payment_method,
      'payment_status', o.payment_status,
      'status', o.status,
      'subtotal_minor', o.subtotal_minor,
      'delivery_charge_minor', o.delivery_charge_minor,
      'discount_minor', o.discount_minor,
      'total_minor', o.total_minor,
      'placed_at', o.placed_at
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'order_id', i.order_id,
        'product_id', i.product_id,
        'variant_id', i.variant_id,
        'product_name', i.product_name,
        'size', i.size,
        'color', i.color,
        'unit_price_minor', i.unit_price_minor,
        'quantity', i.quantity,
        'line_total_minor', i.line_total_minor,
        'created_at', i.created_at
      ) order by i.created_at, i.id), '[]'::jsonb)
      from public.order_items i where i.order_id = o.id
    )
  );
end $$;
revoke all on function public.customer_track_order_by_phone(integer, text) from public, anon, authenticated;
grant execute on function public.customer_track_order_by_phone(integer, text) to service_role;

commit;
