begin;
-- Admin Panel v2: moderator/editor/admin roles, granular per-user
-- permissions, and product-cost hiding.
--
-- DEPENDENCY: apply AFTER migrations 20261115000100–20261115000700 (the
-- 001-first rule still holds). This file widens the role_permissions
-- permission CHECK to a superset that includes the 001 names; applying 001
-- after this file would narrow the CHECK again and break the new rows.
-- Never apply blind: the live schema is unverified, so this file is
-- applied only by an explicit, owner-approved migration run, after a
-- schema-drift check (in particular, verify the CHECK constraint names
-- below — they follow the PostgreSQL inline-CHECK naming convention).
--
-- What changes, and why:
-- 1. The role CHECKs on role_permissions.role and user_roles.role gain
--    'moderator', 'editor' and 'admin'. Without widening BOTH, assigning a
--    new role fails: role_permissions rows and user_roles rows would each
--    violate their own CHECK.
-- 2. The permission CHECK gains 'costs.read', the permission that gates
--    product cost prices. Only owner, product_manager and admin hold it;
--    moderators and editors never see costs.
-- 3. role_permissions CANNOT store per-user grants (it has no user_id
--    column), so granular per-user access uses a new user_permissions
--    table, and private.has_permission is extended (additively) to honour
--    it. Effective access = role grants UNION per-user grants.
-- 4. Cost hiding is enforced server-side in three places: the costs.read
--    permission, a cost-reading RPC that returns costs only to holders,
--    and a trigger that blocks cost writes without the permission.
--    RESIDUAL (honest): catalogue loaders that SELECT cost_price_minor
--    directly through PostgREST still receive the column for anyone with
--    catalogue.read until they switch to admin_variant_costs; the trigger
--    covers writes, not those reads. See the build report.

-- 1. Widen the role CHECKs (drop-if-exists + add superset, 001 precedent).
alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check
 check (role in ('owner','product_manager','order_manager','customer_support','marketing_manager','analyst','moderator','editor','admin'));
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
 check (role in ('owner','product_manager','order_manager','customer_support','marketing_manager','analyst','moderator','editor','admin'));

-- 2. Widen the permission CHECK with costs.read (superset of 001's 13).
alter table public.role_permissions drop constraint if exists role_permissions_permission_check;
alter table public.role_permissions add constraint role_permissions_permission_check
 check (permission in ('catalogue.read','catalogue.manage','inventory.read','inventory.adjust','checkout.recover','orders.read','orders.manage','customers.read','coupons.manage','content.manage','settings.manage','users.manage','analytics.read','costs.read'));

-- Default grants for the new roles, mirroring ROLE_PERMISSION_DEFAULTS in
-- frontend/claude/src/lib/admin/constants.ts. Deliberate exclusions: only
-- owner holds settings.manage/users.manage, so settings and user
-- management stay owner-only even for admin; moderators and editors hold
-- no manage permission that would let them change costs or settings.
insert into public.role_permissions(role, permission) values
 ('owner','costs.read'),
 ('product_manager','costs.read'),
 ('admin','catalogue.read'),('admin','catalogue.manage'),
 ('admin','inventory.read'),('admin','inventory.adjust'),
 ('admin','checkout.recover'),('admin','orders.read'),('admin','orders.manage'),
 ('admin','customers.read'),('admin','coupons.manage'),('admin','content.manage'),
 ('admin','analytics.read'),('admin','costs.read'),
 ('editor','catalogue.read'),('editor','catalogue.manage'),
 ('editor','inventory.read'),('editor','content.manage'),('editor','coupons.manage'),
 ('moderator','catalogue.read'),('moderator','inventory.read'),
 ('moderator','checkout.recover'),('moderator','orders.read'),
 ('moderator','customers.read'),('moderator','analytics.read')
on conflict (role, permission) do nothing;

-- 3. Per-user permission grants (additive; role grants are untouched).
create table public.user_permissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null check (permission in ('catalogue.read','catalogue.manage','inventory.read','inventory.adjust','checkout.recover','orders.read','orders.manage','customers.read','coupons.manage','content.manage','settings.manage','users.manage','analytics.read','costs.read')),
  primary key (user_id, permission)
);
comment on table public.user_permissions is
  'Per-user permission grants, additive on top of role grants. Managed only through admin_set_user_permissions. Effective access is role grants UNION user grants, checked by private.has_permission.';
alter table public.user_permissions enable row level security;
revoke all on public.user_permissions from public, anon, authenticated;
grant select on public.user_permissions to authenticated;
create policy user_permissions_staff_read on public.user_permissions for select to authenticated
  using ((select private.has_permission('users.manage')));

-- Extend has_permission additively: same anonymous guard and role check as
-- before, OR a per-user grant. Signature, volatility and grants unchanged.
create or replace function private.has_permission(required_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
 select not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) and (
   exists (
     select 1 from public.user_roles ur
     join public.role_permissions rp on rp.role = ur.role
     where ur.user_id = (select auth.uid()) and rp.permission = required_permission
   )
   or exists (
     select 1 from public.user_permissions up
     where up.user_id = (select auth.uid()) and up.permission = required_permission
   )
 );
$$;
revoke all on function private.has_permission(text) from public, anon;
grant execute on function private.has_permission(text) to authenticated;

-- Role assignment, extended for the new roles. Same signature, same
-- last-owner guard and audit behaviour as migration 006; only the role
-- allowlist grows. CREATE OR REPLACE keeps the 006 grants valid; they are
-- re-asserted below for clarity.
create or replace function public.admin_set_user_roles(target_user uuid, new_roles text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  previous_roles text[];
  role_name text;
  other_owners integer;
begin
  perform private.require_admin('users.manage');
  if target_user is null then
    raise exception 'Staff member is required' using errcode = '22023';
  end if;
  if new_roles is null then
    raise exception 'Roles are required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = target_user) then
    raise exception 'Staff member not found' using errcode = '22023';
  end if;
  foreach role_name in array new_roles loop
    if role_name not in ('owner','product_manager','order_manager','customer_support','marketing_manager','analyst','moderator','editor','admin') then
      raise exception 'Unknown role' using errcode = '22023';
    end if;
  end loop;
  if cardinality(new_roles) <> (select count(distinct r) from unnest(new_roles) as r) then
    raise exception 'Roles must not repeat' using errcode = '22023';
  end if;
  select coalesce(array_agg(role order by role), array[]::text[])
    into previous_roles from public.user_roles where user_id = target_user;
  -- Never remove the last owner: if the target currently holds owner and the
  -- new set drops it, another owner must remain.
  if coalesce('owner' = any (previous_roles), false)
    and not coalesce('owner' = any (new_roles), false) then
    select count(*) into other_owners from public.user_roles
      where role = 'owner' and user_id <> target_user;
    if other_owners < 1 then
      raise exception 'Cannot remove the last owner' using errcode = '22023';
    end if;
  end if;
  delete from public.user_roles where user_id = target_user;
  insert into public.user_roles(user_id, role)
    select target_user, r from unnest(new_roles) as r;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_set_user_roles', target_user,
      jsonb_build_object('previous_roles', previous_roles, 'new_roles', new_roles));
end $$;
revoke all on function public.admin_set_user_roles(uuid, text[]) from public, anon;
grant execute on function public.admin_set_user_roles(uuid, text[]) to authenticated;

-- Replace one user's per-user grants. Role grants are untouched.
create function public.admin_set_user_permissions(target_user uuid, new_permissions text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  permission_name text;
begin
  perform private.require_admin('users.manage');
  if target_user is null then
    raise exception 'Staff member is required' using errcode = '22023';
  end if;
  if new_permissions is null then
    raise exception 'Permissions are required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = target_user) then
    raise exception 'Staff member not found' using errcode = '22023';
  end if;
  foreach permission_name in array new_permissions loop
    if permission_name not in ('catalogue.read','catalogue.manage','inventory.read','inventory.adjust','checkout.recover','orders.read','orders.manage','customers.read','coupons.manage','content.manage','settings.manage','users.manage','analytics.read','costs.read') then
      raise exception 'Unknown permission' using errcode = '22023';
    end if;
  end loop;
  if cardinality(new_permissions) <> (select count(distinct p) from unnest(new_permissions) as p) then
    raise exception 'Permissions must not repeat' using errcode = '22023';
  end if;
  delete from public.user_permissions where user_id = target_user;
  insert into public.user_permissions(user_id, permission)
    select target_user, p from unnest(new_permissions) as p;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_set_user_permissions', target_user,
      jsonb_build_object('new_permissions', new_permissions));
end $$;
revoke all on function public.admin_set_user_permissions(uuid, text[]) from public, anon;
grant execute on function public.admin_set_user_permissions(uuid, text[]) to authenticated;

-- 4. Cost hiding: exact server-side check for loaders that need it.
create function public.admin_can_view_product_costs()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and auth.jwt()->>'aal' = 'aal2'
    and private.has_permission('costs.read');
$$;
revoke all on function public.admin_can_view_product_costs() from public, anon;
grant execute on function public.admin_can_view_product_costs() to authenticated;

-- Cost reading RPC: returns costs only to costs.read holders, bounded.
create function public.admin_variant_costs(p_variant_ids uuid[])
returns table (variant_id uuid, cost_price_minor bigint)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin('costs.read');
  if p_variant_ids is null or cardinality(p_variant_ids) = 0
    or cardinality(p_variant_ids) > 500 then
    raise exception 'Variant list is invalid' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_variant_costs', auth.uid(),
      jsonb_build_object('variant_count', cardinality(p_variant_ids)));
  return query
    select v.id, v.cost_price_minor from public.product_variants v
    where v.id = any (p_variant_ids);
end $$;
revoke all on function public.admin_variant_costs(uuid[]) from public, anon;
grant execute on function public.admin_variant_costs(uuid[]) to authenticated;

-- Cost-write guard: no session with a JWT may set or change a cost price
-- without costs.read. Direct operator sessions carry no JWT (auth.uid()
-- is null) and are unaffected. This covers the existing catalogue write
-- RPCs without changing them: an editor duplicating a product whose cost
-- would be copied is refused instead (the duplicate RPC would need a
-- follow-up change to null the cost for non-holders).
create function private.enforce_cost_permission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.cost_price_minor is not null)
     or (tg_op = 'UPDATE' and new.cost_price_minor is distinct from old.cost_price_minor) then
    if auth.uid() is not null and not private.has_permission('costs.read') then
      raise exception 'Cost prices require the costs permission' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.enforce_cost_permission() from public, anon, authenticated;
create trigger enforce_cost_permission before insert or update on public.product_variants
  for each row execute function private.enforce_cost_permission();
commit;
