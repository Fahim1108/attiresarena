begin;
-- Admin panel users: staff-readable role/profile lists plus role assignment.
--
-- Dependency: migration 20261115000100 (builder A) adds the users.manage
-- permission row. These policies and RPCs reference the permission name
-- only, so this migration applies cleanly before 001 but denies access
-- until the 001 grant exists.
--
-- Removing staff access deletes user_roles rows only. The auth account and
-- the profiles row are NOT deleted; assigning roles again restores access.
-- Email addresses live in Supabase Auth and are never copied here.

-- Staff with users.manage can list every staff member's roles and the
-- display names in profiles. Existing own-row policies are untouched.
create policy users_staff_read on public.user_roles for select to authenticated
  using ((select private.has_permission('users.manage')));
create policy profiles_staff_read on public.profiles for select to authenticated
  using ((select private.has_permission('users.manage')));

create function public.admin_set_user_roles(target_user uuid, new_roles text[])
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
    if role_name not in ('owner','product_manager','order_manager','customer_support','marketing_manager','analyst') then
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

create function public.admin_remove_staff(target_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  other_owners integer;
  was_owner boolean;
begin
  perform private.require_admin('users.manage');
  if target_user is null then
    raise exception 'Staff member is required' using errcode = '22023';
  end if;
  select exists (select 1 from public.user_roles where user_id = target_user and role = 'owner')
    into was_owner;
  if was_owner then
    select count(*) into other_owners from public.user_roles
      where role = 'owner' and user_id <> target_user;
    if other_owners < 1 then
      raise exception 'Cannot remove the last owner' using errcode = '22023';
    end if;
  end if;
  delete from public.user_roles where user_id = target_user;
  if not found then
    raise exception 'Staff member not found' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_remove_staff', target_user,
      jsonb_build_object('removed', true));
end $$;
revoke all on function public.admin_remove_staff(uuid) from public, anon;
grant execute on function public.admin_remove_staff(uuid) to authenticated;
commit;
