begin;
-- Checkout enforcement for blocked customers (migration 20261115000300
-- created the record only: "Blocking is NOT enforced: checkout does NOT
-- consult this table". This migration wires the enforcement in, in two
-- layers, so a blocked phone cannot place a new order from any path:
--
--  1. Fast pre-check: public.is_phone_blocked(p_phone) — a read-only
--     SECURITY DEFINER lookup the Next.js checkout service calls before
--     placing an order, so the customer gets a clear refusal instead of
--     a generic failure. It normalizes the phone with
--     private.normalize_bd_phone, so +8801… and 01… match the same
--     canonical blocked_customers row. Granted to authenticated (signed-in
--     customers) and service_role (guest checkout transport). NOT granted
--     to anon: the lookup is an oracle for whether a phone is blocked,
--     and guests never call it directly.
--  2. Backstop: BEFORE INSERT trigger on public.orders. The service layer
--     can be bypassed by calling place_checkout_order directly with a
--     customer JWT, so the database itself must refuse the insert. The
--     trigger raises errcode CK012, which the checkout service maps to
--     the customer-facing message (service.ts messages.CK012). It only
--     fires on INSERT: orders already placed are never touched, and
--     unblocking (setting unblocked_at) restores ordering immediately.
--
-- SAFETY:
--  * The trigger compares NEW.phone verbatim. orders.phone is already
--    canonical (CHECK phone ~ '^01[3-9][0-9]{8}$', normalized by
--    place_checkout_order via private.normalize_bd_phone), and
--    blocked_customers.phone has the same CHECK, so no normalization
--    mismatch is possible at the trigger layer.
--  * The trigger raises ONLY for a row whose unblocked_at IS NULL
--    (currently blocked). A phone blocked and later unblocked orders
--    normally.
--  * No existing rows are updated, no function is replaced, no policy
--    changes. Re-running this file is safe: CREATE OR REPLACE for both
--    functions, DROP TRIGGER IF EXISTS before CREATE TRIGGER, and the
--    table comment is overwritten, not appended.
--
-- DEPENDENCIES: apply AFTER 20261115000300 (blocked_customers) and
-- 20261113000200 (private.normalize_bd_phone). Until this migration is
-- applied, the service pre-check fails open (the RPC does not exist yet)
-- and blocking stays record-only — see the service.ts comment at the
-- is_phone_blocked call. NEVER apply blind: apply only through an
-- explicit, owner-approved migration run, after a schema-drift check.

-- 1. Fast pre-check for the checkout service.
create or replace function public.is_phone_blocked(p_phone text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.blocked_customers
    where phone = private.normalize_bd_phone(p_phone)
      and unblocked_at is null
  );
$$;
revoke all on function public.is_phone_blocked(text) from public, anon, authenticated;
grant execute on function public.is_phone_blocked(text) to authenticated, service_role;

-- 2. Backstop: refuse the order row itself when the phone is blocked.
create or replace function private.enforce_unblocked_phone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(
    select 1 from public.blocked_customers
    where phone = NEW.phone and unblocked_at is null
  ) then
    raise exception 'Orders cannot be placed from this mobile number right now. Please contact the store if you think this is a mistake.' using errcode = 'CK012';
  end if;
  return NEW;
end $$;
drop trigger if exists orders_blocked_phone_check on public.orders;
create trigger orders_blocked_phone_check
  before insert on public.orders
  for each row execute function private.enforce_unblocked_phone();

comment on table public.blocked_customers is
  'Blocked phones cannot place new orders. Enforced at checkout: the checkout service pre-checks public.is_phone_blocked, and the orders_blocked_phone_check trigger refuses the order row (CK012) even for direct place_checkout_order calls. Unblocking (unblocked_at set) restores ordering immediately.';

commit;
