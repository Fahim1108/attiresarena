begin;
-- Admin panel: Steadfast courier shipment records (orders + courier build).
--
-- STORAGE DECISION (coordinator decision): a SEPARATE table, not columns
-- on public.orders. The guard_order_update trigger rejects UPDATEs that
-- touch any orders column other than status/payment_status/order_number/
-- updated_at, so storing consignment/tracking on orders would require
-- amending the guard trigger. This table avoids that entirely: no trigger
-- is touched, and no orders row is ever written by the courier flow.
--
-- WHY THE IDS ARE STORED IMMEDIATELY: Steadfast returns consignment_id
-- and tracking_code ONLY on the initial POST /create_order response; the
-- status endpoints return only delivery_status. The server action calls
-- admin_record_shipment right after a successful provider response, in
-- the same request, before reporting success to the staff member.
--
-- BOOKING GUARDS (enforced here as well as in the app, so a bypassed
-- client cannot double-book or book from a wrong status):
--  * One shipment per order: UNIQUE(order_id). A second record attempt
--    raises 'Order has already been sent to the courier'.
--  * One record per consignment: UNIQUE(consignment_id).
--  * Bookable order statuses only: confirmed and packed. Pending
--    (unverified), shipped, out-for-delivery, delivered, cancelled and
--    returned are all refused by the RPC.
--  * The RPC records a booking that ALREADY succeeded at Steadfast; it
--    never calls the provider itself and never retries.
--  * CONCURRENT attempts are serialized by the booking CLAIM
--    (migration 20261116000500), taken before the provider call: this
--    RPC + UNIQUE constraint prevent duplicate records, the claim
--    prevents duplicate parcels.
--
-- NO CANCELLATION: Steadfast provides no cancel endpoint (the Return
-- Request API is the cancellation path). No cancel RPC exists here;
-- cancelling a booked parcel happens in the Steadfast portal.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run against the STAGING project, after a
-- schema-drift check. Does not depend on unapplied migrations 014/015.

create table public.order_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  consignment_id text not null unique check (length(btrim(consignment_id)) between 1 and 100),
  tracking_code text not null check (length(btrim(tracking_code)) between 1 and 100),
  invoice text not null check (length(btrim(invoice)) between 1 and 100),
  payload jsonb not null,
  provider_status text check (provider_status is null or length(provider_status) between 1 and 80),
  booked_by uuid references auth.users(id) on delete set null,
  booked_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);
comment on table public.order_shipments is
  'One Steadfast consignment per order. consignment_id + tracking_code are returned by Steadfast only at booking time and are stored here immediately; status endpoints return only delivery_status. Booking is one-way: Steadfast has no cancel endpoint (Return Request API / portal instead).';
create index order_shipments_consignment_idx on public.order_shipments(consignment_id);
alter table public.order_shipments enable row level security;
revoke all on public.order_shipments from public, anon, authenticated;
grant select on public.order_shipments to authenticated;
create policy order_shipments_staff_read on public.order_shipments for select to authenticated
  using ((select private.has_permission('orders.read')));

-- Record a booking that already succeeded at Steadfast. Returns the new
-- shipment row id. Refuses when the order is missing, not in a bookable
-- status, or already has a shipment record.
create function public.admin_record_shipment(p_order_id uuid, p_consignment_id text, p_tracking_code text, p_invoice text, p_payload jsonb, p_provider_status text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  shipment_id uuid;
  clean_consignment text;
  clean_tracking text;
  clean_invoice text;
begin
  perform private.require_admin('orders.manage');
  clean_consignment := btrim(coalesce(p_consignment_id, ''));
  clean_tracking := btrim(coalesce(p_tracking_code, ''));
  clean_invoice := btrim(coalesce(p_invoice, ''));
  if p_order_id is null or clean_consignment = '' or clean_tracking = '' or clean_invoice = '' or p_payload is null then
    raise exception 'Invalid shipment record request' using errcode = '22023';
  end if;
  if length(clean_consignment) > 100 or length(clean_tracking) > 100 or length(clean_invoice) > 100 then
    raise exception 'Shipment reference is too long' using errcode = '22023';
  end if;
  if p_provider_status is not null and (length(p_provider_status) < 1 or length(p_provider_status) > 80) then
    raise exception 'Shipment status is invalid' using errcode = '22023';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = '22023'; end if;
  if o.status not in ('confirmed', 'packed') then
    raise exception 'Order cannot be sent to the courier from its current status' using errcode = '22023';
  end if;
  if exists (select 1 from public.order_shipments where order_id = p_order_id) then
    raise exception 'Order has already been sent to the courier' using errcode = '22023';
  end if;
  insert into public.order_shipments(order_id, consignment_id, tracking_code, invoice, payload, provider_status, booked_by)
  values (p_order_id, clean_consignment, clean_tracking, clean_invoice, p_payload, p_provider_status, auth.uid())
  returning id into shipment_id;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'order.shipment_recorded', p_order_id,
    jsonb_build_object('consignment_id', clean_consignment, 'tracking_code', clean_tracking, 'invoice', clean_invoice));
  return shipment_id;
end $$;
revoke all on function public.admin_record_shipment(uuid, text, text, text, jsonb, text) from public, anon;
grant execute on function public.admin_record_shipment(uuid, text, text, text, jsonb, text) to authenticated;

-- Shipment audit rows must be readable by orders staff (same shape as the
-- order.status_changed policy in 20261115000300). Nothing displays them
-- yet; the policy keeps the audit trail reachable when a history view
-- needs it. Admits orders.read holders (MFA AAL2) for this action only.
create policy admin_audit_logs_orders_shipment_read on public.admin_audit_logs for select to authenticated
  using (auth.jwt()->>'aal' = 'aal2'
    and action = 'order.shipment_recorded'
    and (select private.has_permission('orders.read')));

commit;
