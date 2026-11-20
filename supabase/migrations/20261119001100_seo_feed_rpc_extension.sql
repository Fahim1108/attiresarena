begin;
-- SEO follow-up M-A: expose stored SEO fields + updated_at on the two
-- public feed RPCs, plus a new public category read path.
--
-- DEPENDENCY: apply only by an explicit, owner-approved migration run,
-- after a schema-drift check (same discipline as every prior migration).
-- The app code already reads these fields leniently and falls back
-- byte-identically until this migration lands, so applying it changes
-- no behaviour other than making stored SEO values + updated_at flow.
--
-- WHAT CHANGES (additive only — no column, table, policy, or gate
-- changes; no existing key is removed or renamed):
--  * published_thrift_catalogue gains 'seo_title' / 'seo_description'
--    (from thrift_intake, caps 70/160) and 'updated_at' (from the
--    products row — thrift_intake has no touch_updated_at trigger, so
--    the product row's updated_at is the maintained one).
--  * published_admin_catalogue gains 'seo_title' / 'seo_description' /
--    'meta_keywords' / 'updated_at' (all from products). The body is
--    migration 20261115001400's verbatim, plus the four keys.
--  * New published_categories() returns published categories only
--    (id/slug/name/seo_title/seo_description/published/updated_at):
--    the public read path for category SEO, which the storefront could
--    never read before (it renders static category config). Public-safe
--    surface only — name/slug/SEO, no internals, no cost/stock data.
--
-- The sitemap's lastModified uses updated_at once this lands (creation /
-- publication date stays the fallback); category pages use the stored
-- SEO fields in their available branch. Nothing else reads these RPCs
-- differently: the qualification predicates and ordering are untouched.

-- --------------------------------- thrift feed (20261026000100 + SEO keys)
create or replace function public.published_thrift_catalogue() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'slug',p.slug,'name',p.name,'description',p.description,'variant_id',v.id,'sku',v.sku,'size',i.actual_size,'color',i.actual_color,'price_minor',i.price_minor,'in_stock',i.stock_quantity>0 and s.available>0,'image_path',i.image_path,'created_at',p.created_at,'seo_title',i.seo_title,'seo_description',i.seo_description,'updated_at',p.updated_at)), '[]'::jsonb)
 from public.thrift_intake i join public.products p on p.id=i.product_id
 join public.product_variants v on v.product_id=p.id and v.size=i.actual_size and v.color=i.actual_color and v.active
 join public.inventory s on s.variant_id=v.id
 where p.status='published' and i.size_verified and i.details_verified and i.actual_size is not null and i.actual_color is not null;
$$;
revoke all on function public.published_thrift_catalogue() from public;
grant execute on function public.published_thrift_catalogue() to anon,authenticated;

-- --------------------------------- admin feed (20261115001400 + SEO keys)
-- The feed row gains 'seo_title', 'seo_description', 'meta_keywords'
-- and 'updated_at' (null when unset). No cost fields, no SKUs: the
-- public-read scope is unchanged apart from these public-by-design
-- SEO fields and the maintenance timestamp.
create or replace function public.published_admin_catalogue(page_offset integer default 0, page_limit integer default 100)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(row_data order by published_at desc nulls last, id), '[]'::jsonb) from (
  select p.id, p.published_at, jsonb_build_object(
   'id', p.id, 'slug', p.slug, 'name', p.name, 'description', p.description,
   'category_id', p.category_id, 'youtube_video_id', p.youtube_video_id,
   'highlights', p.highlights, 'tags', p.tags, 'badges', p.badges,
   'created_at', p.created_at, 'published_at', p.published_at,
   'seo_title', p.seo_title, 'seo_description', p.seo_description,
   'meta_keywords', p.meta_keywords, 'updated_at', p.updated_at,
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

-- --------------------------------- public category read path (new)
-- Published categories only, ordered by slug for a stable response.
-- Returns the stored category SEO fields the storefront could never
-- read before, plus updated_at for sitemap lastModified. The caller
-- merges rows onto the static category config by exact slug match;
-- a DB slug that matches no static slug is ignored.
create function public.published_categories() returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id', c.id, 'slug', c.slug, 'name', c.name,
   'seo_title', c.seo_title, 'seo_description', c.seo_description,
   'published', c.published, 'updated_at', c.updated_at
  ) order by c.slug), '[]'::jsonb)
 from public.categories c
 where c.published;
$$;
revoke all on function public.published_categories() from public;
grant execute on function public.published_categories() to anon, authenticated;
commit;
