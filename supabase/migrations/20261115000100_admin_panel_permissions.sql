begin;
-- Admin panel permissions (delivered, never applied blind: the live schema is
-- unverified, so this file is applied only by an explicit, owner-approved
-- migration run, like the other Phase 3 migrations).
--
-- Follows the exact precedent of 20261113000100 (Step 1) and 20261113000200
-- (Step 2): widen the role_permissions CHECK constraint with a drop + add of
-- a superset, then insert the new role rows. The insert uses
-- on conflict do nothing so re-running the migration cannot duplicate rows.
-- The seven existing permissions are kept unchanged. The role mapping mirrors
-- AREA_ROLES in frontend/claude/src/lib/admin/constants.ts.

alter table public.role_permissions drop constraint role_permissions_permission_check;
alter table public.role_permissions add constraint role_permissions_permission_check
 check (permission in ('catalogue.read','catalogue.manage','inventory.read','inventory.adjust','checkout.recover','orders.read','orders.manage','customers.read','coupons.manage','content.manage','settings.manage','users.manage','analytics.read'));
insert into public.role_permissions(role, permission) values
 ('owner','customers.read'),('owner','coupons.manage'),('owner','content.manage'),
 ('owner','settings.manage'),('owner','users.manage'),('owner','analytics.read'),
 ('order_manager','customers.read'),('order_manager','analytics.read'),
 ('customer_support','customers.read'),
 ('marketing_manager','coupons.manage'),('marketing_manager','content.manage'),
 ('marketing_manager','analytics.read'),
 ('analyst','analytics.read')
on conflict (role, permission) do nothing;
commit;
