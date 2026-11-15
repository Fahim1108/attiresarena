begin;
-- Admin panel: order transitions with inventory effects + blocked customers.
--
-- Preconditions (applied by earlier migrations in this series):
--  * 20261113000200 created orders/order_items, guard_order_update,
--    admin_set_order_status (which REFUSES cancelled/returned) and the
--    orders.read/orders.manage permissions.
--  * 20261115000100 (permissions migration, separate owner) widens the
--    role_permissions CHECK and grants 'customers.read'. Until it is applied,
--    blocked_customers staff reads return no rows (fail closed); nothing here
--    inserts into role_permissions.
--
-- This migration does NOT touch checkout: place_checkout_order is unchanged,
-- and blocking a customer does NOT stop checkout (see the table comment).

-- 1. Order status transitions that cancelled/returned/delivered need.
--
-- admin_set_order_status (Step 2) refuses cancelled/returned because no
-- restock rule existed. This function implements the restock rule and the
-- Delivered-to-zero rule, so the admin UI must call THIS function, never
-- admin_set_order_status:
--  * Delivered: for each order item, available stock is set to zero by
--    setting inventory.on_hand := reserved. Variants already at available 0
--    are skipped, so no zero-delta movement row is ever written (the
--    inventory_movements delta <> 0 CHECK would reject one).
--  * Cancelled/Returned: the quantities decremented by place_checkout_order
--    are added back to inventory.on_hand, with a movement row per item.
--  * Both effects run in the same transaction as the status UPDATE, after
--    the guard_order_update trigger has enforced the legal transition.
--  * Idempotency: same-status calls return the current updated_at without
--    writing; the delivered/restore effects only run when the OLD status
--    differs (delivered) or was not already terminal (cancelled/returned),
--    and the guard trigger makes re-entering those states impossible, so a
--    repeated call can never double-apply an inventory effect.
create function public.admin_transition_order(target_order uuid, expected_updated_at timestamptz, new_status text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  saved timestamptz;
  item public.order_items;
  inv public.inventory;
  new_on_hand integer;
  delta integer;
begin
  perform private.require_admin('orders.manage');
  if target_order is null or expected_updated_at is null or new_status is null then
    raise exception 'Invalid order status request' using errcode = '22023';
  end if;
  if new_status not in ('pending', 'confirmed', 'packed', 'shipped', 'out-for-delivery', 'delivered', 'cancelled', 'returned') then
    raise exception 'Invalid order status' using errcode = '22023';
  end if;
  select * into o from public.orders where id = target_order for update;
  if not found then raise exception 'Order not found' using errcode = '22023'; end if;
  if o.updated_at is distinct from expected_updated_at then
    raise exception 'Order changed; reload' using errcode = 'PT409';
  end if;
  if o.status = new_status then return o.updated_at; end if;
  -- guard_order_update enforces the legal transition on this UPDATE.
  update public.orders set status = new_status where id = target_order returning updated_at into saved;

  if new_status = 'delivered' and o.status <> 'delivered' then
    for item in select * from public.order_items where order_id = target_order order by variant_id loop
      select * into inv from public.inventory where variant_id = item.variant_id for update;
      if not found then
        raise exception 'Inventory record is missing for an ordered item' using errcode = '22023';
      end if;
      if inv.on_hand > inv.reserved then
        new_on_hand := inv.reserved;
        delta := -(inv.on_hand - inv.reserved);
        update public.inventory set on_hand = new_on_hand where variant_id = item.variant_id;
        insert into public.inventory_movements(variant_id, actor_id, delta, on_hand_after, reason)
        values (item.variant_id, auth.uid(), delta, new_on_hand,
          'Delivered: available stock set to zero for order #' || coalesce(o.order_number::text, ''));
      end if;
    end loop;
  end if;

  if new_status in ('cancelled', 'returned') and o.status not in ('cancelled', 'returned') then
    for item in select * from public.order_items where order_id = target_order order by variant_id loop
      update public.inventory set on_hand = on_hand + item.quantity
        where variant_id = item.variant_id returning on_hand into new_on_hand;
      if not found then
        raise exception 'Inventory record is missing for an ordered item' using errcode = '22023';
      end if;
      insert into public.inventory_movements(variant_id, actor_id, delta, on_hand_after, reason)
      values (item.variant_id, auth.uid(), item.quantity, new_on_hand,
        'Restored: order #' || coalesce(o.order_number::text, '') || ' ' || new_status);
    end loop;
  end if;

  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'order.status_changed', target_order, jsonb_build_object('before', o.status, 'after', new_status));
  return saved;
end $$;
revoke all on function public.admin_transition_order(uuid, timestamptz, text) from public, anon;
grant execute on function public.admin_transition_order(uuid, timestamptz, text) to authenticated;

-- 2. Order status history must be readable by orders staff. The original
-- admin_audit_logs policy only admits catalogue.manage holders, so order
-- managers would see an empty history. This additional policy admits
-- orders.read holders (MFA AAL2, as in the original) for the
-- order.status_changed action only; it widens nothing else.
create policy admin_audit_logs_orders_read on public.admin_audit_logs for select to authenticated
  using (auth.jwt()->>'aal' = 'aal2'
    and action = 'order.status_changed'
    and (select private.has_permission('orders.read')));

-- 3. Blocked customers: an admin record keyed by phone. There is no
-- customers table; customers are derived from order records.
create table public.blocked_customers (
  phone text primary key check (phone ~ '^01[3-9][0-9]{8}$'),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  blocked_by uuid references auth.users(id) on delete set null,
  blocked_at timestamptz not null default clock_timestamp(),
  unblocked_at timestamptz,
  unblocked_by uuid references auth.users(id) on delete set null,
  note text check (note is null or length(btrim(note)) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (unblocked_at is null or unblocked_at >= blocked_at)
);
comment on table public.blocked_customers is
  'Admin record only. Blocking is NOT enforced: checkout does NOT consult this table, so a blocked phone can still place orders. Wiring enforcement into checkout is a future step requiring its own design and approval.';
create trigger touch_updated_at before update on public.blocked_customers
  for each row execute function private.touch_updated_at();
alter table public.blocked_customers enable row level security;
revoke all on public.blocked_customers from public, anon, authenticated;
grant select on public.blocked_customers to authenticated;
create policy blocked_customers_staff_read on public.blocked_customers for select to authenticated
  using ((select private.has_permission('customers.read')));

-- Audit logs require a uuid target_id, but a blocked customer is keyed by
-- phone. The target is a deterministic UUID derived from the phone number,
-- so the block/unblock history for one phone can always be found again.
create function private.blocked_customer_audit_target(p_phone text) returns uuid
language sql immutable set search_path = '' as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-' || substr(h, 13, 4)
    || '-' || substr(h, 17, 4) || '-' || substr(h, 21, 12))::uuid
  from (select md5('blocked_customer:' || p_phone) as h) s;
$$;
revoke all on function private.blocked_customer_audit_target(text) from public, anon, authenticated;

create function public.admin_block_customer(p_phone text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare clean_phone text; clean_reason text;
begin
  perform private.require_admin('orders.manage');
  clean_phone := btrim(coalesce(p_phone, ''));
  clean_reason := btrim(coalesce(p_reason, ''));
  if clean_phone !~ '^01[3-9][0-9]{8}$' then
    raise exception 'Enter a valid Bangladeshi mobile number' using errcode = '22023';
  end if;
  if length(clean_reason) < 3 or length(clean_reason) > 500 then
    raise exception 'Enter a reason of 3 to 500 characters' using errcode = '22023';
  end if;
  insert into public.blocked_customers(phone, reason, blocked_by, blocked_at, unblocked_at, unblocked_by, note)
  values (clean_phone, clean_reason, auth.uid(), clock_timestamp(), null, null, null)
  on conflict (phone) do update set reason = excluded.reason, blocked_by = excluded.blocked_by,
    blocked_at = excluded.blocked_at, unblocked_at = null, unblocked_by = null, note = null;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'customer.blocked', private.blocked_customer_audit_target(clean_phone),
    jsonb_build_object('phone', clean_phone, 'reason', clean_reason));
end $$;
revoke all on function public.admin_block_customer(text, text) from public, anon;
grant execute on function public.admin_block_customer(text, text) to authenticated;

create function public.admin_unblock_customer(p_phone text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare clean_phone text; clean_note text;
begin
  perform private.require_admin('orders.manage');
  clean_phone := btrim(coalesce(p_phone, ''));
  clean_note := nullif(btrim(coalesce(p_note, '')), '');
  if clean_phone !~ '^01[3-9][0-9]{8}$' then
    raise exception 'Enter a valid Bangladeshi mobile number' using errcode = '22023';
  end if;
  if clean_note is not null and length(clean_note) > 500 then
    raise exception 'Enter a note of up to 500 characters' using errcode = '22023';
  end if;
  update public.blocked_customers
     set unblocked_at = clock_timestamp(), unblocked_by = auth.uid(), note = clean_note
   where phone = clean_phone and unblocked_at is null;
  if not found then
    raise exception 'Customer is not blocked' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'customer.unblocked', private.blocked_customer_audit_target(clean_phone),
    jsonb_build_object('phone', clean_phone, 'note', clean_note));
end $$;
revoke all on function public.admin_unblock_customer(text, text) from public, anon;
grant execute on function public.admin_unblock_customer(text, text) to authenticated;

commit;
