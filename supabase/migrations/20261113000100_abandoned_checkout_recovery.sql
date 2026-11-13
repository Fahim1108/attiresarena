begin;
-- Phase 3 Step 1: abandoned checkout recovery foundation.
--
-- Scope limits (deliberate):
--  * No orders/order_items table exists in this repository yet. order_id is a plain
--    uuid with NO foreign key; the Step 2 order migration adds the foreign key.
--  * No order is created here. Purchase linkage is only possible through
--    private.complete_checkout_session, which refuses until public.orders exists.
--  * No pg_cron schedule is created: the repository proves no pg_cron setup exists.
--    private.mark_abandoned_checkout_sessions is ready to be scheduled once verified.
--  * Guests have no table privileges at all. They act only through token-bearing
--    functions. The session UUID never proves ownership.

-- 1. Admin permission, reusing the existing private.has_permission / require_admin.
alter table public.role_permissions drop constraint role_permissions_permission_check;
alter table public.role_permissions add constraint role_permissions_permission_check
 check (permission in ('catalogue.read','catalogue.manage','inventory.read','inventory.adjust','checkout.recover'));
insert into public.role_permissions(role, permission) values
 ('owner','checkout.recover'),('order_manager','checkout.recover');

-- 2. Checkout sessions (guest or authenticated). Only a SHA-256 hash of the token is stored.
create table public.checkout_sessions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references auth.users(id) on delete set null,
 token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
 customer_name text not null check (length(btrim(customer_name)) between 1 and 120),
 phone text not null check (phone ~ '^(\+?88)?01[3-9][0-9]{8}$'),
 email text check (email is null or (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
 lifecycle_status text not null default 'active' check (lifecycle_status in ('active','abandoned','completed')),
 recovery_status text not null default 'pending' check (recovery_status in ('pending','contacted','lost','recovered')),
 started_at timestamptz not null default clock_timestamp(),
 last_activity_at timestamptz not null default clock_timestamp(),
 abandoned_at timestamptz,
 contacted_at timestamptz,
 recovered_at timestamptz,
 expires_at timestamptz not null,
 order_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check (expires_at > started_at),
 check (last_activity_at >= started_at),
 check (abandoned_at is null or lifecycle_status in ('abandoned','completed')),
 check (recovery_status = 'pending' or abandoned_at is not null),
 check (recovery_status <> 'contacted' or contacted_at is not null),
 check (recovery_status <> 'recovered' or recovered_at is not null),
 check (lifecycle_status <> 'completed' or order_id is not null),
 check (recovery_status <> 'recovered' or (lifecycle_status = 'completed' and order_id is not null))
);
create unique index checkout_sessions_order_key on public.checkout_sessions(order_id) where order_id is not null;
create index checkout_sessions_inactive_idx on public.checkout_sessions(last_activity_at) where lifecycle_status = 'active';
create index checkout_sessions_user_idx on public.checkout_sessions(user_id);
create trigger touch_updated_at before update on public.checkout_sessions for each row execute function private.touch_updated_at();

-- 3. Items with an authoritative price snapshot written only by the trusted function.
create table public.checkout_items (
 id uuid primary key default gen_random_uuid(),
 checkout_session_id uuid not null references public.checkout_sessions(id) on delete restrict,
 product_id uuid not null references public.products(id) on delete restrict,
 variant_id uuid not null references public.product_variants(id) on delete restrict,
 quantity integer not null check (quantity > 0),
 regular_price_minor bigint not null check (regular_price_minor between 0 and 9007199254740991),
 unit_price_minor bigint not null check (unit_price_minor between 0 and regular_price_minor),
 price_snapshot_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique (checkout_session_id, variant_id)
);
create index checkout_items_product_idx on public.checkout_items(product_id);
create index checkout_items_variant_idx on public.checkout_items(variant_id);
create trigger touch_updated_at before update on public.checkout_items for each row execute function private.touch_updated_at();

-- 4. Append-only recovery history.
create table public.abandoned_recovery_log (
 id uuid primary key default gen_random_uuid(),
 checkout_session_id uuid not null references public.checkout_sessions(id) on delete restrict,
 previous_recovery_status text not null check (previous_recovery_status in ('pending','contacted','lost','recovered')),
 new_recovery_status text not null check (new_recovery_status in ('pending','contacted','lost','recovered')),
 changed_by uuid references auth.users(id) on delete set null,
 change_source text not null check (change_source in ('manual','automatic')),
 note text check (note is null or length(btrim(note)) between 1 and 500),
 created_at timestamptz not null default clock_timestamp(),
 check (previous_recovery_status <> new_recovery_status),
 check (change_source <> 'manual' or (changed_by is not null and note is not null)),
 check (change_source <> 'automatic' or changed_by is null)
);
create index abandoned_recovery_log_session_idx on public.abandoned_recovery_log(checkout_session_id, created_at);

-- 5. Guards. Triggers run for every writer, including security definer functions.
create function private.guard_checkout_session_update() returns trigger
language plpgsql set search_path = '' as $$
begin
 if new.id is distinct from old.id or new.token_hash is distinct from old.token_hash
  or new.user_id is distinct from old.user_id or new.customer_name is distinct from old.customer_name
  or new.phone is distinct from old.phone or new.email is distinct from old.email
  or new.started_at is distinct from old.started_at or new.expires_at is distinct from old.expires_at
  or new.created_at is distinct from old.created_at then
  raise exception 'Checkout session identity fields are immutable' using errcode = '22023';
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
revoke all on function private.guard_checkout_session_update() from public, anon, authenticated;
create trigger guard_checkout_session before update on public.checkout_sessions
 for each row execute function private.guard_checkout_session_update();

create function private.guard_checkout_item() returns trigger
language plpgsql set search_path = '' as $$
begin
 if not exists(select 1 from public.checkout_sessions s where s.id = new.checkout_session_id and s.lifecycle_status = 'active') then
  raise exception 'Items can only change while the checkout session is active' using errcode = '22023';
 end if;
 if not exists(select 1 from public.product_variants v where v.id = new.variant_id and v.product_id = new.product_id) then
  raise exception 'Variant does not belong to product' using errcode = '22023';
 end if;
 return new;
end $$;
revoke all on function private.guard_checkout_item() from public, anon, authenticated;
create trigger guard_checkout_item before insert or update on public.checkout_items
 for each row execute function private.guard_checkout_item();

create function private.reject_recovery_log_change() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Recovery history is append-only' using errcode = '42501'; end $$;
revoke all on function private.reject_recovery_log_change() from public, anon, authenticated;
create trigger abandoned_recovery_log_append_only before update or delete on public.abandoned_recovery_log
 for each row execute function private.reject_recovery_log_change();

-- 6. Row level security: no policy for anon or customers; staff read only with checkout.recover.
alter table public.checkout_sessions enable row level security;
alter table public.checkout_items enable row level security;
alter table public.abandoned_recovery_log enable row level security;
revoke all on public.checkout_sessions, public.checkout_items, public.abandoned_recovery_log from public, anon, authenticated;
-- token_hash is deliberately excluded from every staff-visible column list.
grant select (id, user_id, customer_name, phone, email, lifecycle_status, recovery_status, started_at,
  last_activity_at, abandoned_at, contacted_at, recovered_at, expires_at, order_id, created_at, updated_at)
  on public.checkout_sessions to authenticated;
grant select on public.checkout_items to authenticated;
grant select on public.abandoned_recovery_log to authenticated;
create policy checkout_sessions_staff_read on public.checkout_sessions for select to authenticated
 using ((select private.has_permission('checkout.recover')));
create policy checkout_items_staff_read on public.checkout_items for select to authenticated
 using ((select private.has_permission('checkout.recover')));
create policy abandoned_recovery_log_staff_read on public.abandoned_recovery_log for select to authenticated
 using ((select private.has_permission('checkout.recover')));

-- 7. Helpers (internal only).
create function private.checkout_token_hash(raw_token text) returns text
language sql immutable set search_path = '' as $$
 select encode(sha256(convert_to(raw_token, 'UTF8')), 'hex');
$$;
revoke all on function private.checkout_token_hash(text) from public, anon, authenticated;

create function private.locked_checkout_session(raw_token text) returns public.checkout_sessions
language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions;
begin
 if raw_token is null or raw_token !~ '^[0-9a-f]{64}$' then
  raise exception 'Checkout session is unavailable' using errcode = '22023';
 end if;
 select * into s from public.checkout_sessions where token_hash = private.checkout_token_hash(raw_token) for update;
 if not found or s.expires_at <= clock_timestamp() then
  raise exception 'Checkout session is unavailable' using errcode = '22023';
 end if;
 return s;
end $$;
revoke all on function private.locked_checkout_session(text) from public, anon, authenticated;

-- 8. Guest functions. Token-bearing only; the raw token is returned once and never stored.
create function public.start_checkout_session(customer_name text, phone text, email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare raw_token text; now_ts timestamptz := clock_timestamp(); uid uuid; expires timestamptz; clean_email text;
begin
 if auth.uid() is not null and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false then uid := auth.uid(); end if;
 clean_email := nullif(lower(btrim(coalesce(email, ''))), '');
 raw_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
 begin
  insert into public.checkout_sessions(user_id, token_hash, customer_name, phone, email, started_at, last_activity_at, expires_at)
  values (uid, private.checkout_token_hash(raw_token), btrim(start_checkout_session.customer_name),
          btrim(start_checkout_session.phone), clean_email, now_ts, now_ts, now_ts + interval '7 days')
  returning expires_at into expires;
 exception when check_violation then
  raise exception 'Enter a valid name, Bangladeshi mobile number and optional email' using errcode = '22023';
 end;
 return jsonb_build_object('token', raw_token, 'expires_at', expires);
end $$;
revoke all on function public.start_checkout_session(text, text, text) from public, anon, authenticated;
grant execute on function public.start_checkout_session(text, text, text) to anon, authenticated;

create function public.checkout_session_status(raw_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions;
begin
 s := private.locked_checkout_session(raw_token);
 return jsonb_build_object('lifecycle_status', s.lifecycle_status, 'expires_at', s.expires_at);
end $$;
revoke all on function public.checkout_session_status(text) from public, anon, authenticated;
grant execute on function public.checkout_session_status(text) to anon, authenticated;

create function public.add_checkout_item(raw_token text, target_variant uuid, quantity integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; v_product uuid; v_price bigint; v_sale bigint; v_active boolean; v_status text;
 unit bigint; now_ts timestamptz := clock_timestamp();
begin
 s := private.locked_checkout_session(raw_token);
 if s.lifecycle_status <> 'active' then
  raise exception 'Checkout session is no longer active' using errcode = '22023';
 end if;
 if target_variant is null or quantity is null or quantity < 1 then
  raise exception 'Choose a product and a quantity of at least 1' using errcode = '22023';
 end if;
 select v.product_id, v.price_minor, v.sale_price_minor, v.active, p.status
   into v_product, v_price, v_sale, v_active, v_status
   from public.product_variants v join public.products p on p.id = v.product_id
  where v.id = target_variant;
 if not found or not v_active or v_status <> 'published' or v_price <= 0 then
  raise exception 'This product is not available' using errcode = '22023';
 end if;
 -- Authoritative price: always read from the variant, never from the client.
 unit := coalesce(v_sale, v_price);
 insert into public.checkout_items(checkout_session_id, product_id, variant_id, quantity,
   regular_price_minor, unit_price_minor, price_snapshot_at)
 values (s.id, v_product, target_variant, quantity, v_price, unit, now_ts)
 on conflict (checkout_session_id, variant_id) do update set quantity = excluded.quantity,
   regular_price_minor = excluded.regular_price_minor, unit_price_minor = excluded.unit_price_minor,
   price_snapshot_at = excluded.price_snapshot_at;
 update public.checkout_sessions set last_activity_at = now_ts where id = s.id;
 return jsonb_build_object('quantity', quantity, 'unit_price_minor', unit, 'regular_price_minor', v_price);
end $$;
revoke all on function public.add_checkout_item(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.add_checkout_item(text, uuid, integer) to anon, authenticated;

-- 9. Abandonment. Internal (private schema, not exposed through the API). Idempotent.
create function private.mark_abandoned_checkout_sessions(inactive_after interval default interval '2 hours')
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
 if inactive_after is null or inactive_after < interval '1 minute' then
  raise exception 'Inactivity threshold must be at least one minute' using errcode = '22023';
 end if;
 update public.checkout_sessions
    set lifecycle_status = 'abandoned', abandoned_at = clock_timestamp()
  where lifecycle_status = 'active' and last_activity_at < clock_timestamp() - inactive_after;
 get diagnostics affected = row_count;
 return affected;
end $$;
revoke all on function private.mark_abandoned_checkout_sessions(interval) from public, anon, authenticated;

-- 10. Purchase linkage. Internal: the Step 2 order transaction is the only caller.
-- Refuses unless the real orders table exists and contains the order.
create function private.complete_checkout_session(target_session uuid, linked_order uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; order_found uuid; now_ts timestamptz := clock_timestamp(); saved timestamptz;
begin
 if target_session is null or linked_order is null then
  raise exception 'Checkout session and order are required' using errcode = '22023';
 end if;
 if to_regclass('public.orders') is null then
  raise exception 'Order service is not configured; no purchase was linked' using errcode = '55000';
 end if;
 execute 'select id from public.orders where id = $1' into order_found using linked_order;
 if order_found is null then
  raise exception 'Linked order does not exist' using errcode = '22023';
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
 -- abandoned -> completed, recovery -> recovered (preserves abandoned_at)
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

-- 11. Staff recovery workflow. Permission + MFA via require_admin; optimistic concurrency; audited.
-- 'recovered' is deliberately refused here: it is only reachable through a linked purchase.
create function public.admin_set_checkout_recovery_status(target_session uuid, expected_updated_at timestamptz,
 new_status text, note text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; saved timestamptz; now_ts timestamptz := clock_timestamp(); clean_note text;
begin
 perform private.require_admin('checkout.recover');
 if target_session is null or expected_updated_at is null then
  raise exception 'Invalid recovery request' using errcode = '22023';
 end if;
 if new_status = 'recovered' then
  raise exception 'Recovery is recorded only from a linked purchase' using errcode = '22023';
 end if;
 if new_status not in ('contacted','lost') then
  raise exception 'Invalid recovery status' using errcode = '22023';
 end if;
 clean_note := btrim(coalesce(note, ''));
 if length(clean_note) < 3 or length(clean_note) > 500 then
  raise exception 'Enter a note of 3 to 500 characters' using errcode = '22023';
 end if;
 select * into s from public.checkout_sessions where id = target_session for update;
 if not found then raise exception 'Checkout session not found' using errcode = '22023'; end if;
 if s.updated_at is distinct from expected_updated_at then
  raise exception 'Checkout session changed; reload' using errcode = 'PT409';
 end if;
 if s.lifecycle_status <> 'abandoned' then
  raise exception 'Only abandoned checkout sessions have recovery states' using errcode = '22023';
 end if;
 if s.recovery_status = new_status then return s.updated_at; end if;
 update public.checkout_sessions
    set recovery_status = new_status,
        contacted_at = case when new_status = 'contacted' then now_ts else contacted_at end
  where id = target_session returning updated_at into saved;
 insert into public.abandoned_recovery_log(checkout_session_id, previous_recovery_status, new_recovery_status,
   changed_by, change_source, note, created_at)
 values (target_session, s.recovery_status, new_status, auth.uid(), 'manual', clean_note, now_ts);
 return saved;
end $$;
revoke all on function public.admin_set_checkout_recovery_status(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.admin_set_checkout_recovery_status(uuid, timestamptz, text, text) to authenticated;

commit;
