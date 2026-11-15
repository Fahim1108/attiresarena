begin;
-- Admin panel: coupons and coupon redemptions.
--
-- Preconditions (applied by earlier migrations in this series):
--  * 20261113000200 created orders (referenced by coupon_redemptions).
--  * 20261115000100 (permissions migration, separate owner) widens the
--    role_permissions CHECK and grants 'coupons.manage'. Until it is applied,
--    the RPCs below deny (require_admin fails closed) and staff reads return
--    no rows; nothing here inserts into role_permissions.
--
-- Checkout wiring is PENDING: place_checkout_order has no coupon parameter,
-- so no coupon can be applied at checkout yet. validate_coupon exists so a
-- future checkout integration can call it; it deliberately requires no
-- admin permission. No redemption rows are written by this migration or by
-- the admin UI; redemptions are recorded only when checkout integration
-- lands. Until then, usage counts stay at zero honestly.

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,29}$'),
  kind text not null check (kind in ('percent', 'fixed')),
  percent_value integer check (percent_value between 1 and 100),
  fixed_discount_minor bigint check (fixed_discount_minor > 0),
  min_order_minor bigint not null default 0 check (min_order_minor >= 0),
  max_discount_minor bigint check (max_discount_minor is null or max_discount_minor > 0),
  starts_at timestamptz,
  expires_at timestamptz,
  total_usage_limit integer check (total_usage_limit is null or total_usage_limit > 0),
  per_customer_limit integer default 1 check (per_customer_limit is null or per_customer_limit > 0),
  first_order_only boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((kind = 'percent' and percent_value is not null and fixed_discount_minor is null)
      or (kind = 'fixed' and percent_value is null and fixed_discount_minor is not null)),
  check (starts_at is null or expires_at is null or starts_at < expires_at)
);
create trigger touch_updated_at before update on public.coupons
  for each row execute function private.touch_updated_at();

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  phone text check (phone is null or phone ~ '^01[3-9][0-9]{8}$'),
  order_id uuid references public.orders(id) on delete restrict,
  redeemed_at timestamptz not null default clock_timestamp(),
  check (user_id is not null or phone is not null)
);
create unique index coupon_redemptions_order_key
  on public.coupon_redemptions(coupon_id, order_id) where order_id is not null;
create index coupon_redemptions_coupon_idx on public.coupon_redemptions(coupon_id);
create index coupon_redemptions_user_idx on public.coupon_redemptions(user_id);
create index coupon_redemptions_phone_idx on public.coupon_redemptions(phone);

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
revoke all on public.coupons, public.coupon_redemptions from public, anon, authenticated;
grant select on public.coupons, public.coupon_redemptions to authenticated;
create policy coupons_staff_read on public.coupons for select to authenticated
  using ((select private.has_permission('coupons.manage')));
create policy coupon_redemptions_staff_read on public.coupon_redemptions for select to authenticated
  using ((select private.has_permission('coupons.manage')));

-- Create or update a coupon. p_coupon is an object:
-- {id?, code, kind, percent_value?, fixed_discount_minor?, min_order_minor?,
--  max_discount_minor?, starts_at?, expires_at?, total_usage_limit?,
--  per_customer_limit?, first_order_only?, active?}
-- The object is the full coupon: every field is written on create and update.
-- Missing min_order_minor defaults to 0; a missing per_customer_limit
-- defaults to 1 while an explicit JSON null means unlimited. Returns the id.
create function public.admin_save_coupon(p_coupon jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target_id uuid;
  existing public.coupons;
  new_code text;
  new_kind text;
  new_percent integer;
  new_fixed bigint;
  new_min bigint;
  new_max bigint;
  new_starts timestamptz;
  new_expires timestamptz;
  new_total_limit integer;
  new_per_limit integer;
  new_first boolean;
  new_active boolean;
  is_create boolean;
begin
  perform private.require_admin('coupons.manage');
  if p_coupon is null or jsonb_typeof(p_coupon) <> 'object' then
    raise exception 'Invalid coupon details' using errcode = '22023';
  end if;

  new_code := upper(btrim(coalesce(p_coupon->>'code', '')));
  if new_code !~ '^[A-Z0-9][A-Z0-9_-]{2,29}$' then
    raise exception 'Coupon code must be 3 to 30 letters, digits, dashes or underscores' using errcode = '22023';
  end if;
  new_kind := p_coupon->>'kind';
  if new_kind not in ('percent', 'fixed') then
    raise exception 'Coupon kind must be percent or fixed' using errcode = '22023';
  end if;
  if (p_coupon->>'percent_value') is not null and (p_coupon->>'percent_value') !~ '^-?[0-9]+$' then
    raise exception 'Percent value must be a whole number' using errcode = '22023';
  end if;
  if (p_coupon->>'fixed_discount_minor') is not null and (p_coupon->>'fixed_discount_minor') !~ '^-?[0-9]+$' then
    raise exception 'Fixed discount must be a whole number of minor units' using errcode = '22023';
  end if;
  new_percent := (p_coupon->>'percent_value')::integer;
  new_fixed := (p_coupon->>'fixed_discount_minor')::bigint;
  if new_kind = 'percent' and (new_percent is null or new_percent < 1 or new_percent > 100 or new_fixed is not null) then
    raise exception 'A percent coupon needs a percent value from 1 to 100 and no fixed discount' using errcode = '22023';
  end if;
  if new_kind = 'fixed' and (new_fixed is null or new_fixed <= 0 or new_percent is not null) then
    raise exception 'A fixed coupon needs a fixed discount above zero and no percent value' using errcode = '22023';
  end if;

  if (p_coupon->>'min_order_minor') is not null and (p_coupon->>'min_order_minor') !~ '^-?[0-9]+$' then
    raise exception 'Minimum order must be a whole number of minor units' using errcode = '22023';
  end if;
  if (p_coupon->>'max_discount_minor') is not null and (p_coupon->>'max_discount_minor') !~ '^-?[0-9]+$' then
    raise exception 'Maximum discount must be a whole number of minor units' using errcode = '22023';
  end if;
  new_min := coalesce((p_coupon->>'min_order_minor')::bigint, 0);
  new_max := (p_coupon->>'max_discount_minor')::bigint;
  if new_min < 0 then raise exception 'Minimum order cannot be negative' using errcode = '22023'; end if;
  if new_max is not null and new_max <= 0 then raise exception 'Maximum discount must be above zero' using errcode = '22023'; end if;

  begin
    new_starts := nullif(p_coupon->>'starts_at', '')::timestamptz;
    new_expires := nullif(p_coupon->>'expires_at', '')::timestamptz;
  exception when others then
    raise exception 'Coupon window dates are invalid' using errcode = '22023';
  end;
  if new_starts is not null and new_expires is not null and new_starts >= new_expires then
    raise exception 'Coupon start must be before its expiry' using errcode = '22023';
  end if;

  if (p_coupon->>'total_usage_limit') is not null and (p_coupon->>'total_usage_limit') !~ '^-?[0-9]+$' then
    raise exception 'Total usage limit must be a whole number' using errcode = '22023';
  end if;
  if (p_coupon->>'per_customer_limit') is not null and (p_coupon->>'per_customer_limit') !~ '^-?[0-9]+$' then
    raise exception 'Per-customer limit must be a whole number' using errcode = '22023';
  end if;
  new_total_limit := (p_coupon->>'total_usage_limit')::integer;
  -- Missing key means the default (1); an explicit JSON null means unlimited.
  new_per_limit := case when (p_coupon ? 'per_customer_limit')
    then (p_coupon->>'per_customer_limit')::integer else 1 end;
  if new_total_limit is not null and new_total_limit <= 0 then raise exception 'Total usage limit must be above zero' using errcode = '22023'; end if;
  if new_per_limit is not null and new_per_limit <= 0 then raise exception 'Per-customer limit must be above zero' using errcode = '22023'; end if;

  if (p_coupon->>'first_order_only') is not null and (p_coupon->>'first_order_only') not in ('true', 'false') then
    raise exception 'First-order flag is invalid' using errcode = '22023';
  end if;
  if (p_coupon->>'active') is not null and (p_coupon->>'active') not in ('true', 'false') then
    raise exception 'Active flag is invalid' using errcode = '22023';
  end if;
  new_first := coalesce((p_coupon->>'first_order_only')::boolean, false);
  new_active := coalesce((p_coupon->>'active')::boolean, true);

  if nullif(p_coupon->>'id', '') is not null then
    begin
      target_id := (p_coupon->>'id')::uuid;
    exception when others then
      raise exception 'Invalid coupon id' using errcode = '22023';
    end;
    select * into existing from public.coupons where id = target_id for update;
    if not found then raise exception 'Coupon not found' using errcode = '22023'; end if;
    is_create := false;
  else
    target_id := gen_random_uuid();
    is_create := true;
  end if;

  begin
    if is_create then
      insert into public.coupons(id, code, kind, percent_value, fixed_discount_minor,
        min_order_minor, max_discount_minor, starts_at, expires_at,
        total_usage_limit, per_customer_limit, first_order_only, active, created_by)
      values (target_id, new_code, new_kind, new_percent, new_fixed,
        new_min, new_max, new_starts, new_expires,
        new_total_limit, new_per_limit, new_first, new_active, auth.uid());
      insert into public.admin_audit_logs(actor_id, action, target_id, changes)
      values (auth.uid(), 'coupon.created', target_id, jsonb_build_object('code', new_code, 'kind', new_kind));
    else
      update public.coupons set code = new_code, kind = new_kind,
        percent_value = new_percent, fixed_discount_minor = new_fixed,
        min_order_minor = new_min, max_discount_minor = new_max,
        starts_at = new_starts, expires_at = new_expires,
        total_usage_limit = new_total_limit, per_customer_limit = new_per_limit,
        first_order_only = new_first, active = new_active
        where id = target_id;
      insert into public.admin_audit_logs(actor_id, action, target_id, changes)
      values (auth.uid(), 'coupon.updated', target_id,
        jsonb_build_object('before', jsonb_build_object('code', existing.code, 'kind', existing.kind,
          'percent_value', existing.percent_value, 'fixed_discount_minor', existing.fixed_discount_minor,
          'active', existing.active),
          'after', jsonb_build_object('code', new_code, 'kind', new_kind,
          'percent_value', new_percent, 'fixed_discount_minor', new_fixed, 'active', new_active)));
    end if;
  exception when unique_violation then
    raise exception 'A coupon with this code already exists' using errcode = '22023';
  end;
  return target_id;
end $$;
revoke all on function public.admin_save_coupon(jsonb) from public, anon;
grant execute on function public.admin_save_coupon(jsonb) to authenticated;

create function public.admin_set_coupon_active(target_coupon uuid, new_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare existing public.coupons;
begin
  perform private.require_admin('coupons.manage');
  if target_coupon is null or new_active is null then
    raise exception 'Invalid coupon request' using errcode = '22023';
  end if;
  select * into existing from public.coupons where id = target_coupon for update;
  if not found then raise exception 'Coupon not found' using errcode = '22023'; end if;
  if existing.active = new_active then return; end if;
  update public.coupons set active = new_active where id = target_coupon;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'coupon.active_changed', target_coupon,
    jsonb_build_object('code', existing.code, 'before', existing.active, 'after', new_active));
end $$;
revoke all on function public.admin_set_coupon_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_coupon_active(uuid, boolean) to authenticated;

create function public.admin_delete_coupon(target_coupon uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare existing public.coupons;
begin
  perform private.require_admin('coupons.manage');
  if target_coupon is null then
    raise exception 'Invalid coupon request' using errcode = '22023';
  end if;
  select * into existing from public.coupons where id = target_coupon for update;
  if not found then raise exception 'Coupon not found' using errcode = '22023'; end if;
  if exists(select 1 from public.coupon_redemptions where coupon_id = target_coupon) then
    raise exception 'This coupon has been used and cannot be deleted. Deactivate it instead.' using errcode = '22023';
  end if;
  delete from public.coupons where id = target_coupon;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'coupon.deleted', target_coupon, jsonb_build_object('code', existing.code));
end $$;
revoke all on function public.admin_delete_coupon(uuid) from public, anon;
grant execute on function public.admin_delete_coupon(uuid) to authenticated;

-- Eligibility check for a future checkout integration. Reads only; never
-- raises for an ineligible coupon (returns valid=false with a reason code).
-- No require_admin: the trusted checkout path must be able to call it.
-- Reason codes: not_found, inactive, not_yet_valid, expired, below_minimum,
-- usage_limit_reached, per_customer_limit_reached, first_order_only.
-- Checkout wiring is pending (place_checkout_order has no coupon
-- parameter), so this function is currently exercised only by the admin
-- eligibility test panel.
create function public.validate_coupon(p_code text, p_user_id uuid, p_phone text, p_subtotal_minor bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.coupons;
  clean_code text;
  clean_phone text;
  total_used integer;
  customer_used integer;
  discount bigint;
begin
  clean_code := upper(btrim(coalesce(p_code, '')));
  clean_phone := nullif(btrim(coalesce(p_phone, '')), '');
  if clean_code = '' or p_subtotal_minor is null or p_subtotal_minor < 0 then
    return jsonb_build_object('valid', false, 'reason', 'invalid_request', 'discount_minor', 0);
  end if;
  select * into c from public.coupons where code = clean_code;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found', 'discount_minor', 0);
  end if;
  if not c.active then
    return jsonb_build_object('valid', false, 'reason', 'inactive', 'discount_minor', 0);
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    return jsonb_build_object('valid', false, 'reason', 'not_yet_valid', 'discount_minor', 0);
  end if;
  if c.expires_at is not null and now() > c.expires_at then
    return jsonb_build_object('valid', false, 'reason', 'expired', 'discount_minor', 0);
  end if;
  if p_subtotal_minor < c.min_order_minor then
    return jsonb_build_object('valid', false, 'reason', 'below_minimum', 'discount_minor', 0);
  end if;
  if c.total_usage_limit is not null then
    select count(*)::integer into total_used from public.coupon_redemptions where coupon_id = c.id;
    if total_used >= c.total_usage_limit then
      return jsonb_build_object('valid', false, 'reason', 'usage_limit_reached', 'discount_minor', 0);
    end if;
  end if;
  -- Per-customer usage is counted by account when one is given, else by phone.
  if c.per_customer_limit is not null and (p_user_id is not null or clean_phone is not null) then
    select count(*)::integer into customer_used
      from public.coupon_redemptions
     where coupon_id = c.id
       and ((p_user_id is not null and user_id = p_user_id)
         or (p_user_id is null and clean_phone is not null and phone = clean_phone));
    if customer_used >= c.per_customer_limit then
      return jsonb_build_object('valid', false, 'reason', 'per_customer_limit_reached', 'discount_minor', 0);
    end if;
  end if;
  -- First-order coupons require a signed-in customer with no prior orders
  -- and no prior redemptions of any coupon.
  if c.first_order_only then
    if p_user_id is null
      or exists(select 1 from public.orders where user_id = p_user_id)
      or exists(select 1 from public.coupon_redemptions where user_id = p_user_id) then
      return jsonb_build_object('valid', false, 'reason', 'first_order_only', 'discount_minor', 0);
    end if;
  end if;
  discount := case when c.kind = 'percent'
    then (p_subtotal_minor * c.percent_value) / 100
    else c.fixed_discount_minor end;
  if c.max_discount_minor is not null then discount := least(discount, c.max_discount_minor); end if;
  discount := least(discount, p_subtotal_minor);
  if discount < 0 then discount := 0; end if;
  return jsonb_build_object('valid', true, 'reason', null, 'discount_minor', discount);
end $$;
revoke all on function public.validate_coupon(text, uuid, text, bigint) from public, anon;
grant execute on function public.validate_coupon(text, uuid, text, bigint) to authenticated;

commit;
