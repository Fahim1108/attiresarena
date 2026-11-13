begin;
-- Phase 2.5: checkout security and reliability remediation.
--
-- Supersedes the ACCESS MODEL of 20261113000100 and 20261113000200 (neither has been applied
-- to Staging or Production). Those files stay unchanged for history.
--
--  * Guests (anon) lose EXECUTE on every checkout RPC. The Next.js server calls them with the
--    service_role key from server-only configuration. Customers (authenticated) keep access
--    with auth.uid(). Anonymous REST callers can no longer bypass server rate limits.
--  * Rate limits and the order-placement gate live in the database. They cannot be disabled
--    by a client.
--  * Ordering is disabled by default in the database (private.checkout_settings.orders_enabled).
--    Production migrations leave it false; enabling it is a separate, explicit Staging change.
--  * Eligibility matches the public storefront feed: published, verified thrift garments only.
--  * District/division pairs are checked against an authoritative table.
--  * Orders are idempotent per checkout session at the database level, with no time window.

-- 1. Authoritative delivery locations (rows generated from src/data/bangladesh.ts).
create table private.delivery_locations (
 division text not null check (division in ('Barishal','Chattogram','Dhaka','Khulna','Mymensingh','Rajshahi','Rangpur','Sylhet')),
 district text not null check (length(btrim(district)) between 1 and 80),
 primary key (division, district)
);
insert into private.delivery_locations(division, district) values
('Dhaka','Dhaka'),
('Dhaka','Faridpur'),
('Dhaka','Gazipur'),
('Dhaka','Gopalganj'),
('Dhaka','Kishoreganj'),
('Dhaka','Madaripur'),
('Dhaka','Manikganj'),
('Dhaka','Munshiganj'),
('Dhaka','Narayanganj'),
('Dhaka','Narsingdi'),
('Dhaka','Rajbari'),
('Dhaka','Shariatpur'),
('Dhaka','Tangail'),
('Chattogram','Bandarban'),
('Chattogram','Brahmanbaria'),
('Chattogram','Chandpur'),
('Chattogram','Chattogram'),
('Chattogram','Cox''s Bazar'),
('Chattogram','Cumilla'),
('Chattogram','Feni'),
('Chattogram','Khagrachhari'),
('Chattogram','Lakshmipur'),
('Chattogram','Noakhali'),
('Chattogram','Rangamati'),
('Rajshahi','Bogura'),
('Rajshahi','Chapai Nawabganj'),
('Rajshahi','Joypurhat'),
('Rajshahi','Naogaon'),
('Rajshahi','Natore'),
('Rajshahi','Pabna'),
('Rajshahi','Rajshahi'),
('Rajshahi','Sirajganj'),
('Khulna','Bagerhat'),
('Khulna','Chuadanga'),
('Khulna','Jashore'),
('Khulna','Jhenaidah'),
('Khulna','Khulna'),
('Khulna','Kushtia'),
('Khulna','Magura'),
('Khulna','Meherpur'),
('Khulna','Narail'),
('Khulna','Satkhira'),
('Barishal','Barguna'),
('Barishal','Barishal'),
('Barishal','Bhola'),
('Barishal','Jhalokati'),
('Barishal','Patuakhali'),
('Barishal','Pirojpur'),
('Sylhet','Habiganj'),
('Sylhet','Moulvibazar'),
('Sylhet','Sunamganj'),
('Sylhet','Sylhet'),
('Rangpur','Dinajpur'),
('Rangpur','Gaibandha'),
('Rangpur','Kurigram'),
('Rangpur','Lalmonirhat'),
('Rangpur','Nilphamari'),
('Rangpur','Panchagarh'),
('Rangpur','Rangpur'),
('Rangpur','Thakurgaon'),
('Mymensingh','Jamalpur'),
('Mymensingh','Mymensingh'),
('Mymensingh','Netrokona'),
('Mymensingh','Sherpur');
alter table private.delivery_locations enable row level security;
revoke all on private.delivery_locations from public, anon, authenticated;

alter table public.orders add constraint orders_delivery_location_fkey
 foreign key (division, district) references private.delivery_locations(division, district);

-- 2. Settings: every tunable value lives here.
alter table private.checkout_settings
 add column orders_enabled boolean not null default false,
 add column sessions_per_client_per_hour integer not null default 20 check (sessions_per_client_per_hour between 1 and 100000),
 add column writes_per_client_per_minute integer not null default 60 check (writes_per_client_per_minute between 1 and 100000),
 add column orders_per_client_per_hour integer not null default 5 check (orders_per_client_per_hour between 1 and 100000),
 add column orders_per_phone_per_day integer not null default 2 check (orders_per_phone_per_day between 1 and 100000),
 add column max_units_per_order integer not null default 10 check (max_units_per_order between 1 and 100);

-- 3. Rate-limit ledger. Rows are internal; the subject is a hash or user id, never a raw IP.
create table private.checkout_rate_events (
 id bigint generated always as identity primary key,
 action text not null check (action in ('start','write','place')),
 subject text not null check (length(subject) between 1 and 200),
 occurred_at timestamptz not null default clock_timestamp()
);
create index checkout_rate_events_lookup_idx on private.checkout_rate_events(action, subject, occurred_at);
create index checkout_rate_events_time_idx on private.checkout_rate_events(occurred_at);
alter table private.checkout_rate_events enable row level security;
revoke all on private.checkout_rate_events from public, anon, authenticated;

-- 4. Caller identity. A customer is identified by auth.uid(). The trusted server is identified
--    by the service_role JWT, and then the client key it supplies is used. Anyone else is refused.
create function private.checkout_caller_subject(client_key text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is not null then
  return 'user:' || auth.uid()::text;
 end if;
 if auth.role() = 'service_role' then
  if client_key is null or length(btrim(client_key)) not between 8 and 128 then
   raise exception 'Trusted client identity is required' using errcode = '22023';
  end if;
  return 'client:' || btrim(client_key);
 end if;
 raise exception 'Checkout requires the trusted server or a signed-in customer' using errcode = '42501';
end $$;
revoke all on function private.checkout_caller_subject(text) from public, anon, authenticated;

create function private.consume_checkout_rate(p_action text, p_subject text, p_window interval, p_limit integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
 -- Serialises concurrent requests from the same subject so the count cannot be raced.
 perform pg_advisory_xact_lock(hashtextextended(p_action || ':' || p_subject, 0));
 delete from private.checkout_rate_events where occurred_at < clock_timestamp() - interval '2 days';
 if (select count(*) from private.checkout_rate_events
      where action = p_action and subject = p_subject and occurred_at > clock_timestamp() - p_window) >= p_limit then
  raise exception 'Too many checkout requests' using errcode = 'CK005';
 end if;
 insert into private.checkout_rate_events(action, subject) values (p_action, p_subject);
end $$;
revoke all on function private.consume_checkout_rate(text, text, interval, integer) from public, anon, authenticated;

create function private.require_orders_enabled() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
 if not coalesce((select orders_enabled from private.checkout_settings), false) then
  raise exception 'Ordering is not enabled' using errcode = 'CK008';
 end if;
end $$;
revoke all on function private.require_orders_enabled() from public, anon, authenticated;

-- 5. Eligibility: exactly the storefront's public feed (public.published_thrift_catalogue),
--    plus a positive price. Non-thrift products are never orderable: the storefront never shows them.
create or replace function private.orderable_variant(target_variant uuid)
returns table(product_id uuid, product_name text, sku text, size text, color text,
 regular_price_minor bigint, unit_price_minor bigint, is_thrift boolean, orderable boolean)
language sql stable security definer set search_path = '' as $$
 select p.id, p.name, v.sku, v.size, v.color, i.price_minor, i.price_minor, true,
  (p.status = 'published' and v.active and i.size_verified and i.details_verified
   and i.actual_size is not null and i.actual_color is not null
   and v.size = i.actual_size and v.color = i.actual_color
   and i.price_minor > 0 and i.stock_quantity > 0 and s.available > 0)
 from public.product_variants v
 join public.products p on p.id = v.product_id
 join public.thrift_intake i on i.product_id = p.id
 join public.inventory s on s.variant_id = v.id
 where v.id = target_variant;
$$;

create or replace function private.same_checkout_items(target_order uuid, expected jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
 select coalesce(
  (select jsonb_agg(jsonb_build_object('variant_id', i.variant_id::text, 'quantity', i.quantity) order by i.variant_id::text)
     from public.order_items i where i.order_id = target_order)
  =
  (select jsonb_agg(jsonb_build_object('variant_id', lower(e->>'variant_id'), 'quantity', (e->>'quantity')::integer) order by lower(e->>'variant_id'))
     from jsonb_array_elements(expected) e),
  false);
$$;
revoke all on function private.same_checkout_items(uuid, jsonb) from public, anon, authenticated;

-- 6. Replace functions whose signatures change. Nothing has been deployed to Staging yet.
drop function public.start_checkout_session(text, text, text);
drop function public.update_checkout_contact(text, text, text, text);
drop function public.set_checkout_items(text, jsonb);
drop function public.place_checkout_order(text, jsonb, text, text);
drop function public.add_checkout_item(text, uuid, integer);

-- 7. Orders: the checkout session is the idempotency key, enforced by a unique column.
alter table public.orders add column checkout_session_id uuid unique references public.checkout_sessions(id) on delete restrict;

create function public.start_checkout_session(customer_name text, phone text, email text default null, client_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare raw_token text; now_ts timestamptz := clock_timestamp(); uid uuid; expires timestamptz; clean_email text; ttl interval; cfg private.checkout_settings;
 subject text;
begin
 subject := private.checkout_caller_subject(client_key);
 perform private.require_orders_enabled();
 select * into strict cfg from private.checkout_settings;
 perform private.consume_checkout_rate('start', subject, interval '1 hour', cfg.sessions_per_client_per_hour);
 ttl := cfg.session_ttl;
 if auth.uid() is not null and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false then uid := auth.uid(); end if;
 clean_email := nullif(lower(btrim(coalesce(email, ''))), '');
 raw_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
 begin
  insert into public.checkout_sessions(user_id, token_hash, customer_name, phone, email, started_at, last_activity_at, expires_at)
  values (uid, private.checkout_token_hash(raw_token), btrim(start_checkout_session.customer_name),
          private.normalize_bd_phone(start_checkout_session.phone), clean_email, now_ts, now_ts, now_ts + ttl)
  returning expires_at into expires;
 exception when check_violation or not_null_violation then
  raise exception 'Enter a valid name, Bangladeshi mobile number and optional email' using errcode = '22023';
 end;
 return jsonb_build_object('token', raw_token, 'expires_at', expires);
end $$;

create function public.update_checkout_contact(raw_token text, customer_name text, phone text, email text default null, client_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; cfg private.checkout_settings; subject text;
begin
 subject := private.checkout_caller_subject(client_key);
 perform private.require_orders_enabled();
 select * into strict cfg from private.checkout_settings;
 s := private.locked_checkout_session(raw_token);
 if s.lifecycle_status = 'completed' then
  raise exception 'Checkout session is no longer active' using errcode = '22023';
 end if;
 perform private.consume_checkout_rate('write', subject, interval '1 minute', cfg.writes_per_client_per_minute);
 begin
  update public.checkout_sessions
     set customer_name = btrim(update_checkout_contact.customer_name),
         phone = private.normalize_bd_phone(update_checkout_contact.phone),
         email = nullif(lower(btrim(coalesce(update_checkout_contact.email, ''))), ''),
         last_activity_at = clock_timestamp()
   where id = s.id;
 exception when check_violation or not_null_violation then
  raise exception 'Enter a valid name, Bangladeshi mobile number and optional email' using errcode = '22023';
 end;
 return jsonb_build_object('lifecycle_status', s.lifecycle_status);
end $$;

create function public.set_checkout_items(raw_token text, items jsonb, client_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; cfg private.checkout_settings; subject text; entry jsonb; v_id uuid; qty integer; info record;
 now_ts timestamptz := clock_timestamp(); kept uuid[] := '{}'; subtotal bigint := 0;
begin
 subject := private.checkout_caller_subject(client_key);
 perform private.require_orders_enabled();
 select * into strict cfg from private.checkout_settings;
 s := private.locked_checkout_session(raw_token);
 if s.lifecycle_status = 'completed' then
  raise exception 'Checkout session is no longer active' using errcode = '22023';
 end if;
 perform private.consume_checkout_rate('write', subject, interval '1 minute', cfg.writes_per_client_per_minute);
 if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 50 then
  raise exception 'Invalid checkout items' using errcode = '22023';
 end if;
 for entry in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(entry) <> 'object'
   or coalesce(entry->>'variant_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or coalesce(entry->>'quantity', '') !~ '^[0-9]{1,2}$' or (entry->>'quantity')::integer < 1 then
   raise exception 'Choose a product and a quantity between 1 and 99' using errcode = '22023';
  end if;
  v_id := (entry->>'variant_id')::uuid; qty := (entry->>'quantity')::integer;
  if v_id = any(kept) then raise exception 'Duplicate checkout item' using errcode = '22023'; end if;
  select * into info from private.orderable_variant(v_id);
  if not found or not info.orderable then
   raise exception 'This product is not available' using errcode = 'CK001';
  end if;
  if qty <> 1 then
   raise exception 'Only one of each item is available' using errcode = 'CK011';
  end if;
  insert into public.checkout_items(checkout_session_id, product_id, variant_id, quantity,
    regular_price_minor, unit_price_minor, price_snapshot_at)
  values (s.id, info.product_id, v_id, qty, info.regular_price_minor, info.unit_price_minor, now_ts)
  on conflict (checkout_session_id, variant_id) do update set quantity = excluded.quantity,
    regular_price_minor = excluded.regular_price_minor, unit_price_minor = excluded.unit_price_minor,
    price_snapshot_at = excluded.price_snapshot_at;
  kept := kept || v_id; subtotal := subtotal + info.unit_price_minor * qty;
 end loop;
 delete from public.checkout_items where checkout_session_id = s.id and not (variant_id = any(kept));
 update public.checkout_sessions set last_activity_at = now_ts where id = s.id;
 return jsonb_build_object('item_count', cardinality(kept), 'subtotal_minor', subtotal);
end $$;

create function public.place_checkout_order(raw_token text, delivery jsonb, payment_method text,
 order_note text default null, client_key text default null, expected_items jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; cfg private.checkout_settings; item record; info record; stock record;
 new_order uuid := gen_random_uuid(); number integer; subtotal bigint := 0; delivery_charge bigint; total bigint;
 now_ts timestamptz := clock_timestamp(); lines integer := 0; after_stock integer; units integer; subject text; v_phone text;
 v_division text; v_district text; v_area text; v_address text; v_note text;
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

 delivery_charge := case
  when (select free_delivery_threshold_minor from private.checkout_settings) is not null
       and subtotal >= (select free_delivery_threshold_minor from private.checkout_settings) then 0
  when v_district = 'Dhaka' then cfg.delivery_inside_dhaka_minor
  else cfg.delivery_outside_dhaka_minor end;
 total := subtotal + delivery_charge;

 insert into public.orders(id, checkout_session_id, user_id, customer_name, phone, email, division, district, area, address_line, note,
   payment_method, subtotal_minor, delivery_charge_minor, discount_minor, total_minor, placed_at)
 values (new_order, s.id, s.user_id, s.customer_name, v_phone, s.email, v_division, v_district,
   v_area, v_address, v_note, 'cod', subtotal, delivery_charge, 0, total, now_ts);
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

-- 7b. Purchase linkage must join a session to ITS OWN order (the order row records its session).
create or replace function private.complete_checkout_session(target_session uuid, linked_order uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; order_session uuid; order_found uuid; now_ts timestamptz := clock_timestamp(); saved timestamptz;
begin
 if target_session is null or linked_order is null then
  raise exception 'Checkout session and order are required' using errcode = '22023';
 end if;
 if to_regclass('public.orders') is null then
  raise exception 'Order service is not configured; no purchase was linked' using errcode = '55000';
 end if;
 execute 'select id, checkout_session_id from public.orders where id = $1' into order_found, order_session using linked_order;
 if order_found is null then
  raise exception 'Linked order does not exist' using errcode = '22023';
 end if;
 if order_session is distinct from target_session then
  raise exception 'Order does not belong to this checkout session' using errcode = '22023';
 end if;
 select * into s from public.checkout_sessions where id = target_session for update;
 if not found then raise exception 'Checkout session not found' using errcode = '22023'; end if;
 if s.lifecycle_status = 'completed' then
  if s.order_id = linked_order then return s.updated_at; end if;
  raise exception 'Checkout session already completed' using errcode = '22023';
 end if;
 if s.lifecycle_status = 'active' then
  update public.checkout_sessions set lifecycle_status = 'completed', order_id = linked_order
   where id = target_session returning updated_at into saved;
  return saved;
 end if;
 update public.checkout_sessions
    set lifecycle_status = 'completed', order_id = linked_order,
        recovery_status = 'recovered', recovered_at = now_ts
  where id = target_session returning updated_at into saved;
 insert into public.abandoned_recovery_log(checkout_session_id, previous_recovery_status, new_recovery_status,
   changed_by, change_source, note, created_at)
 values (target_session, s.recovery_status, 'recovered', null, 'automatic', 'Linked purchase recorded', now_ts);
 return saved;
end $$;
revoke all on function private.complete_checkout_session(uuid, uuid) from public, anon, authenticated;

-- 8. Grants: no anonymous access. Customers and the trusted server only.
do $$
declare sig text;
begin
 foreach sig in array array[
  'public.start_checkout_session(text,text,text,text)',
  'public.update_checkout_contact(text,text,text,text,text)',
  'public.set_checkout_items(text,jsonb,text)',
  'public.place_checkout_order(text,jsonb,text,text,text,jsonb)',
  'public.checkout_session_status(text)'] loop
  execute format('revoke all on function %s from public, anon', sig);
  execute format('grant execute on function %s to authenticated', sig);
  if exists(select 1 from pg_roles where rolname = 'service_role') then
   execute format('grant execute on function %s to service_role', sig);
  end if;
 end loop;
end $$;

-- 8b. The trusted server calls RPCs only. Supabase default privileges can give service_role direct
--     table access on new public tables, so table access is revoked explicitly (role-guarded).
do $$
declare t text;
begin
 if exists(select 1 from pg_roles where rolname = 'service_role') then
  foreach t in array array['public.orders','public.order_items','public.checkout_sessions','public.checkout_items','public.abandoned_recovery_log'] loop
   execute format('revoke all on %s from service_role', t);
  end loop;
  revoke all on private.delivery_locations, private.checkout_rate_events, private.checkout_settings from service_role;
 end if;
end $$;

-- 9. Ordering stays disabled until someone explicitly enables it on Staging. Production migrations
--    leave orders_enabled = false, and the application flag is required as well.
commit;
