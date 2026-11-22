begin;
-- MERGED MIGRATION — payment submissions + Barishal delivery charges.
-- Supersedes BOTH 20261121000100_payment_submissions.sql and
-- 20261121000200_delivery_barishal_charges.sql. NEVER apply either of
-- those two files after this one, and NEVER apply either one on its own
-- once this one is applied. Recommended repo name for this merged file:
--   20261121000300_payment_submissions_barishal_charges.sql
--
-- WHY A MERGE IS REQUIRED (verified 2026-11-21 from both files):
--  * 20261121000100 alone creates the 8-arg place_checkout_order whose
--    delivery-charge block reads the OLD columns
--    delivery_inside_dhaka_minor / delivery_outside_dhaka_minor and
--    free_delivery_threshold_minor. 20261121000200 renames the first two
--    and DROPS the third. Applying payment after delivery would leave a
--    function that fails on the first checkout (column does not exist).
--  * 20261121000200 alone creates only the 7-arg function (coupon, no
--    p_payment) and drops free_delivery_threshold_minor, which the
--    8-arg function still references. Applying delivery after payment
--    breaks the live 8-arg checkout path the same way, and the Barishal
--    rule would be silently bypassed by the surviving 8-arg function.
--  * This merged version is the payment file VERBATIM except: settings
--    renames + re-value, the Barishal delivery-charge block, and the
--    threshold-column drop. Coupon handling (p_coupon_code) and payment
--    handling (p_payment) are both present in the single 8-arg function.
--
-- WHAT THIS MIGRATION ADDS (from 20261121000100, unchanged):
--  1. public.payment_submissions — one row per advance payment, linked
--     to its order. RLS: staff read only (orders.read); writes ONLY
--     through the security-definer functions below, never from a client.
--  2. Backfill — existing orders whose note carries a payment line get
--     a submission row (advance = the stored delivery charge).
--     Idempotent: orders that already have a submission are skipped,
--     and a TxID already recorded for another order is not duplicated.
--     Guard added after the staging apply: the backfill WHERE also
--     requires the regexp match to be non-null (m is not null), so
--     orders whose note carries no payment line are skipped instead
--     of failing the insert. Staging data is unaffected (0 rows
--     backfilled there). The sender pattern also accepts +880
--     (normalized to 0 on insert) after the production apply failed
--     on AA-10011, whose note carries a +880 sender number.
--  3. place_checkout_order gains p_payment jsonb (param 8) alongside
--     p_coupon_code (param 7). Submission row inserted in the same
--     transaction as the order, advance = server-computed delivery
--     charge (never a browser-sent amount). A TxID already used by
--     another live submission refuses the order with CK013.
--  4. admin_get_order_notification_for_server returns the latest
--     submission as 'payment_submission' (null when none). Same
--     signature, same grants.
--  5. admin_verify_payment_submission(p_submission_id, p_verdict) —
--     staff-only (orders.manage, permission + MFA AAL2). 'verified'
--     marks the submission verified and flips orders.payment_status to
--     paid (only when still unpaid); 'rejected' only marks the
--     submission. Either way an admin_audit_logs row
--     ('order.payment_verified') is written.
-- WHAT THIS MIGRATION CHANGES (from 20261121000200):
--  6. Delivery charges move to Barishal: Inside Barishal City
--     (Barishal Sadar upazila of Barishal district) = 5000 minor
--     (1-2 working days); everywhere else = 14000 minor (3-5 days).
--     Free delivery is REMOVED entirely: no threshold, no waiver.
--     "Inside Dhaka" is gone from the zone rule, the config columns
--     and the values.
--
-- PREREQUISITE: 20261115000400_admin_panel_coupons.sql (coupons +
-- coupon_redemptions tables, validate_coupon, admin coupon RPCs) MUST
-- already be applied — the function body below calls
-- public.validate_coupon and inserts into public.coupon_redemptions.
-- Confirm it in the drift check; if it is missing, apply that file
-- first, then this one.
--
-- APPLY: staging first, then production, only through an explicit,
-- owner-approved migration run, after the drift check. One transaction
-- (begin; ... commit;); on any error nothing is applied.
-- The app keeps writing the "[Advance payment]" note line until the
-- new admin UI is live-verified, so the note remains the fallback.

-- 0. Rename the zone columns and re-value them (delivery 20261121000200 §1).
alter table private.checkout_settings
  rename column delivery_inside_dhaka_minor to delivery_inside_barishal_city_minor;
alter table private.checkout_settings
  rename column delivery_outside_dhaka_minor to delivery_outside_barishal_city_minor;
update private.checkout_settings
  set delivery_inside_barishal_city_minor = 5000,
      delivery_outside_barishal_city_minor = 14000;

create table public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null check (provider in ('bkash', 'nagad')),
  transaction_id text not null check (length(transaction_id) between 1 and 128
    and transaction_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  sender_number text not null check (sender_number ~ '^01[3-9][0-9]{8}$'),
  advance_minor bigint not null check (advance_minor >= 0),
  status text not null default 'submitted'
    check (status in ('submitted', 'verified', 'rejected')),
  submitted_at timestamptz not null default clock_timestamp(),
  verified_at timestamptz,
  verified_by uuid,
  idempotency_key uuid not null unique
);
create index payment_submissions_order_idx on public.payment_submissions(order_id);
create index payment_submissions_status_idx on public.payment_submissions(status);
-- One live submission per TxID per provider: a payment can never back
-- two orders. A rejected submission frees its TxID for a corrected
-- re-submission.
create unique index payment_submissions_txid_key
  on public.payment_submissions(provider, transaction_id)
  where status <> 'rejected';

alter table public.payment_submissions enable row level security;
revoke all on public.payment_submissions from public, anon, authenticated;
grant select on public.payment_submissions to authenticated;
create policy payment_submissions_staff_read on public.payment_submissions for select to authenticated
  using ((select private.has_permission('orders.read')));

-- Backfill: parse the payment line out of existing order notes. The line
-- format is fixed by formatPaymentNoteLine in src/lib/manual-payment.ts:
-- "[Advance payment] bKash TxID <txid>, sender <phone>." (the customer
-- The sender may be in 01-format or international +880-format (checkout
-- accepts both); +880 is normalized to 01-format on insert because the
-- sender_number CHECK requires 01-format.
insert into public.payment_submissions(order_id, provider, transaction_id, sender_number, advance_minor, status, submitted_at, idempotency_key)
select o.id, lower(m[1]), m[2], regexp_replace(m[3], '^\+880', '0'), o.delivery_charge_minor, 'submitted', o.placed_at, gen_random_uuid()
from public.orders o
cross join lateral regexp_match(o.note,
  '^\[Advance payment\] (bKash|Nagad) TxID ([A-Za-z0-9][A-Za-z0-9._-]*), sender ((?:\+880|0)1[3-9][0-9]{8})') as m
where o.note is not null
  and m is not null
  and not exists (select 1 from public.payment_submissions ps where ps.order_id = o.id)
on conflict (provider, transaction_id) where status <> 'rejected' do nothing;

-- place_checkout_order, eighth parameter p_payment. Body is the
-- 20261118000100 coupon version verbatim except for the payment block
-- and the declarations it needs.
drop function if exists public.place_checkout_order(text, jsonb, text, text, text, jsonb, text);
drop function if exists public.place_checkout_order(text, jsonb, text, text, text, jsonb);

create function public.place_checkout_order(raw_token text, delivery jsonb, payment_method text,
 order_note text default null, client_key text default null, expected_items jsonb default null,
 p_coupon_code text default null, p_payment jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; cfg private.checkout_settings; item record; info record; stock record;
 new_order uuid := gen_random_uuid(); number integer; subtotal bigint := 0; delivery_charge bigint; total bigint;
 now_ts timestamptz := clock_timestamp(); lines integer := 0; after_stock integer; units integer; subject text; v_phone text;
 v_division text; v_district text; v_area text; v_address text; v_note text;
 discount bigint := 0; coupon_id uuid; validation jsonb; clean_code text;
 v_provider text; v_txid text; v_sender text; v_idem text;
begin
 subject := private.checkout_caller_subject(client_key);
 s := private.locked_checkout_session(raw_token);

 -- Idempotency: a session that already produced an order returns that order. A retry with the
 -- same items succeeds at any later time. A different cart is refused, and the server then starts
 -- a new checkout. Retries never consume the rate limit.
 if s.order_id is not null then
  if expected_items is not null and not private.same_checkout_items(s.order_id, expected_items) then
   raise exception 'This checkout already produced an order with different items' using errcode = 'CK004';
  end if;
  return private.checkout_order_result(s.order_id, true);
 end if;

 perform private.require_orders_enabled();
 select * into strict cfg from private.checkout_settings;
 if s.lifecycle_status not in ('active','abandoned') then
  raise exception 'Checkout session is no longer active' using errcode = '22023';
 end if;

 v_division := btrim(coalesce(delivery->>'division', '')); v_district := btrim(coalesce(delivery->>'district', ''));
 v_area := btrim(coalesce(delivery->>'area', '')); v_address := btrim(coalesce(delivery->>'address_line', ''));
 v_note := nullif(btrim(coalesce(order_note, '')), '');
 if delivery is null or jsonb_typeof(delivery) <> 'object'
  or length(v_area) not between 1 and 120 or length(v_address) not between 8 and 500
  or length(coalesce(v_note, 'x')) > 500 then
  raise exception 'Enter a complete delivery address' using errcode = '22023';
 end if;
 if not exists(select 1 from private.delivery_locations l where l.division = v_division and l.district = v_district) then
  raise exception 'The district does not belong to the division' using errcode = 'CK007';
 end if;
 if payment_method is distinct from 'cod' then
  raise exception 'Only Cash on Delivery is available' using errcode = '22023';
 end if;

 perform private.consume_checkout_rate('place', subject, interval '1 hour', cfg.orders_per_client_per_hour);

 v_phone := private.normalize_bd_phone(s.phone);
 perform pg_advisory_xact_lock(hashtextextended('phone:' || v_phone, 0));
 if (select count(*) from public.orders o where o.phone = v_phone and o.placed_at > clock_timestamp() - interval '1 day')
    >= cfg.orders_per_phone_per_day then
  raise exception 'Too many orders for this mobile number today' using errcode = 'CK006';
 end if;

 select coalesce(sum(quantity), 0) into units from public.checkout_items where checkout_session_id = s.id;
 if units > cfg.max_units_per_order then
  raise exception 'Too many items in one order' using errcode = 'CK010';
 end if;

 -- Items come from the database in a fixed order, so concurrent orders cannot deadlock.
 for item in select * from public.checkout_items where checkout_session_id = s.id order by variant_id loop
  select * into info from private.orderable_variant(item.variant_id);
  if not found or not info.orderable then
   raise exception 'A product in your order is no longer available' using errcode = 'CK001';
  end if;
  if item.quantity <> 1 then
   raise exception 'Only one of each item is available' using errcode = 'CK011';
  end if;
  select * into stock from public.inventory where variant_id = item.variant_id for update;
  if not found or stock.available < item.quantity then
   raise exception 'Not enough stock' using errcode = 'CK002';
  end if;
  update public.checkout_items set regular_price_minor = info.regular_price_minor,
    unit_price_minor = info.unit_price_minor, price_snapshot_at = now_ts where id = item.id;
  subtotal := subtotal + info.unit_price_minor * item.quantity; lines := lines + 1;
 end loop;
 if lines = 0 then raise exception 'Your checkout is empty' using errcode = 'CK003'; end if;

 -- Coupon: validated by public.validate_coupon against the server-computed
 -- subtotal. The coupon row is locked so concurrent redemptions cannot race
 -- the usage limits. A coupon that no longer applies refuses the order
 -- (CK009) instead of placing it at full price.
 if p_coupon_code is not null and btrim(p_coupon_code) <> '' then
  clean_code := upper(btrim(p_coupon_code));
  select id into coupon_id from public.coupons where code = clean_code for update;
  if coupon_id is null then
   raise exception 'Coupon could not be applied' using errcode = 'CK009';
  end if;
  validation := public.validate_coupon(clean_code, s.user_id, v_phone, subtotal);
  if not coalesce((validation->>'valid')::boolean, false) then
   raise exception 'Coupon could not be applied' using errcode = 'CK009';
  end if;
  discount := coalesce((validation->>'discount_minor')::bigint, 0);
 end if;

 -- Delivery charge: Barishal City is Barishal Sadar upazila of Barishal
 -- district; everywhere else in Bangladesh pays the outside charge. No
 -- free-delivery threshold: every order pays 50 or 140.
 delivery_charge := case
  when v_division = 'Barishal' and v_district = 'Barishal' and v_area = 'Barishal Sadar' then cfg.delivery_inside_barishal_city_minor
  else cfg.delivery_outside_barishal_city_minor end;
 total := subtotal + delivery_charge - discount;

 insert into public.orders(id, checkout_session_id, user_id, customer_name, phone, email, division, district, area, address_line, note,
   payment_method, subtotal_minor, delivery_charge_minor, discount_minor, total_minor, placed_at)
 values (new_order, s.id, s.user_id, s.customer_name, v_phone, s.email, v_division, v_district,
   v_area, v_address, v_note, 'cod', subtotal, delivery_charge, discount, total, now_ts);

 -- One redemption per order: the partial unique index on
 -- (coupon_id, order_id) makes a double record impossible.
 if coupon_id is not null then
  insert into public.coupon_redemptions(coupon_id, user_id, phone, order_id)
  values (coupon_id, s.user_id, v_phone, new_order);
 end if;

 -- Advance payment: the TxID + sender number the customer submitted with
 -- the order, recorded as a structured row in the same transaction as
 -- the order itself. The amount is the server-computed delivery charge
 -- (the advance), never a browser-sent amount. A malformed payment
 -- object is ignored here — the note line still carries the details —
 -- but a TxID already used by another live submission refuses the
 -- order (CK013), so one payment can never back two orders. A reused
 -- idempotency key is ignored: the session replay path above already
 -- returns the original order, so this only fires for a genuinely
 -- repeated key.
 if p_payment is not null and jsonb_typeof(p_payment) = 'object' then
  v_provider := lower(btrim(coalesce(p_payment->>'provider', '')));
  v_txid := btrim(coalesce(p_payment->>'transaction_id', ''));
  v_sender := btrim(coalesce(p_payment->>'sender_number', ''));
  v_idem := btrim(coalesce(p_payment->>'idempotency_key', ''));
  if v_provider in ('bkash', 'nagad')
   and v_txid ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' and length(v_txid) <= 128
   and v_sender ~ '^01[3-9][0-9]{8}$'
   and v_idem ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   begin
    insert into public.payment_submissions(order_id, provider, transaction_id, sender_number, advance_minor, status, submitted_at, idempotency_key)
    values (new_order, v_provider, v_txid, v_sender, delivery_charge, 'submitted', now_ts, v_idem::uuid)
    on conflict (idempotency_key) do nothing;
   exception when unique_violation then
    raise exception 'This Transaction ID was already used for another order' using errcode = 'CK013';
   end;
  end if;
 end if;

 number := private.assign_customer_order_number(new_order);
 update public.orders set order_number = number where id = new_order;

 insert into public.order_items(order_id, product_id, variant_id, product_name, sku, size, color,
   unit_price_minor, quantity, line_total_minor)
 select new_order, c.product_id, c.variant_id, p.name, v.sku, v.size, v.color,
   c.unit_price_minor, c.quantity, c.unit_price_minor * c.quantity
 from public.checkout_items c join public.product_variants v on v.id = c.variant_id
 join public.products p on p.id = c.product_id where c.checkout_session_id = s.id;

 for item in select * from public.checkout_items where checkout_session_id = s.id order by variant_id loop
  update public.inventory set on_hand = on_hand - item.quantity
   where variant_id = item.variant_id and available >= item.quantity returning on_hand into after_stock;
  if not found then raise exception 'Not enough stock' using errcode = 'CK002'; end if;
  insert into public.inventory_movements(variant_id, actor_id, delta, on_hand_after, reason)
  values (item.variant_id, null, -item.quantity, after_stock, 'Order ' || number);
  update public.thrift_intake set stock_quantity = 0 where product_id = item.product_id;
 end loop;

 perform private.complete_checkout_session(s.id, new_order);
 return private.checkout_order_result(new_order, false);
end $$;

-- Grants for the new signature, mirroring 20261113000300 section 8: no
-- anonymous access, customers and the trusted server only.
do $$
declare sig text;
begin
 foreach sig in array array['public.place_checkout_order(text,jsonb,text,text,text,jsonb,text,jsonb)'] loop
  execute format('revoke all on function %s from public, anon', sig);
  execute format('grant execute on function %s to authenticated', sig);
  if exists(select 1 from pg_roles where rolname = 'service_role') then
   execute format('grant execute on function %s to service_role', sig);
  end if;
 end loop;
end $$;

-- Order notification read: same payload as 20261119000100, plus the
-- latest advance-payment submission for the order (null when there is
-- none). Same signature, same service-role-only grants.
create or replace function public.admin_get_order_notification_for_server(p_order_number integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Order notification read is not allowed' using errcode = '42501';
  end if;
  select * into o from public.orders where order_number = p_order_number;
  if not found then
    raise exception 'Order not found' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'customer_name', o.customer_name,
    'phone', o.phone,
    'email', o.email,
    'division', o.division,
    'district', o.district,
    'area', o.area,
    'address_line', o.address_line,
    'subtotal_minor', o.subtotal_minor,
    'delivery_charge_minor', o.delivery_charge_minor,
    'discount_minor', o.discount_minor,
    'total_minor', o.total_minor,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'payment_submission', (
      select jsonb_build_object(
        'provider', s.provider,
        'transaction_id', s.transaction_id,
        'sender_number', s.sender_number,
        'advance_minor', s.advance_minor,
        'status', s.status,
        'submitted_at', s.submitted_at)
      from public.payment_submissions s where s.order_id = o.id
      order by s.submitted_at desc, s.id desc limit 1
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_name', i.product_name,
        'size', i.size,
        'color', i.color,
        'quantity', i.quantity,
        'unit_price_minor', i.unit_price_minor,
        'line_total_minor', i.line_total_minor
      ) order by i.product_name, i.size, i.color), '[]'::jsonb)
      from public.order_items i where i.order_id = o.id
    )
  );
end $$;
revoke all on function public.admin_get_order_notification_for_server(integer) from public, anon, authenticated;
grant execute on function public.admin_get_order_notification_for_server(integer) to service_role;

-- Verify or reject one advance-payment submission. 'verified' marks the
-- submission verified and flips the order's payment_status to paid
-- (only when it is still unpaid); 'rejected' only marks the
-- submission, freeing its TxID for a corrected re-submission. Either
-- way an audit-log row is written. A submission that was already
-- decided is refused, and the row lock makes concurrent decisions
-- serialize. Pattern mirrors public.admin_set_payment_status
-- (20261116000100): require_admin('orders.manage'), null checks,
-- allowlist check, SELECT ... FOR UPDATE, audit insert.
create function public.admin_verify_payment_submission(p_submission_id uuid, p_verdict text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.payment_submissions;
  o public.orders;
  new_payment_status text;
begin
  perform private.require_admin('orders.manage');
  if p_submission_id is null or p_verdict is null then
    raise exception 'Invalid payment verification request' using errcode = '22023';
  end if;
  if p_verdict not in ('verified', 'rejected') then
    raise exception 'Invalid payment verdict' using errcode = '22023';
  end if;
  select * into s from public.payment_submissions where id = p_submission_id for update;
  if not found then raise exception 'Payment submission not found' using errcode = '22023'; end if;
  if s.status <> 'submitted' then
    raise exception 'This payment was already decided' using errcode = '22023';
  end if;
  select * into o from public.orders where id = s.order_id for update;
  if not found then raise exception 'Order not found' using errcode = '22023'; end if;
  update public.payment_submissions
    set status = p_verdict, verified_at = clock_timestamp(), verified_by = auth.uid()
    where id = p_submission_id;
  new_payment_status := o.payment_status;
  if p_verdict = 'verified' and o.payment_status = 'unpaid' then
    -- guard_order_update permits payment_status writes; status is untouched.
    update public.orders set payment_status = 'paid' where id = s.order_id;
    new_payment_status := 'paid';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'order.payment_verified', s.order_id,
    jsonb_build_object('before', 'submitted', 'after', p_verdict,
      'submission_id', p_submission_id, 'transaction_id', s.transaction_id));
  return jsonb_build_object('submission_id', p_submission_id, 'order_id', s.order_id,
    'status', p_verdict, 'payment_status', new_payment_status);
end $$;
revoke all on function public.admin_verify_payment_submission(uuid, text) from public, anon;
grant execute on function public.admin_verify_payment_submission(uuid, text) to authenticated;

-- Verification history must be readable by orders staff (same shape as
-- the order.payment_status_changed policy in 20261116000100). Admits
-- orders.read holders (MFA AAL2) for the payment-verification action
-- only; widens nothing else.
create policy admin_audit_logs_orders_payment_verified_read on public.admin_audit_logs for select to authenticated
  using (auth.jwt()->>'aal' = 'aal2'
    and action = 'order.payment_verified'
    and (select private.has_permission('orders.read')));

-- The free-delivery threshold no longer exists: drop it now that the
-- replaced function no longer references it (delivery 20261121000200 §3).
alter table private.checkout_settings drop column free_delivery_threshold_minor;

commit;

