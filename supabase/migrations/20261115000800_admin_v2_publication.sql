-- Admin Panel v2 publication path (owner item 4): publish/unpublish for
-- admin-created products, a public feed RPC for published non-thrift
-- products, and a published-only Storage read policy for their images.
--
-- DEPENDENCIES: apply AFTER migrations 20261115000100-20261115000700 (the
-- 001-first rule still holds; this file reads the highlights/tags/badges
-- columns added by 002 and the product_media table used by 007). NEVER
-- applied blind: the live schema is unverified, so apply only through
-- the approved migration process, after a schema-drift check.
--
-- DESIGN (see frontend/claude/src/lib/catalog-publication.ts, which
-- enforces the same qualification rule a second time in the projector):
-- * Publication is a SEPARATE, explicit signal: products.is_published +
--   products.published_at. Setting a product Active (status='published')
--   in the admin panel does NOT put it on the storefront. The feed
--   requires BOTH is_published AND status='published', so setting a
--   published product Inactive also removes it (defense in depth).
-- * Unpublish sets status='archived' (Inactive), NEVER 'draft': the
--   standing exclusion forbids Draft status in the admin UI. This
--   deliberately differs from the unapplied publication proposal
--   (supabase/proposed/20261110000100), which used 'draft'.
-- * Thrift-intake products are REFUSED by both RPCs: they publish
--   through garment verification and the existing allowlist feed only.
--   The feed RPC below excludes them for the same reason.
-- * Publish readiness is enforced server-side (the browser checklist is
--   advisory only): name, description, a VISIBLE category, at least one
--   image, at least one active variant priced above 0, and available
--   stock above 0 at publish time.
--
-- IMAGE STRATEGY (deliberate change from migration 004's "Private object
-- bytes never become public through this table" comment): the bucket
-- stays private and NO bytes are copied. ONE additive Storage SELECT
-- policy lets anyone read an object ONLY while it is linked to a
-- product that is currently published, checked per request by the
-- definer function is_published_admin_product_media. Unpublishing
-- revokes image access immediately, with no stale copies. Draft,
-- archived, and unlinked objects stay staff-only, and the restrictive
-- delete/update policies from 004 are untouched. Names are deliberately
-- distinct from the unapplied proposal's (is_published_product_media /
-- published_product_media_read) so the two can never be confused.
--
-- PUBLIC READ SCOPE: the ONLY new public access is the feed RPC
-- (granted to anon + authenticated) and the Storage SELECT policy above.
-- No table-level public policy is added or changed: the feed RPC is the
-- only public path to published admin products, and it returns NO cost
-- fields and NO SKUs. All admin RPCs stay revoked from public/anon.
-- NOTE (pre-existing, NOT fixed here): the foundation product_public /
-- variant_public policies already let anon read status='published'
-- rows directly, including cost_price_minor once 002 is applied. That
-- exposure predates this migration and needs a separate owner/security
-- decision; this file neither widens nor narrows those policies.
--
-- Additive only: new columns are nullable/defaulted, new functions and
-- one new policy. Nothing existing is modified. Ordering note for
-- checkout: published non-thrift products are NOT orderable until the
-- checkout eligibility change lands separately (private.orderable_variant
-- joins thrift_intake); publishing makes them VISIBLE, not purchasable.
begin;

-- ---------------------------------------------------------------- columns
alter table public.products
  add column is_published boolean not null default false,
  add column published_at timestamptz
    check (published_at is null or is_published);

create index products_publication_idx
  on public.products (published_at desc nulls last, id)
  where is_published and status = 'published';

-- ------------------------------------------------------------- publish RPC
create function public.admin_publish_product(target_id uuid, expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  previous public.products;
  saved timestamptz;
  problems text[] := '{}';
begin
  perform private.require_admin('catalogue.manage');
  select * into previous from public.products where id = target_id for update;
  if not found then raise exception 'Product not found' using errcode = '22023'; end if;
  if expected_updated_at is null or previous.updated_at is distinct from expected_updated_at then
    raise exception 'Product changed; reload' using errcode = 'PT409';
  end if;
  if previous.is_published and previous.status = 'published' then
    return previous.updated_at;
  end if;
  if exists (select 1 from public.thrift_intake where product_id = target_id) then
    raise exception 'Thrift garments publish through garment verification, not here' using errcode = '22023';
  end if;
  if btrim(previous.name) = '' then problems := array_append(problems, 'name'); end if;
  if btrim(previous.description) = '' then problems := array_append(problems, 'description'); end if;
  if previous.category_id is null then
    problems := array_append(problems, 'category');
  elsif not exists (select 1 from public.categories where id = previous.category_id and published) then
    problems := array_append(problems, 'visible category');
  end if;
  if not exists (select 1 from public.product_media where product_id = target_id) then
    problems := array_append(problems, 'image');
  end if;
  if not exists (select 1 from public.product_variants
                  where product_id = target_id and active and price_minor > 0) then
    problems := array_append(problems, 'active priced variant');
  end if;
  if coalesce((select sum(s.available) from public.product_variants v
                join public.inventory s on s.variant_id = v.id
                where v.product_id = target_id and v.active), 0) <= 0 then
    problems := array_append(problems, 'stock');
  end if;
  if cardinality(problems) > 0 then
    raise exception 'Product is not ready to publish: %', array_to_string(problems, ', ') using errcode = '23514';
  end if;
  update public.products
     set is_published = true, published_at = clock_timestamp(), status = 'published'
   where id = target_id
   returning updated_at into saved;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.published', target_id,
          jsonb_build_object('before', jsonb_build_object('status', previous.status, 'is_published', previous.is_published),
                             'after', jsonb_build_object('status', 'published', 'is_published', true)));
  return saved;
end $$;
revoke all on function public.admin_publish_product(uuid, timestamptz) from public, anon;
grant execute on function public.admin_publish_product(uuid, timestamptz) to authenticated;

-- ----------------------------------------------------------- unpublish RPC
create function public.admin_unpublish_product(target_id uuid, expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  previous public.products;
  saved timestamptz;
begin
  perform private.require_admin('catalogue.manage');
  select * into previous from public.products where id = target_id for update;
  if not found then raise exception 'Product not found' using errcode = '22023'; end if;
  if expected_updated_at is null or previous.updated_at is distinct from expected_updated_at then
    raise exception 'Product changed; reload' using errcode = 'PT409';
  end if;
  if not previous.is_published then
    return previous.updated_at;
  end if;
  if exists (select 1 from public.thrift_intake where product_id = target_id) then
    raise exception 'Thrift garments publish through garment verification, not here' using errcode = '22023';
  end if;
  update public.products
     set is_published = false, published_at = null, status = 'archived'
   where id = target_id
   returning updated_at into saved;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.unpublished', target_id,
          jsonb_build_object('before', jsonb_build_object('status', previous.status, 'is_published', previous.is_published),
                             'after', jsonb_build_object('status', 'archived', 'is_published', false)));
  return saved;
end $$;
revoke all on function public.admin_unpublish_product(uuid, timestamptz) from public, anon;
grant execute on function public.admin_unpublish_product(uuid, timestamptz) to authenticated;

-- ------------------------------------------------- public catalogue RPC
-- Returns ONLY published non-thrift products with a visible category, at
-- least one image, and at least one active variant priced above 0. Stock
-- is NOT required at feed time: a published product with zero available
-- stock still lists (as Sold Out), matching the thrift feed. Cost prices
-- and SKUs are never returned.
create function public.published_admin_catalogue(page_offset integer default 0, page_limit integer default 100)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(row_data order by published_at desc nulls last, id), '[]'::jsonb) from (
  select p.id, p.published_at, jsonb_build_object(
   'id', p.id, 'slug', p.slug, 'name', p.name, 'description', p.description,
   'category_id', p.category_id,
   'highlights', p.highlights, 'tags', p.tags, 'badges', p.badges,
   'created_at', p.created_at, 'published_at', p.published_at,
   'variants', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'size', v.size, 'color', v.color,
      'price_minor', v.price_minor, 'sale_price_minor', v.sale_price_minor,
      'available', greatest(coalesce(s.available, 0), 0)) order by v.color, v.size), '[]'::jsonb)
     from public.product_variants v
     left join public.inventory s on s.variant_id = v.id
     where v.product_id = p.id and v.active and v.price_minor > 0),
   'media', (select coalesce(jsonb_agg(jsonb_build_object(
      'path', m.storage_path, 'alt', m.alt_text) order by m.position), '[]'::jsonb)
     from public.product_media m where m.product_id = p.id)
  ) as row_data
  from public.products p
  where p.is_published and p.status = 'published'
    and not exists (select 1 from public.thrift_intake i where i.product_id = p.id)
    and exists (select 1 from public.categories c where c.id = p.category_id and c.published)
    and exists (select 1 from public.product_media m where m.product_id = p.id)
    and exists (select 1 from public.product_variants v
                 where v.product_id = p.id and v.active and v.price_minor > 0)
  order by p.published_at desc nulls last, p.id
  offset greatest(coalesce(page_offset, 0), 0)
  limit least(greatest(coalesce(page_limit, 100), 1), 100)
 ) q;
$$;
revoke all on function public.published_admin_catalogue(integer, integer) from public;
grant execute on function public.published_admin_catalogue(integer, integer) to anon, authenticated;

-- ------------------------------ published-only Storage read check + policy
-- product_media is not readable by anon, so the check runs as a definer
-- function that reveals only a yes/no for one object path. (anon has no
-- usage on schema private, hence public.)
create function public.is_published_admin_product_media(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.product_media m join public.products p on p.id = m.product_id
  where m.storage_path = object_name and p.is_published and p.status = 'published');
$$;
revoke all on function public.is_published_admin_product_media(text) from public;
grant execute on function public.is_published_admin_product_media(text) to anon, authenticated;

create policy published_admin_product_media_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'attires-product-drafts' and public.is_published_admin_product_media(name));

commit;
