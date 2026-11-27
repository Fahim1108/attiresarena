begin;
-- Revived = a Lost checkout returns to pending (back in the follow-up queue).
--
-- Fahim's decision (2026-11-27): on an Incomplete Order, "Mark as Revived"
-- must put a Lost row back to 'pending' so staff can follow up again.
-- Until now Revived could not persist at all: the guard trigger only
-- allowed lost -> recovered, and the RPC allowlist was ('contacted','lost')
-- only, so 'pending' was refused with 22023 'Invalid recovery status'.
--
-- This migration does exactly two one-line changes, both in
-- 20261113000100_abandoned_checkout_recovery.sql, re-created here with
-- CREATE OR REPLACE (bodies copied verbatim apart from the marked lines):
--  1. Guard trigger: lost may now also go to 'pending'
--     (lost -> recovered via a linked purchase is unchanged).
--  2. RPC admin_set_checkout_recovery_status: 'pending' joins the
--     new_status allowlist, so staff can set it manually.
--
-- What does NOT change (deliberate):
--  * Manual 'recovered' is still refused by the RPC (22023 'Recovery is
--    recorded only from a linked purchase'). 'recovered' still means a
--    real linked purchase only; the checkout_sessions CHECKs for
--    recovered (recovered_at + completed lifecycle + order_id) are
--    untouched.
--  * contacted -> pending is NOT allowed: Revived is only offered on
--    Lost rows (see RecoveryActions.tsx). contacted -> lost/recovered
--    and pending -> contacted/lost/recovered are unchanged.
--  * No data change: no existing row is updated by this migration.
--
-- APPLY: staging first, then production, only through an explicit,
-- owner-approved migration run, after a drift check. One transaction
-- (begin; ... commit;); on any error nothing is applied.

-- 1. Guard trigger: allow lost -> pending (Revived).
create or replace function private.guard_checkout_session_update() returns trigger
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
  or (old.recovery_status = 'lost' and new.recovery_status in ('recovered','pending'))) then
  raise exception 'Invalid recovery transition % to %', old.recovery_status, new.recovery_status using errcode = '22023';
 end if;
 return new;
end $$;
revoke all on function private.guard_checkout_session_update() from public, anon, authenticated;

-- 2. RPC: allow 'pending' as a manual new_status (Revived).
-- 'recovered' is deliberately refused here: it is only reachable through a linked purchase.
create or replace function public.admin_set_checkout_recovery_status(target_session uuid, expected_updated_at timestamptz,
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
 if new_status not in ('contacted','lost','pending') then
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
