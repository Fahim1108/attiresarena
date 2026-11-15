begin;
-- Catalogue fix: staff-readable role_permissions rows (User role UI).
--
-- ROOT CAUSE (proven from the migration files, no live access needed):
-- the foundation migration enables RLS on public.role_permissions and
-- revokes ALL privileges on it from anon and authenticated, and NO later
-- migration ever grants SELECT on it or creates a SELECT policy for it.
-- Every direct PostgREST read of role_permissions therefore fails with
-- permission denied (42501) for every staff member, so the User role
-- page always shows "Live role-permission data could not be loaded" and
-- falls back to the documented role defaults — even with all 16 prior
-- migrations applied and a valid Owner + MFA session. The permission
-- CHECKS themselves work (private.has_permission is security definer
-- and reads the table past RLS); only the direct UI read is blocked.
--
-- FIX (additive only; nothing existing is changed or dropped except the
-- policy this file itself creates, for re-runnable applies):
--   * grant SELECT on role_permissions to authenticated, and
--   * a SELECT policy admitting only staff holding 'users.manage'
--     (checked by private.has_permission, which enforces MFA AAL2 at
--     the database boundary, exactly as the user_permissions_staff_read
--     policy in migration 010 and the users_staff_read policy in 006).
-- No INSERT/UPDATE/DELETE is granted: writes stay RPC-only
-- (admin_set_role_permissions, migration 013). Anonymous users gain
-- nothing. has_permission reads role_permissions as security definer,
-- so the policy calling it cannot recurse.
--
-- NEVER APPLY BLIND: apply only through an explicit, owner-approved
-- migration run against the STAGING project, after a schema-drift
-- check, and verify afterwards that the User role page shows live
-- role-permission data (no defaults notice) for an Owner + MFA session.
-- This file is UNAPPLIED until that run; the UI keeps its honest
-- defaults fallback until then.
grant select on public.role_permissions to authenticated;
drop policy if exists role_permissions_staff_read on public.role_permissions;
create policy role_permissions_staff_read on public.role_permissions
  for select to authenticated
  using ((select private.has_permission('users.manage')));
commit;
