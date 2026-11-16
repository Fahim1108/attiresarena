begin;
-- Admin panel: Steadfast courier BOOKING CLAIMS (orders + courier build,
-- review fix M3). This file closes the concurrent double-booking window:
-- the booked-state probe + admin_record_shipment's UNIQUE(order_id)
-- backstop prevent duplicate RECORDS, but two simultaneous attempts
-- would both probe "not booked" and both call Steadfast, creating two
-- real parcels. The claim row below is taken BEFORE the provider call,
-- so the second concurrent attempt is refused before it can book.
--
-- CLAIM LIFECYCLE (enforced by the RPCs; the app never writes this
-- table directly):
--  * pending: the booking is in progress (provider call running or
--    about to run). A second claim attempt for the same order is
--    refused with 'Courier booking already in progress'.
--  * ambiguous: the provider outcome is UNKNOWN (timeout / network
--    failure / unreadable response / HTTP 5xx / record save failed
--    after provider success). Re-booking is BLOCKED until the owner
--    checks the Steadfast portal and clears the claim with
--    admin_clear_ambiguous_courier_booking_claim. An ambiguous claim
--    is NEVER silently overwritten by a fresh claim and NEVER expires
--    on its own: a parcel may exist, and only a human portal check
--    can settle that.
--  * Released (row deleted): on a definite provider refusal (no parcel
--    exists, retry is safe) or after the shipment record is saved
--    (the shipment record then guards re-booking).
--
-- STALE PENDING CLAIMS: a pending claim older than 15 minutes is
-- treated as orphaned (the provider call times out at 15 seconds, so
-- a live booking can never hold a claim that long — the only way one
-- gets that old is a crashed or abandoned request) and the claim RPC
-- deletes it before taking a fresh claim. Ambiguous claims are never
-- stale-reclaimed.
--
-- GUARDS (mirroring admin_record_shipment, so a bypassed client cannot
-- claim a wrong-status or already-booked order): the claim RPC refuses
-- missing orders, non-bookable statuses, and orders that already have
-- a shipment record. The UNIQUE(order_id) constraint + the
-- unique_violation handler serialize the last remaining race between
-- the existence check and the insert.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run against the STAGING project, after a
-- schema-drift check. Apply AFTER 20261116000200 in the same run: the
-- claim RPC reads public.order_shipments (PL/pgSQL resolves the table
-- at execution time, so this file still applies without 002 — but the
-- claim then fails loudly at runtime instead of booking blind, which
-- is the safe failure). Does not depend on unapplied migrations
-- 014/015.

create table public.courier_booking_claims (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  state text not null check (state in ('pending', 'ambiguous')),
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
comment on table public.courier_booking_claims is
  'One in-flight Steadfast booking claim per order. pending = a booking attempt is running (concurrent attempts refused); ambiguous = the provider outcome is unknown and re-booking is blocked until the owner checks the Steadfast portal and clears the claim. Claims are written only by the admin_* RPCs below; the app never touches this table directly.';
create trigger touch_updated_at before update on public.courier_booking_claims
  for each row execute function private.touch_updated_at();
alter table public.courier_booking_claims enable row level security;
revoke all on public.courier_booking_claims from public, anon, authenticated;
-- No policies and no grants: the RPCs below are the only access path
-- (same shape as private.smtp_config in 20261116000400).

-- Take the booking claim for an order, BEFORE any provider call.
-- Returns the new claim row id. Refuses when the order is missing, not
-- in a bookable status, already booked, already claimed (pending), or
-- blocked by an ambiguous outcome. A stale pending claim (older than
-- 15 minutes) is reclaimed first.
create function public.admin_claim_courier_booking(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  existing public.courier_booking_claims;
  claim_id uuid;
begin
  perform private.require_admin('orders.manage');
  if p_order_id is null then
    raise exception 'Invalid courier booking claim request' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = '22023'; end if;
  if o.status not in ('confirmed', 'packed') then
    raise exception 'Order cannot be sent to the courier from its current status' using errcode = '22023';
  end if;
  if exists (select 1 from public.order_shipments where order_id = p_order_id) then
    raise exception 'Order has already been sent to the courier' using errcode = '22023';
  end if;
  -- A pending claim older than 15 minutes is orphaned (the provider
  -- call times out at 15 seconds); reclaim it. Ambiguous claims are
  -- never reclaimed here.
  delete from public.courier_booking_claims
   where order_id = p_order_id and state = 'pending'
     and claimed_at < clock_timestamp() - interval '15 minutes';
  select * into existing from public.courier_booking_claims where order_id = p_order_id for update;
  if found then
    if existing.state = 'ambiguous' then
      raise exception 'Courier booking outcome unknown for this order — check the Steadfast portal before trying again' using errcode = '22023';
    end if;
    raise exception 'Courier booking already in progress for this order' using errcode = '22023';
  end if;
  begin
    insert into public.courier_booking_claims(order_id, state, claimed_by)
    values (p_order_id, 'pending', auth.uid())
    returning id into claim_id;
  exception when unique_violation then
    -- A concurrent claim won the insert between the check above and
    -- this insert: the second attempt is refused, before any
    -- provider call, which is exactly the guarantee this table exists
    -- to provide.
    raise exception 'Courier booking already in progress for this order' using errcode = '22023';
  end;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'order.courier_booking_claimed', p_order_id,
    jsonb_build_object('state', 'pending'));
  return claim_id;
end $$;
revoke all on function public.admin_claim_courier_booking(uuid) from public, anon;
grant execute on function public.admin_claim_courier_booking(uuid) to authenticated;

-- Release a PENDING claim after a definite refusal or a recorded
-- booking, so a later retry is possible. Refuses to release an
-- AMBIGUOUS claim: only the clear RPC below (after a portal check) may
-- remove one. No claim row is a silent no-op.
create function public.admin_release_courier_booking_claim(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  existing public.courier_booking_claims;
begin
  perform private.require_admin('orders.manage');
  if p_order_id is null then
    raise exception 'Invalid courier booking claim request' using errcode = '22023';
  end if;
  select * into existing from public.courier_booking_claims where order_id = p_order_id for update;
  if not found then return; end if;
  if existing.state = 'ambiguous' then
    raise exception 'Courier booking outcome unknown for this order — check the Steadfast portal before trying again' using errcode = '22023';
  end if;
  delete from public.courier_booking_claims where id = existing.id;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'order.courier_booking_claim_released', p_order_id,
    jsonb_build_object('state', 'pending'));
end $$;
revoke all on function public.admin_release_courier_booking_claim(uuid) from public, anon;
grant execute on function public.admin_release_courier_booking_claim(uuid) to authenticated;

-- Mark a PENDING claim AMBIGUOUS after an unknown provider outcome (or
-- a record failure after provider success). The claim then blocks
-- re-booking until cleared. Missing claims are a silent no-op: the
-- caller is already handling a failure and must not throw a second one.
create function public.admin_mark_courier_booking_claim_ambiguous(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  found_claim boolean := false;
begin
  perform private.require_admin('orders.manage');
  if p_order_id is null then
    raise exception 'Invalid courier booking claim request' using errcode = '22023';
  end if;
  update public.courier_booking_claims set state = 'ambiguous'
   where order_id = p_order_id and state = 'pending';
  found_claim := found;
  if found_claim then
    insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'order.courier_booking_claim_ambiguous', p_order_id,
      jsonb_build_object('state', 'ambiguous'));
  end if;
end $$;
revoke all on function public.admin_mark_courier_booking_claim_ambiguous(uuid) from public, anon;
grant execute on function public.admin_mark_courier_booking_claim_ambiguous(uuid) to authenticated;

-- Clear an AMBIGUOUS claim AFTER the owner has checked the Steadfast
-- portal and confirmed no parcel exists. This is the ONLY way an
-- ambiguous claim is removed, and it exists so one ambiguous outcome
-- does not block an order forever. Refuses to clear a PENDING claim
-- (a booking is in flight) — clearing that would reopen the race.
-- No claim row is a silent no-op.
create function public.admin_clear_ambiguous_courier_booking_claim(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  existing public.courier_booking_claims;
begin
  perform private.require_admin('orders.manage');
  if p_order_id is null then
    raise exception 'Invalid courier booking claim request' using errcode = '22023';
  end if;
  select * into existing from public.courier_booking_claims where order_id = p_order_id for update;
  if not found then return; end if;
  if existing.state = 'pending' then
    raise exception 'Courier booking already in progress for this order' using errcode = '22023';
  end if;
  delete from public.courier_booking_claims where id = existing.id;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'order.courier_booking_claim_cleared', p_order_id,
    jsonb_build_object('state', 'ambiguous'));
end $$;
revoke all on function public.admin_clear_ambiguous_courier_booking_claim(uuid) from public, anon;
grant execute on function public.admin_clear_ambiguous_courier_booking_claim(uuid) to authenticated;

-- Claim audit rows must be readable by orders staff (same shape as the
-- order.shipment_recorded policy in 20261116000200). Admits orders.read
-- holders (MFA AAL2) for the four claim actions only.
create policy admin_audit_logs_orders_claim_read on public.admin_audit_logs for select to authenticated
  using (auth.jwt()->>'aal' = 'aal2'
    and action in ('order.courier_booking_claimed', 'order.courier_booking_claim_released',
      'order.courier_booking_claim_ambiguous', 'order.courier_booking_claim_cleared')
    and (select private.has_permission('orders.read')));

commit;
