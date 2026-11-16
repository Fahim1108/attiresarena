begin;
-- Admin panel: payment-status updates for orders (orders + courier build).
--
-- GAP CLOSED: orders.payment_status was stored and displayed but had NO
-- update path anywhere (no RPC, no server action, no UI control). The
-- guard_order_update trigger already permits payment_status writes, so
-- this migration adds only the RPC + audit-read policy below; no trigger
-- change is needed and no trigger is touched.
--
-- LEGAL PAYMENT TRANSITIONS (coordinator decision, enforced server-side
-- here — the UI offers only legal moves, but a bypassed client is still
-- rejected by this function):
--   unpaid   -> paid, refunded
--   paid     -> refunded
--   refunded -> (terminal, no moves)
-- paid -> unpaid is FORBIDDEN. There is no order-status precondition:
-- payment status may change regardless of the order workflow status.
--
-- PATTERN: mirrors public.admin_transition_order
-- (20261115000300) exactly — require_admin('orders.manage') (permission +
-- MFA AAL2 via private.require_admin), null checks, allowlist check,
-- SELECT ... FOR UPDATE, optimistic-concurrency PT409 check on
-- expected_updated_at, same-value early return without writing, and an
-- admin_audit_logs insert. The guard trigger sees only a payment_status
-- change (status untouched), so its transition table is not involved.
--
-- AUDIT ACTION: 'order.payment_status_changed'. The detail page's status
-- history read needs the additional policy below (same shape as the
-- order.status_changed policy in 20261115000300), otherwise orders staff
-- would see an empty payment history.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run against the STAGING project, after a
-- schema-drift check. Does not depend on unapplied migrations 014/015.

create function public.admin_set_payment_status(target_order uuid, expected_updated_at timestamptz, new_payment_status text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  saved timestamptz;
begin
  perform private.require_admin('orders.manage');
  if target_order is null or expected_updated_at is null or new_payment_status is null then
    raise exception 'Invalid payment status request' using errcode = '22023';
  end if;
  if new_payment_status not in ('unpaid', 'paid', 'refunded') then
    raise exception 'Invalid payment status' using errcode = '22023';
  end if;
  select * into o from public.orders where id = target_order for update;
  if not found then raise exception 'Order not found' using errcode = '22023'; end if;
  if o.updated_at is distinct from expected_updated_at then
    raise exception 'Order changed; reload' using errcode = 'PT409';
  end if;
  if o.payment_status = new_payment_status then return o.updated_at; end if;
  -- Legal payment transitions only (see header). paid -> unpaid and any
  -- move out of refunded are rejected here, even for a bypassed client.
  if not (
    (o.payment_status = 'unpaid' and new_payment_status in ('paid', 'refunded'))
    or (o.payment_status = 'paid' and new_payment_status = 'refunded')
  ) then
    raise exception 'Invalid payment status change % to %', o.payment_status, new_payment_status using errcode = '22023';
  end if;
  -- guard_order_update permits payment_status writes; status is untouched.
  update public.orders set payment_status = new_payment_status where id = target_order returning updated_at into saved;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'order.payment_status_changed', target_order, jsonb_build_object('before', o.payment_status, 'after', new_payment_status));
  return saved;
end $$;
revoke all on function public.admin_set_payment_status(uuid, timestamptz, text) from public, anon;
grant execute on function public.admin_set_payment_status(uuid, timestamptz, text) to authenticated;

-- Payment history must be readable by orders staff (same shape as the
-- order.status_changed policy in 20261115000300). Admits orders.read
-- holders (MFA AAL2) for the payment action only; widens nothing else.
create policy admin_audit_logs_orders_payment_read on public.admin_audit_logs for select to authenticated
  using (auth.jwt()->>'aal' = 'aal2'
    and action = 'order.payment_status_changed'
    and (select private.has_permission('orders.read')));

commit;
