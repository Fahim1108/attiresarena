begin;
-- Abandoned-checkout sweep schedule (pg_cron).
--
-- THE GAP: private.mark_abandoned_checkout_sessions (migrations
-- 20261113000100 / 20261113000200) marks checkout sessions 'abandoned'
-- after 30 minutes of inactivity (threshold from private.checkout_settings,
-- overridable per call), but nothing ever called it — no pg_cron schedule,
-- no API route, no app code. Only the migration tests invoked it. The
-- Sales → Incomplete page and the dashboard "Incomplete" count therefore
-- always read zero, no matter how many checkouts were abandoned.
--
-- This migration adds the automatic trigger, following the exact pattern
-- of the 3-hour unverified-order sweep (migration 20261119000200,
-- job 'attiresarena-unverified-order-sweep'):
--
--  * A public wrapper, public.run_abandoned_checkout_sweep_scheduled(),
--    that calls private.mark_abandoned_checkout_sessions() with its
--    default threshold and returns the count of sessions marked. The
--    wrapper performs NO staff check — there is no JWT in a cron session
--    — and is instead closed by grants: revoked from public, anon and
--    authenticated, granted ONLY to postgres. The only caller is the
--    pg_cron job below, which runs as the postgres role. No browser,
--    customer, or staff JWT can invoke it through PostgREST.
--  * A pg_cron job 'attiresarena-abandoned-checkout-sweep', every 15
--    minutes, calling the wrapper. A session turns abandoned at most 15
--    minutes after it passes the 30-minute inactivity threshold.
--
-- SAFETY (same properties as the order sweep):
--  * The marking function is unchanged: only sessions still 'active',
--    inactive longer than the threshold, WITH at least one item are
--    marked. Completed sessions, sessions with no items, and sessions
--    already abandoned are untouched. Marking never deletes anything and
--    never touches orders, stock, or customer data — it only flips the
--    lifecycle flag so the Incomplete page can show the session.
--  * The job runs every 15 minutes, so a missed run (e.g. a paused free
--    project) is caught up by the next run: the predicate has no time
--    window — it marks EVERY stale active session, not just ones from
--    the last 15 minutes.
--  * The schedule is an interval ('*/15 * * * *'), so the UTC default
--    timezone of pg_cron is irrelevant. cron.schedule with an existing
--    name REPLACES the job, so re-running this migration never duplicates
--    it. Runs are observable in cron.job_run_details.
--  * Applying this migration runs NOTHING except creating the schedule:
--    no session is marked at apply time. The first marking happens at
--    the next 15-minute tick.
--
-- DEPENDENCIES: apply AFTER 20261113000200 (the marking function). If
-- pg_cron is not yet enabled on the project, the create extension
-- statement below enables it from the SQL editor (it is an allowed
-- extension); the Dashboard fallback is Database -> Extensions ->
-- pg_cron. Additive only. NEVER apply blind: apply only through an
-- explicit, owner-approved migration run, after a schema-drift check.

create extension if not exists pg_cron;

-- Scheduled entry point: the same marking, without a staff JWT. Callable
-- only by the postgres role (the pg_cron job); closed to every API role.
create or replace function public.run_abandoned_checkout_sweep_scheduled()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  marked integer;
begin
  marked := private.mark_abandoned_checkout_sessions();
  return marked;
end $$;
revoke all on function public.run_abandoned_checkout_sweep_scheduled() from public, anon, authenticated;
grant execute on function public.run_abandoned_checkout_sweep_scheduled() to postgres;

-- Every 15 minutes, mark everything stale. Name is stable so a re-run
-- replaces this job instead of adding a second one.
select cron.schedule(
  'attiresarena-abandoned-checkout-sweep',
  '*/15 * * * *',
  'select public.run_abandoned_checkout_sweep_scheduled()'
);

commit;
