begin;
-- Phase 3 Step 2: minimum order domain and atomic order creation from a checkout session.
--
-- Decisions taken from the repository, not invented:
--  * Money is integer minor units (paisa), as in product_variants and thrift_intake.
--  * Order statuses mirror the storefront OrderStatus type
--    (pending, confirmed, packed, shipped, out-for-delivery, delivered, cancelled, returned).
--  * Payment: only Cash on Delivery is enabled in the storefront configuration.
--  * Delivery: inside Dhaka district / outside Dhaka / free above a subtotal threshold,
--    as in the storefront cart. Values live in private.checkout_settings.
--  * Discounts: the storefront has demo coupons only, disabled for the real catalogue.
--    No discount rule exists, so discount_minor is always 0 here.
--  * Stock: inventory.on_hand is decremented with an inventory_movements ledger row.
--    Nothing is reserved when items are added to a checkout.
--  * Order numbers come from the existing private.assign_customer_order_number.
--  * Cancellation/return restocking has no defined rule yet and is NOT implemented.

-- 1. One place for checkout business settings (no scattered magic numbers).
create table private.checkout_settings (
 id boolean primary key default true check (id),
 abandon_after interval not null default interval '30 minutes' check (abandon_after >= interval '1 minute'),
 session_ttl interval not null default interval '7 days' check (session_ttl >= interval '1 hour'),
 delivery_inside_dhaka_minor bigint not null default 8000 check (delivery_inside_dhaka_minor >= 0),
 delivery_outside_dhaka_minor bigint not null default 13000 check (delivery_outside_dhaka_minor >= 0),
 free_delivery_threshold_minor bigint default 200000 check (free_delivery_threshold_minor is null or free_delivery_threshold_minor > 0),
 updated_at timestamptz not null default clock_timestamp()
);
insert into private.checkout_settings(id) values (true);
alter table private.checkout_settings enable row level security;
revoke all on private.checkout_settings from public, anon, authenticated;

-- 2. Staff permissions, reusing role_permissions / has_permission / require_admin.
alter table public.role_permissions drop constraint role_permissions_permission_check;
alter table public.role_permissions add constraint role_permissions_permission_check
 check (permission in ('catalogue.read','catalogue.manage','inventory.read','inventory.adjust','checkout.recover','orders.read','orders.manage'));
insert into public.role_permissions(role, permission) values
 ('owner','orders.read'),('owner','orders.manage'),
 ('order_manager','orders.read'),('order_manager','orders.manage'),
 ('customer_support','orders.read'),('analyst','orders.read');

-- 3. Orders.
create table public.orders (
 id uuid primary key default gen_random_uuid(),
 order_number integer unique check (order_number between 10000 and 99999),
 user_id uuid references auth.users(id) on delete set null,
 customer_name text not null check (length(btrim(customer_name)) between 1 and 120),
 phone text not null check (phone ~ '^01[3-9][0-9]{8}$'),
 email text check (email is null or length(email) <= 254),
 division text not null check (division in ('Barishal','Chattogram','Dhaka','Khulna','Mymensingh','Rajshahi','Rangpur','Sylhet')),
 district text not null check (length(btrim(district)) between 1 and 80),
 area text not null check (length(btrim(area)) between 1 and 120),
 address_line text not null check (length(btrim(address_line)) between 8 and 500),
 note text check (note is null or length(note) between 1 and 500),
 payment_method text not null check (payment_method in ('cod')),
 payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid','refunded')),
 status text not null default 'pending' check (status in ('pending','confirmed','packed','shipped','out-for-delivery','delivered','cancelled','returned')),
 subtotal_minor bigint not null check (subtotal_minor > 0),
 delivery_charge_minor bigint not null check (delivery_charge_minor >= 0),
 discount_minor bigint not null default 0 check (discount_minor >= 0 and discount_minor <= subtotal_minor),
 total_minor bigint not null check (total_minor = subtotal_minor - discount_minor + delivery_charge_minor),
 placed_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index orders_user_idx on public.orders(user_id);
create index orders_status_idx on public.orders(status, placed_at desc);
create index orders_phone_idx on public.orders(phone);
create trigger touch_updated_at before update on public.orders for each row execute function private.touch_updated_at();

create table public.order_items (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete restrict,
 product_id uuid not null references public.products(id) on delete restrict,
 variant_id uuid not null references public.product_variants(id) on delete restrict,
 product_name text not null,
 sku text not null,
 size text not null,
 color text not null,
 unit_price_minor bigint not null check (unit_price_minor > 0),
 quantity integer not null check (quantity > 0),
 line_total_minor bigint not null check (line_total_minor = unit_price_minor * quantity),
 created_at timestamptz not null default clock_timestamp(),
 unique (order_id, variant_id)
);
create index order_items_product_idx on public.order_items(product_id);
create index order_items_variant_idx on public.order_items(variant_id);

-- Bind the earlier foundations to the real order table.
alter table public.checkout_sessions add constraint checkout_sessions_order_id_fkey
 foreign key (order_id) references public.orders(id) on delete restrict;
alter table private.customer_order_numbers add constraint customer_order_numbers_order_id_fkey
 foreign key (order_id) references public.orders(id) on delete restrict;

-- 4. Order guards.
create function private.guard_order_update() returns trigger
language plpgsql set search_path = '' as $$
begin
 if (to_jsonb(new) - array['status','payment_status','order_number','updated_at'])
    is distinct from (to_jsonb(old) - array['status','payment_status','order_number','updated_at']) then
  raise exception 'Order details are immutable' using errcode = '22023';
 end if;
 if old.order_number is not null and new.order_number is distinct from old.order_number then
  raise exception 'Order number is immutable' using errcode = '22023';
 end if;
 if new.status is distinct from old.status and not (
     (old.status = 'pending' and new.status in ('confirmed','cancelled'))
  or (old.status = 'confirmed' and new.status in ('packed','cancelled'))
  or (old.status = 'packed' and new.status in ('shipped','cancelled'))
  or (old.status = 'shipped' and new.status in ('out-for-delivery','delivered','returned'))
  or (old.status = 'out-for-delivery' and new.status in ('delivered','returned'))
  or (old.status = 'delivered' and new.status = 'returned')) then
  raise exception 'Invalid order status change % to %', old.status, new.status using errcode = '22023';
 end if;
 return new;
end $$;
revoke all on function private.guard_order_update() from public, anon, authenticated;
create trigger guard_order before update on public.orders for each row execute function private.guard_order_update();

create function private.reject_order_history_change() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Order history cannot be changed or removed' using errcode = '42501'; end $$;
revoke all on function private.reject_order_history_change() from public, anon, authenticated;
create trigger orders_no_delete before delete on public.orders for each row execute function private.reject_order_history_change();
create trigger order_items_immutable before update or delete on public.order_items for each row execute function private.reject_order_history_change();

-- Deferred triggers fire at COMMIT as the calling role (a guest), so this must run as owner.
create function private.require_order_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if (select order_number from public.orders where id = new.id) is null then
  raise exception 'An order must receive its order number in the same transaction' using errcode = '23502';
 end if;
 return null;
end $$;
revoke all on function private.require_order_number() from public, anon, authenticated;
create constraint trigger orders_number_required after insert on public.orders
 deferrable initially deferred for each row execute function private.require_order_number();

-- 5. Row level security. Guests get nothing; customers see only their own orders.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
revoke all on public.orders, public.order_items from public, anon, authenticated;
grant select on public.orders, public.order_items to authenticated;
create policy orders_staff_read on public.orders for select to authenticated
 using ((select private.has_permission('orders.read')));
create policy orders_own_read on public.orders for select to authenticated
 using (user_id = (select auth.uid()));
create policy order_items_staff_read on public.order_items for select to authenticated
 using ((select private.has_permission('orders.read')));
create policy order_items_own_read on public.order_items for select to authenticated
 using (exists(select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

-- 6. Checkout guards revised for Step 2:
--    contact details may be corrected until the checkout is completed, and a returning
--    customer may update the items of an abandoned (not completed) checkout.
create or replace function private.guard_checkout_session_update() returns trigger
language plpgsql set search_path = '' as $$
begin
 if new.id is distinct from old.id or new.token_hash is distinct from old.token_hash
  or new.user_id is distinct from old.user_id
  or new.started_at is distinct from old.started_at or new.expires_at is distinct from old.expires_at
  or new.created_at is distinct from old.created_at then
  raise exception 'Checkout session identity fields are immutable' using errcode = '22023';
 end if;
 if old.lifecycle_status = 'completed' and (new.customer_name is distinct from old.customer_name
  or new.phone is distinct from old.phone or new.email is distinct from old.email) then
  raise exception 'Contact details are fixed once the order exists' using errcode = '22023';
 end if;
 if old.order_id is not null and new.order_id is distinct from old.order_id then
  raise exception 'Linked order is immutable' using errcode = '22023';
 end if;
 if old.abandoned_at is not null and new.abandoned_at is distinct from old.abandoned_at then
  raise exception 'abandoned_at is preserved once set' using errcode = '22023';
 end if;
 if old.lifecycle_status is distinct from new.lifecycle_status and not (
     (old.lifecycle_status = 'active' and new.lifecycle_status in ('abandoned','completed'))
  or (old.lifecycle_status = 'abandoned' and new.lifecycle_status = 'completed')) then
  raise exception 'Invalid lifecycle transition % to %', old.lifecycle_status, new.lifecycle_status using errcode = '22023';
 end if;
 if old.recovery_status is distinct from new.recovery_status and not (
     (old.recovery_status = 'pending' and new.recovery_status in ('contacted','lost','recovered'))
  or (old.recovery_status = 'contacted' and new.recovery_status in ('lost','recovered'))
  or (old.recovery_status = 'lost' and new.recovery_status = 'recovered')) then
  raise exception 'Invalid recovery transition % to %', old.recovery_status, new.recovery_status using errcode = '22023';
 end if;
 return new;
end $$;

create or replace function private.guard_checkout_item() returns trigger
language plpgsql set search_path = '' as $$
begin
 if not exists(select 1 from public.checkout_sessions s where s.id = new.checkout_session_id and s.lifecycle_status in ('active','abandoned')) then
  raise exception 'Items cannot change after the checkout is completed' using errcode = '22023';
 end if;
 if not exists(select 1 from public.product_variants v where v.id = new.variant_id and v.product_id = new.product_id) then
  raise exception 'Variant does not belong to product' using errcode = '22023';
 end if;
 return new;
end $$;

create function private.guard_checkout_item_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
 if exists(select 1 from public.checkout_sessions s where s.id = old.checkout_session_id and s.lifecycle_status = 'completed') then
  raise exception 'Items cannot change after the checkout is completed' using errcode = '22023';
 end if;
 return old;
end $$;
revoke all on function private.guard_checkout_item_delete() from public, anon, authenticated;
create trigger guard_checkout_item_delete before delete on public.checkout_items
 for each row execute function private.guard_checkout_item_delete();

-- 7. Internal helpers.
create function private.normalize_bd_phone(raw_phone text) returns text
language sql immutable set search_path = '' as $$
 select regexp_replace(regexp_replace(coalesce(raw_phone, ''), '[[:space:]-]', '', 'g'), '^\+?88', '');
$$;
revoke all on function private.normalize_bd_phone(text) from public, anon, authenticated;

-- The single definition of "can this variant be ordered, and at what price".
-- Thrift garments are priced by thrift_intake (as published_thrift_catalogue does);
-- other products by the variant sale price, else its regular price.
create function private.orderable_variant(target_variant uuid)
returns table(product_id uuid, product_name text, sku text, size text, color text,
 regular_price_minor bigint, unit_price_minor bigint, is_thrift boolean, orderable boolean)
language sql stable security definer set search_path = '' as $$
 select p.id, p.name, v.sku, v.size, v.color,
  case when i.product_id is not null then i.price_minor else v.price_minor end,
  case when i.product_id is not null then i.price_minor else coalesce(v.sale_price_minor, v.price_minor) end,
  i.product_id is not null,
  p.status = 'published' and v.active and
  case when i.product_id is not null
   then i.size_verified and i.details_verified and i.stock_quantity > 0 and i.price_minor > 0
        and i.actual_size = v.size and i.actual_color = v.color
   else v.price_minor > 0 and coalesce(v.sale_price_minor, v.price_minor) > 0 end
 from public.product_variants v
 join public.products p on p.id = v.product_id
 left join public.thrift_intake i on i.product_id = p.id
 where v.id = target_variant;
$$;
revoke all on function private.orderable_variant(uuid) from public, anon, authenticated;

-- 8. Guest checkout functions (token-bearing).
create or replace function public.start_checkout_session(customer_name text, phone text, email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare raw_token text; now_ts timestamptz := clock_timestamp(); uid uuid; expires timestamptz; clean_email text; ttl interval;
begin
 select session_ttl into strict ttl from private.checkout_settings;
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

create function public.update_checkout_contact(raw_token text, customer_name text, phone text, email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions;
begin
 s := private.locked_checkout_session(raw_token);
 if s.lifecycle_status = 'completed' then
  raise exception 'Checkout session is no longer active' using errcode = '22023';
 end if;
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
revoke all on function public.update_checkout_contact(text, text, text, text) from public, anon, authenticated;
grant execute on function public.update_checkout_contact(text, text, text, text) to anon, authenticated;

-- Replaces the whole item list (the browser cart is the source of WHAT, never of price).
create function public.set_checkout_items(raw_token text, items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; entry jsonb; v_id uuid; qty integer; info record;
 now_ts timestamptz := clock_timestamp(); kept uuid[] := '{}'; subtotal bigint := 0;
begin
 s := private.locked_checkout_session(raw_token);
 if s.lifecycle_status = 'completed' then
  raise exception 'Checkout session is no longer active' using errcode = '22023';
 end if;
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
  if not found or not info.orderable or (info.is_thrift and qty <> 1) then
   raise exception 'This product is not available' using errcode = 'CK001';
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
revoke all on function public.set_checkout_items(text, jsonb) from public, anon, authenticated;
grant execute on function public.set_checkout_items(text, jsonb) to anon, authenticated;

-- Step 1 function corrected to use the single pricing/orderability definition.
create or replace function public.add_checkout_item(raw_token text, target_variant uuid, quantity integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; info record; now_ts timestamptz := clock_timestamp();
begin
 s := private.locked_checkout_session(raw_token);
 if s.lifecycle_status = 'completed' then
  raise exception 'Checkout session is no longer active' using errcode = '22023';
 end if;
 if target_variant is null or quantity is null or quantity < 1 or quantity > 99 then
  raise exception 'Choose a product and a quantity between 1 and 99' using errcode = '22023';
 end if;
 select * into info from private.orderable_variant(target_variant);
 if not found or not info.orderable or (info.is_thrift and quantity <> 1) then
  raise exception 'This product is not available' using errcode = '22023';
 end if;
 insert into public.checkout_items(checkout_session_id, product_id, variant_id, quantity,
   regular_price_minor, unit_price_minor, price_snapshot_at)
 values (s.id, info.product_id, target_variant, quantity, info.regular_price_minor, info.unit_price_minor, now_ts)
 on conflict (checkout_session_id, variant_id) do update set quantity = excluded.quantity,
   regular_price_minor = excluded.regular_price_minor, unit_price_minor = excluded.unit_price_minor,
   price_snapshot_at = excluded.price_snapshot_at;
 update public.checkout_sessions set last_activity_at = now_ts where id = s.id;
 return jsonb_build_object('quantity', quantity, 'unit_price_minor', info.unit_price_minor, 'regular_price_minor', info.regular_price_minor);
end $$;

-- 9. Abandonment: threshold now comes from settings (30 minutes) unless given explicitly.
-- Qualified = contact details exist (always true for a session) AND at least one item.
create or replace function private.mark_abandoned_checkout_sessions(inactive_after interval default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer; threshold interval;
begin
 threshold := coalesce(inactive_after, (select abandon_after from private.checkout_settings));
 if threshold is null or threshold < interval '1 minute' then
  raise exception 'Inactivity threshold must be at least one minute' using errcode = '22023';
 end if;
 update public.checkout_sessions s
    set lifecycle_status = 'abandoned', abandoned_at = clock_timestamp()
  where s.lifecycle_status = 'active' and s.last_activity_at < clock_timestamp() - threshold
    and exists(select 1 from public.checkout_items i where i.checkout_session_id = s.id);
 get diagnostics affected = row_count;
 return affected;
end $$;

-- Result returned to the trusted server for a new or an already-placed order. It carries
-- the items and placement time so the server can tell a repeated submission of the same
-- purchase from a new purchase made with a stale credential.
create function private.checkout_order_result(target_order uuid, was_already_placed boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'total_minor', o.total_minor,
  'subtotal_minor', o.subtotal_minor, 'delivery_charge_minor', o.delivery_charge_minor,
  'placed_at', o.placed_at, 'already_placed', was_already_placed,
  'items', (select jsonb_agg(jsonb_build_object('variant_id', i.variant_id, 'quantity', i.quantity) order by i.variant_id)
            from public.order_items i where i.order_id = o.id))
 from public.orders o where o.id = target_order;
$$;
revoke all on function private.checkout_order_result(uuid, boolean) from public, anon, authenticated;

-- 10. THE authoritative order creation transaction.
create function public.place_checkout_order(raw_token text, delivery jsonb, payment_method text, order_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; cfg private.checkout_settings; item record; info record; stock record;
 new_order uuid := gen_random_uuid(); number integer; subtotal bigint := 0; delivery_charge bigint; total bigint;
 now_ts timestamptz := clock_timestamp(); lines integer := 0; after_stock integer;
 v_division text; v_district text; v_area text; v_address text; v_note text;
begin
 -- Validates the token format, hashes it, locks the session row FOR UPDATE, rejects expiry.
 s := private.locked_checkout_session(raw_token);
 if s.order_id is not null then
  return private.checkout_order_result(s.order_id, true);
 end if;
 if s.lifecycle_status not in ('active','abandoned') then
  raise exception 'Checkout session is no longer active' using errcode = '22023';
 end if;
 v_division := btrim(coalesce(delivery->>'division', '')); v_district := btrim(coalesce(delivery->>'district', ''));
 v_area := btrim(coalesce(delivery->>'area', '')); v_address := btrim(coalesce(delivery->>'address_line', ''));
 v_note := nullif(btrim(coalesce(order_note, '')), '');
 if delivery is null or jsonb_typeof(delivery) <> 'object'
  or v_division not in ('Barishal','Chattogram','Dhaka','Khulna','Mymensingh','Rajshahi','Rangpur','Sylhet')
  or length(v_district) not between 1 and 80 or length(v_area) not between 1 and 120
  or length(v_address) not between 8 and 500 or length(coalesce(v_note, 'x')) > 500 then
  raise exception 'Enter a complete delivery address' using errcode = '22023';
 end if;
 if payment_method is distinct from 'cod' then
  raise exception 'Only Cash on Delivery is available' using errcode = '22023';
 end if;
 select * into strict cfg from private.checkout_settings;

 -- Items come from the database, in a fixed order so concurrent orders cannot deadlock.
 for item in select * from public.checkout_items where checkout_session_id = s.id order by variant_id loop
  perform 1 from public.product_variants v join public.products p on p.id = v.product_id
   where v.id = item.variant_id for share of v, p;
  select * into stock from public.inventory where variant_id = item.variant_id for update;
  if not found then raise exception 'This product is not available' using errcode = 'CK001'; end if;
  select * into info from private.orderable_variant(item.variant_id);
  if not found or not info.orderable or (info.is_thrift and item.quantity <> 1) then
   raise exception 'A product in your order is no longer available' using errcode = 'CK001';
  end if;
  if stock.available < item.quantity then
   raise exception 'Not enough stock for %', info.product_name using errcode = 'CK002';
  end if;
  -- Authoritative current price replaces whatever snapshot the checkout held.
  update public.checkout_items set regular_price_minor = info.regular_price_minor,
    unit_price_minor = info.unit_price_minor, price_snapshot_at = now_ts where id = item.id;
  subtotal := subtotal + info.unit_price_minor * item.quantity; lines := lines + 1;
 end loop;
 if lines = 0 then raise exception 'Your checkout is empty' using errcode = 'CK003'; end if;

 delivery_charge := case
  when cfg.free_delivery_threshold_minor is not null and subtotal >= cfg.free_delivery_threshold_minor then 0
  when v_district = 'Dhaka' then cfg.delivery_inside_dhaka_minor
  else cfg.delivery_outside_dhaka_minor end;
 total := subtotal + delivery_charge;

 insert into public.orders(id, user_id, customer_name, phone, email, division, district, area, address_line, note,
   payment_method, subtotal_minor, delivery_charge_minor, discount_minor, total_minor, placed_at)
 values (new_order, s.user_id, s.customer_name, private.normalize_bd_phone(s.phone), s.email, v_division, v_district,
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

 -- Links the order, completes the lifecycle and, for a previously abandoned checkout,
 -- records recovered + recovered_at + an automatic recovery log entry (abandoned_at kept).
 perform private.complete_checkout_session(s.id, new_order);

 return private.checkout_order_result(new_order, false);
end $$;
revoke all on function public.place_checkout_order(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.place_checkout_order(text, jsonb, text, text) to anon, authenticated;

-- 11. Staff order status changes: permission + MFA, version check, audited.
-- Cancelled/returned are refused here until a restock rule is defined.
create function public.admin_set_order_status(target_order uuid, expected_updated_at timestamptz, new_status text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare o public.orders; saved timestamptz;
begin
 perform private.require_admin('orders.manage');
 if target_order is null or expected_updated_at is null or new_status is null then
  raise exception 'Invalid order status request' using errcode = '22023';
 end if;
 if new_status in ('cancelled','returned') then
  raise exception 'Cancellation and returns are not available until a restock rule is defined' using errcode = '0A000';
 end if;
 select * into o from public.orders where id = target_order for update;
 if not found then raise exception 'Order not found' using errcode = '22023'; end if;
 if o.updated_at is distinct from expected_updated_at then
  raise exception 'Order changed; reload' using errcode = 'PT409';
 end if;
 if o.status = new_status then return o.updated_at; end if;
 update public.orders set status = new_status where id = target_order returning updated_at into saved;
 insert into public.admin_audit_logs(actor_id, action, target_id, changes)
 values (auth.uid(), 'order.status_changed', target_order, jsonb_build_object('before', o.status, 'after', new_status));
 return saved;
end $$;
revoke all on function public.admin_set_order_status(uuid, timestamptz, text) from public, anon;
grant execute on function public.admin_set_order_status(uuid, timestamptz, text) to authenticated;

commit;
