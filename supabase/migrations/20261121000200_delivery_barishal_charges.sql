begin;
-- Delivery charges move from Dhaka to Barishal (owner decision, 2026-11-21).
--
-- NEW RULES:
--   * Inside Barishal City = Barishal Sadar upazila of Barishal district:
--     1-2 working days, ৳50 (5000 minor).
--   * Outside Barishal City = everywhere else in Bangladesh, including the
--     rest of Barishal division: 3-5 working days, ৳140 (14000 minor).
--   * Free delivery is REMOVED entirely: no threshold, no waiver. Every
--     order pays 50 or 140.
--   * "Inside Dhaka" is removed entirely — from the zone rule, the config
--     columns and the values. The old inside-Dhaka advance (70) and the old
--     card figure (80) are both gone; the charge and the advance are the
--     same number again (50 / 140).
--
-- HOW: private.checkout_settings columns are renamed (the app never reads
-- them by name; only these migrations reference them) and re-valued, the
-- free-delivery threshold column is dropped, and place_checkout_order is
-- replaced with the 20261118000100 (coupon-aware, 7-argument) version
-- verbatim except for the delivery-charge block. The coupon block, the
-- discounted total, grants and behaviour are unchanged.
--
-- APPLY ORDER: this migration must be applied AFTER 20261118000100. Do NOT
-- apply 20261118000100 after this one — it still carries the old Dhaka
-- charge logic and would revert the zone rule. Apply only through an
-- explicit, owner-approved migration run, after a schema-drift check.

-- 1. Rename the zone columns and re-value them; drop the free-delivery threshold.
alter table private.checkout_settings
  rename column delivery_inside_dhaka_minor to delivery_inside_barishal_city_minor;
alter table private.checkout_settings
  rename column delivery_outside_dhaka_minor to delivery_outside_barishal_city_minor;
update private.checkout_settings
  set delivery_inside_barishal_city_minor = 5000,
      delivery_outside_barishal_city_minor = 14000;

-- 2. Replace place_checkout_order (both signatures dropped first: the DB
-- may hold the 6-argument version if 20261118000100 was never applied, or
-- the 7-argument one if it was). Body is 20261118000100 verbatim except
-- the delivery-charge block below.
drop function if exists public.place_checkout_order(text, jsonb, text, text, text, jsonb, text);
drop function if exists public.place_checkout_order(text, jsonb, text, text, text, jsonb);

create function public.place_checkout_order(raw_token text, delivery jsonb, payment_method text,
 order_note text default null, client_key text default null, expected_items jsonb default null,
 p_coupon_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; cfg private.checkout_settings; item record; info record; stock record;
 new_order uuid := gen_random_uuid(); number integer; subtotal bigint := 0; delivery_charge bigint; total bigint;
 now_ts timestamptz := clock_timestamp(); lines integer := 0; after_stock integer; units integer; subject text; v_phone text;
 v_division text; v_district text; v_area text; v_address text; v_note text;
 discount bigint := 0; coupon_id uuid; validation jsonb; clean_code text;
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
 foreach sig in array array['public.place_checkout_order(text,jsonb,text,text,text,jsonb,text)'] loop
  execute format('revoke all on function %s from public, anon', sig);
  execute format('grant execute on function %s to authenticated', sig);
  if exists(select 1 from pg_roles where rolname = 'service_role') then
   execute format('grant execute on function %s to service_role', sig);
  end if;
 end loop;
end $$;

do $$
begin
 if exists(select 1 from pg_roles where rolname = 'service_role') then
  grant execute on function public.validate_coupon(text, uuid, text, bigint) to service_role;
 end if;
end $$;

-- 3. The free-delivery threshold no longer exists: drop it now that no
-- function references it.
alter table private.checkout_settings drop column free_delivery_threshold_minor;

commit;
