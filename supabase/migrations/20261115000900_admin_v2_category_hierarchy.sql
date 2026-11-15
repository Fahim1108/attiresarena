-- Admin Panel v2 category hierarchy (owner item 5): primary + secondary
-- categories in category management and product assignment.
--
-- DEPENDENCIES: apply AFTER migrations 20261115000100-20261115000800 in
-- filename order (the 001-first rule still holds). NEVER applied blind:
-- the live schema is unverified, so apply only through the approved
-- migration process, after a schema-drift check.
--
-- MAPPING (no stored level column, by design): level is DERIVED from the
-- parent chain the database already enforces (admin_save_category in
-- 20261115000200: cycle rejection + max depth 3):
--   Primary category   = depth 1 (parent_id is null)
--   Secondary category = depth 2 (parent is a primary category)
--   Sub-category       = depth 3 (legacy rows keep working; the UI never
--                        creates new depth-3 categories)
-- A stored level column could drift from parent_id; the chain is the
-- truth. The TypeScript helpers (categoryLevel, validateCategoryAssignment,
-- validateCategoryLevelChoice in catalog-variants.ts) implement the same
-- mapping for the UI, and the trigger + RPC below enforce the assignment
-- rules for every write path.
--
-- WHAT THIS FILE ADDS:
-- * products.secondary_category_id (nullable FK, RESTRICT on delete) +
--   index. A product's primary category stays products.category_id.
-- * A BEFORE trigger on products validating every secondary assignment:
--   secondary requires a primary, must belong to that primary, and must
--   be a second-level category. The 002 create/update RPCs never set the
--   column, so they are unaffected; the 002 duplicate RPC does not copy
--   it, so copies start without a secondary assignment.
-- * admin_assign_product_categories: the audited, permission-gated RPC
--   the admin panel calls after creating/updating a product to set the
--   primary + secondary pair atomically (the 002 RPCs predate the column
--   and cannot set it; their definitions are NOT changed here).
-- * A BEFORE DELETE trigger on categories giving an honest error when a
--   category is referenced as a secondary category. (The 002
--   admin_delete_category guard checks category_id only; without this
--   trigger the RESTRICT FK would surface a bare FK violation.)
-- Nothing existing is modified: no column is altered, no function is
-- replaced, no policy is changed.
begin;

-- ------------------------------------------------------- secondary column
alter table public.products
  add column secondary_category_id uuid
    references public.categories(id) on delete restrict;

create index products_secondary_category_idx
  on public.products(secondary_category_id);

-- ------------------------------------------- assignment validation trigger
create function private.check_secondary_category_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  secondary_parent uuid;
  primary_parent uuid;
begin
  if new.secondary_category_id is null then
    return new;
  end if;
  if new.category_id is null then
    raise exception 'A secondary category requires a primary category' using errcode = '22023';
  end if;
  select parent_id into secondary_parent
    from public.categories where id = new.secondary_category_id;
  if secondary_parent is null then
    raise exception 'Secondary category not found' using errcode = '22023';
  end if;
  if secondary_parent is distinct from new.category_id then
    raise exception 'The secondary category must belong to the primary category' using errcode = '22023';
  end if;
  select parent_id into primary_parent
    from public.categories where id = new.category_id;
  if primary_parent is not null then
    raise exception 'The primary category must be a top-level category' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.check_secondary_category_assignment() from public, anon, authenticated;

create trigger check_secondary_category_assignment
  before insert or update of category_id, secondary_category_id on public.products
  for each row execute function private.check_secondary_category_assignment();

-- ------------------------------------------- friendly secondary-delete guard
create function private.guard_secondary_category_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.products where secondary_category_id = old.id) then
    raise exception 'Products are assigned to this category as their secondary category and it cannot be deleted' using errcode = '22023';
  end if;
  return old;
end $$;
revoke all on function private.guard_secondary_category_delete() from public, anon, authenticated;

create trigger guard_secondary_category_delete
  before delete on public.categories
  for each row execute function private.guard_secondary_category_delete();

-- ------------------------------------------------------- assignment RPC
-- Sets the primary + secondary pair atomically, with optimistic
-- concurrency (PT409) and an audit entry. Passing null for both clears
-- the assignment. The trigger above re-validates on write.
create function public.admin_assign_product_categories(
  target_id uuid, expected_updated_at timestamptz,
  primary_category_id uuid, secondary_category_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  previous public.products;
  saved timestamptz;
  secondary_parent uuid;
  primary_parent uuid;
begin
  perform private.require_admin('catalogue.manage');
  select * into previous from public.products where id = target_id for update;
  if not found then raise exception 'Product not found' using errcode = '22023'; end if;
  if expected_updated_at is null or previous.updated_at is distinct from expected_updated_at then
    raise exception 'Product changed; reload' using errcode = 'PT409';
  end if;
  if secondary_category_id is not null and primary_category_id is null then
    raise exception 'A secondary category requires a primary category' using errcode = '22023';
  end if;
  if primary_category_id is not null then
    select parent_id into primary_parent
      from public.categories where id = primary_category_id;
    if not found then raise exception 'Primary category not found' using errcode = '22023'; end if;
    if primary_parent is not null then
      raise exception 'The primary category must be a top-level category' using errcode = '22023';
    end if;
  end if;
  if secondary_category_id is not null then
    select parent_id into secondary_parent
      from public.categories where id = secondary_category_id;
    if not found then raise exception 'Secondary category not found' using errcode = '22023'; end if;
    if secondary_parent is distinct from primary_category_id then
      raise exception 'The secondary category must belong to the primary category' using errcode = '22023';
    end if;
  end if;
  update public.products
     set category_id = primary_category_id,
         secondary_category_id = secondary_category_id
   where id = target_id
   returning updated_at into saved;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.categories_assigned', target_id,
          jsonb_build_object(
            'before', jsonb_build_object('category_id', previous.category_id, 'secondary_category_id', previous.secondary_category_id),
            'after', jsonb_build_object('category_id', primary_category_id, 'secondary_category_id', secondary_category_id)));
  return saved;
end $$;
revoke all on function public.admin_assign_product_categories(uuid, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.admin_assign_product_categories(uuid, timestamptz, uuid, uuid) to authenticated;

commit;
