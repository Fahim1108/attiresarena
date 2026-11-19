begin;
-- Admin Panel: automatic 3-hour unverified-order sweep (pg_cron schedule).
--
-- THE RULE (owner decision, migration 20261116000300): an order that is
-- NOT verified from the admin panel within 3 hours of placement must
-- auto-restock; during those 3 hours the product stays locked/reserved.
-- The sweep itself already exists — private.cancel_stale_pending_orders()
-- cancels stale pending orders (pending + placed_at < now - 3h) and
-- restores stock with the same math as admin_transition_order — but it
-- only ran when staff triggered it manually, because its public wrapper
-- requires a staff JWT (require_admin('orders.manage')), which no
-- scheduler can provide. This migration adds the automatic trigger.
--
-- SCHEDULER, CHOSEN WITH EVIDENCE: in-database pg_cron (Supabase Cron).
-- Supabase's own docs (supabase.com/docs/guides/cron): "Supabase Cron
-- is a Postgres Module that simplifies scheduling recurring Cron Jobs
-- and monitoring Job runs inside Postgres. Cron Jobs can be created via
-- SQL or the Integrations -> Cron interface inside the Dashboard, and
-- can run anywhere from every second to once a year." It is the pg_cron
-- extension, included in every Supabase plan with no per-execution
-- billing (independent runs on the free plan are documented), and jobs
-- are created by one SQL call. No Vercel cron is used: a Vercel Hobby
-- cron can run at most once a day, which cannot enforce a 3-hour rule,
-- and this project needs no new external caller.
--
-- FREE-PLAN CAVEAT, STATED HONESTLY: free projects pause after 1 week
-- of inactivity, and a paused database runs no jobs. That is safe here
-- by construction: the sweep predicate has no time window — it cancels
-- EVERY stale pending order, not just ones from the last 15 minutes —
-- so a missed run is caught up by the next run. A paused project also
-- takes no new orders, so nothing can go stale while it is paused.
--
-- SAFETY (the wrapper must only ever do what the manual sweep does):
--  * The wrapper calls private.cancel_stale_pending_orders() unchanged:
--    same predicate (pending + placed_at < now - 3 hours, strict), same
--    restore math (on_hand += quantity per item + one inventory_movements
--    row per item), same skip for orders that already have a shipment
--    record (a booked parcel is never cancelled), same one-transaction
--    failure semantics (a missing inventory record aborts the whole run).
--  * The wrapper performs NO staff check — it cannot, there is no JWT in
--    a cron session — and is instead closed by grants: revoked from
--    public, anon and authenticated, granted ONLY to postgres. The only
--    caller is the pg_cron job below, which runs as the postgres role
--    (the role that schedules it). No browser, customer, or staff JWT
--    can invoke it through PostgREST.
--  * The job runs every 15 minutes, so a stale order is swept at most 15
--    minutes after it turns 3 hours old. pg_cron runs one instance of a
--    job at a time; a slow run delays the next, it never overlaps it.
--  * The schedule is an interval ('*/15 * * * *'), so the UTC default
--    timezone of pg_cron is irrelevant. cron.schedule with an existing
--    name REPLACES the job, so re-running this migration never duplicates
--    it. Runs are observable in cron.job_run_details; each swept order
--    still gets its own order.auto_cancelled_unverified audit row (the
--    per-order rows are written by the private function). The scheduled
--    run does NOT write the order.sweep_run summary row the manual run
--    writes, because that row's target is the staff user who ran it and
--    no staff user exists for a scheduled run.
--
-- DEPENDENCIES: apply AFTER 20261116000300 (the sweep itself). If
-- pg_cron is not yet enabled on the project, the create extension
-- statement below enables it from the SQL editor (it is an allowed
-- extension); the Dashboard fallback is Database -> Extensions ->
-- pg_cron. Additive only. NEVER apply blind: apply only through an
-- explicit, owner-approved migration run, after a schema-drift check.

create extension if not exists pg_cron;

-- Scheduled entry point: the same sweep, without a staff JWT. Callable
-- only by the postgres role (the pg_cron job); closed to every API role.
create function public.run_unverified_order_sweep_scheduled()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
begin
  result := private.cancel_stale_pending_orders();
  return result;
end $$;
revoke all on function public.run_unverified_order_sweep_scheduled() from public, anon, authenticated;
grant execute on function public.run_unverified_order_sweep_scheduled() to postgres;

-- Every 15 minutes, sweep everything stale. Name is stable so a re-run
-- replaces this job instead of adding a second one.
select cron.schedule(
  'attiresarena-unverified-order-sweep',
  '*/15 * * * *',
  'select public.run_unverified_order_sweep_scheduled()'
);

commit;
