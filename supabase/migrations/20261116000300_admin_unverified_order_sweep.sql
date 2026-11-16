begin;
-- Admin panel: 3-hour unverified-order rule (orders + courier build).
--
-- THE RULE (owner decision): an order that is NOT verified from the admin
-- panel within 3 hours of placement must auto-restock; during those 3
-- hours the product stays locked/reserved. Thrift shirts are unique
-- single pieces, so a second buyer must not be able to buy the same shirt
-- while the first order is unverified.
--
-- DEFINITIONS (coordinator decisions):
--  * "Unverified" = status 'pending'. No verified_at/verified_by column
--    exists; pending is the only pre-verification state, and its only
--    forward move is pending -> confirmed (verification) or -> cancelled.
--  * The clock runs from orders.placed_at.
--  * Sweep predicate: status = 'pending' AND placed_at < now() - 3 hours
--    (strictly older than 3 hours; an order exactly 3 hours old is kept).
--  * Swept orders move to 'cancelled' through the SAME restore math as
--    admin_transition_order's restore branch (on_hand += quantity per
--    order item + one inventory_movements row per item), in the same
--    transaction as the status UPDATE, after the guard trigger passes.
--  * Orders that already have a shipment record (order_shipments) are
--    SKIPPED, never swept: a booked parcel must not be cancelled by this
--    sweep. Skipped orders are counted and reported, not silently dropped.
--
-- SHAPE: follows the private.mark_abandoned_checkout_sessions precedent
-- (20261113000100): a private sweep function + admin_* RPC wrappers for
-- an owner-triggered manual run from the admin UI.
--
-- SCHEDULER GAP, STATED HONESTLY: NO scheduler exists. There is no
-- pg_cron schedule, no Vercel cron, and no in-app scheduler anywhere in
-- this repository, and this migration creates none. The sweep runs ONLY
-- when a staff member with orders.manage runs it from the All Orders
-- page. Automatic execution needs a scheduler that does not exist yet;
-- wiring one is a separate, owner-approved step. Nothing in this file,
-- or in the app, pretends otherwise.
--
-- FAILURE SEMANTICS: the sweep runs in one transaction. Like
-- admin_transition_order, a missing inventory record for any swept item
-- aborts the whole run (nothing is partially cancelled). The admin UI
-- reports the failure honestly and no order is left half-swept.
--
-- DEPENDENCY: the skip-if-shipped predicate reads public.order_shipments,
-- created by migration 20261116000200 in this same build. Apply 002
-- before this file in the same migration run. (PL/pgSQL resolves table
-- references at execution time, so this file still applies without 002 —
-- but the sweep then fails loudly at runtime instead of sweeping
-- shipped orders, which is the safe failure.) Does not depend on
-- unapplied migrations 014/015.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run against the STAGING project, after a
-- schema-drift check.

-- Private sweep: cancel stale pending orders, restoring stock exactly as
-- admin_transition_order does. Returns {cancelled, skipped} counts.
create function private.cancel_stale_pending_orders()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  item public.order_items;
  new_on_hand integer;
  cancelled integer := 0;
  skipped integer := 0;
begin
  -- ONE locked pass over every stale pending order: the skipped count
  -- is derived from the same rows the loop locks, so it can never
  -- disagree with the loop's set (a separate pre-loop count would see
  -- a different snapshot under READ COMMITTED). Orders with a shipment
  -- record are counted as skipped, never swept.
  for o in
    select * from public.orders
     where status = 'pending'
       and placed_at < clock_timestamp() - interval '3 hours'
     order by placed_at, id
     for update
  loop
    if exists (select 1 from public.order_shipments s where s.order_id = o.id) then
      skipped := skipped + 1;
      continue;
    end if;
    -- guard_order_update enforces pending -> cancelled on this UPDATE.
    update public.orders set status = 'cancelled' where id = o.id;
    -- Restore math identical to admin_transition_order's restore branch.
    for item in select * from public.order_items where order_id = o.id order by variant_id loop
      update public.inventory set on_hand = on_hand + item.quantity
        where variant_id = item.variant_id returning on_hand into new_on_hand;
      if not found then
        raise exception 'Inventory record is missing for an ordered item' using errcode = '22023';
      end if;
      insert into public.inventory_movements(variant_id, actor_id, delta, on_hand_after, reason)
      values (item.variant_id, auth.uid(), item.quantity, new_on_hand,
        'Restored: order #' || coalesce(o.order_number::text, '') || ' cancelled (unverified after 3 hours)');
    end loop;
    insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'order.auto_cancelled_unverified', o.id,
      jsonb_build_object('before', 'pending', 'after', 'cancelled', 'placed_at', o.placed_at, 'reason', 'unverified_3h'));
    cancelled := cancelled + 1;
  end loop;
  return jsonb_build_object('cancelled', cancelled, 'skipped', skipped);
end $$;
revoke all on function private.cancel_stale_pending_orders() from public, anon, authenticated;

-- Dry-run preview: how many orders the sweep WOULD cancel / skip, without
-- writing anything. The confirmation dialog shows these counts.
create function public.admin_preview_unverified_order_sweep()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  would_cancel integer;
  skipped integer;
begin
  perform private.require_admin('orders.manage');
  select count(*) into would_cancel
    from public.orders
   where status = 'pending'
     and placed_at < clock_timestamp() - interval '3 hours'
     and not exists (select 1 from public.order_shipments s where s.order_id = orders.id);
  select count(*) into skipped
    from public.orders
   where status = 'pending'
     and placed_at < clock_timestamp() - interval '3 hours'
     and exists (select 1 from public.order_shipments s where s.order_id = orders.id);
  return jsonb_build_object('stale', would_cancel + skipped, 'would_cancel', would_cancel, 'skipped', skipped);
end $$;
revoke all on function public.admin_preview_unverified_order_sweep() from public, anon;
grant execute on function public.admin_preview_unverified_order_sweep() to authenticated;

-- Manual run: executes the sweep and returns {cancelled, skipped}. The
-- caller (an orders.manage holder) triggers it from the All Orders page.
-- A summary audit row records the run; each swept order also has its own
-- order.auto_cancelled_unverified audit row (written by the sweep).
create function public.admin_run_unverified_order_sweep()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
begin
  perform private.require_admin('orders.manage');
  result := private.cancel_stale_pending_orders();
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'order.sweep_run', auth.uid(), result);
  return result;
end $$;
revoke all on function public.admin_run_unverified_order_sweep() from public, anon;
grant execute on function public.admin_run_unverified_order_sweep() to authenticated;

-- Sweep audit rows must be readable by orders staff (same shape as the
-- order.status_changed policy in 20261115000300). Admits orders.read
-- holders (MFA AAL2) for the two sweep actions only; widens nothing else.
create policy admin_audit_logs_orders_sweep_read on public.admin_audit_logs for select to authenticated
  using (auth.jwt()->>'aal' = 'aal2'
    and action in ('order.auto_cancelled_unverified', 'order.sweep_run')
    and (select private.has_permission('orders.read')));

commit;
