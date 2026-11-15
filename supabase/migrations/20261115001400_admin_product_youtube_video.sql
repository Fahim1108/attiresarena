-- Product video: nullable YouTube video ID on products + RPC round-trip.
--
-- STORAGE DECISION: no generic metadata/jsonb column exists on
-- public.products (verified: the foundation table has only scalar
-- columns; migration 20261030000300 adds no column — it is a
-- draft-name/description RPC only; migration 20261028000300 keeps
-- attributes/SEO on thrift_intake, not products). A dedicated
-- nullable column is the clean fit, following the seo_title /
-- meta_keywords pattern from migration 002.
--
-- CANONICAL FORM: the 11-character YouTube video ID only — never a
-- pasted URL. The admin form accepts watch / youtu.be / embed /
-- shorts links; the server action extracts the ID (see
-- frontend/claude/src/lib/youtube-video.ts) and the RPCs below
-- enforce the same ID shape. The column CHECK enforces it again at
-- the storage layer, so no other writer can store a raw URL.
--
-- DEPENDENCIES: apply AFTER migrations 20261115000200 (create/update
-- RPCs, replaced below) and 20261115000800 (feed RPC, replaced
-- below). NEVER applied blind: the live schema is unverified, so
-- apply only through the approved migration process, after a
-- schema-drift check. Until this migration is applied, the new
-- jsonb key is ignored by the old RPCs (saves stay safe; the video
-- simply does not persist) and the feed omits the field (the
-- projector treats a missing field as no video).
--
-- Additive only: one nullable column with a CHECK (existing rows
-- read NULL, untouched) plus CREATE OR REPLACE of three existing
-- functions with identical signatures, return types, SECURITY
-- DEFINER + search_path settings and grants — the bodies differ
-- from the originals ONLY by the youtube lines. No policy, trigger,
-- index or other function is touched. The duplicate RPC is
-- deliberately NOT updated: a duplicated product starts without a
-- video (the admin re-adds it), matching its no-images behaviour.
-- The video ID is public-by-design (it renders on the storefront),
-- so the pre-existing anon-readable product policies need no change
-- for this column; the separate pre-existing cost exposure is
-- untouched. SQL validity is MANUAL REVIEW ONLY: no local Postgres
-- exists in the build environment.
begin;

-- ---------------------------------------------------------------- column
alter table public.products
  add column youtube_video_id text
    check (youtube_video_id is null
      or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$');

-- ------------------------------------------- create RPC (002 + video key)
-- Payload gains one optional key: youtube_video_id (11-char ID, or
-- null/empty for no video). Identical to the 002 body otherwise.
create or replace function public.admin_create_product(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  product_id uuid := gen_random_uuid();
  v jsonb;
  name_value text;
  slug_value text;
  description_value text;
  status_value text;
  category_value uuid;
  brand_value text;
  youtube_value text;
  highlights_value text[];
  tags_value text[];
  badges_value text[];
  base_price bigint;
  base_stock integer;
  variant_count integer := 0;
  pairs text[] := '{}'::text[];
  pair_key text;
  size_value text;
  color_value text;
  price_value bigint;
  sale_value bigint;
  cost_value bigint;
  stock_value integer;
  active_value boolean;
  variant_id uuid;
  sku_value text;
begin
  perform private.require_admin('catalogue.manage');
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid product payload' using errcode = '22023';
  end if;
  name_value := btrim(p ->> 'name');
  slug_value := p ->> 'slug';
  description_value := coalesce(p ->> 'description', '');
  status_value := p ->> 'status';
  brand_value := nullif(btrim(coalesce(p ->> 'brand', '')), '');
  youtube_value := nullif(btrim(coalesce(p ->> 'youtube_video_id', '')), '');
  if name_value is null or length(name_value) not between 1 and 200
     or slug_value is null or length(slug_value) > 160
     or slug_value !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(description_value) > 20000
     or coalesce(status_value, '') not in ('published', 'archived')
     or (brand_value is not null and length(brand_value) > 120)
     or (p ->> 'seo_title' is not null and length(p ->> 'seo_title') > 160)
     or (p ->> 'seo_description' is not null and length(p ->> 'seo_description') > 320)
     or (p ->> 'meta_keywords' is not null and length(p ->> 'meta_keywords') > 500)
     or (youtube_value is not null and youtube_value !~ '^[A-Za-z0-9_-]{11}$')
  then
    raise exception 'Invalid product fields' using errcode = '22023';
  end if;
  if p ->> 'category_id' is not null then
    if (p ->> 'category_id') !~ '^[0-9a-f-]{36}$' then
      raise exception 'Invalid category' using errcode = '22023';
    end if;
    category_value := (p ->> 'category_id')::uuid;
    if not exists (select 1 from public.categories where id = category_value) then
      raise exception 'Category not found' using errcode = '22023';
    end if;
  end if;
  highlights_value := private.catalog_text_list(p -> 'highlights', 20, 200);
  tags_value := private.catalog_text_list(p -> 'tags', 20, 40);
  badges_value := private.catalog_text_list(p -> 'badges', 5, 40);
  if not (badges_value <@ array['Featured Product', 'Best Seller', 'New Arrival',
                                 'Premium Collection', 'Free Delivery']) then
    raise exception 'Unknown product badge' using errcode = '22023';
  end if;
  if exists (select 1 from public.products where slug = slug_value) then
    raise exception 'That URL slug already exists' using errcode = '22023';
  end if;
  -- Validate every variant before inserting anything.
  if p -> 'variants' is not null and jsonb_typeof(p -> 'variants') <> 'array' then
    raise exception 'Invalid variants' using errcode = '22023';
  end if;
  for v in select * from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) loop
    variant_count := variant_count + 1;
    if variant_count > 100 then
      raise exception 'Maximum 100 variants per product' using errcode = '22023';
    end if;
    size_value := btrim(v ->> 'size');
    color_value := btrim(v ->> 'color');
    if size_value is null or length(size_value) not between 1 and 40
       or upper(size_value) in ('N/A', 'NA', 'UNKNOWN')
       or color_value is null or length(color_value) not between 1 and 80
       or coalesce(v ->> 'price_minor', '') !~ '^[0-9]{1,16}$'
       or (v ->> 'sale_price_minor' is not null and v ->> 'sale_price_minor' !~ '^[0-9]{1,16}$')
       or (v ->> 'cost_price_minor' is not null and v ->> 'cost_price_minor' !~ '^[0-9]{1,16}$')
       or (v ->> 'stock' is not null and v ->> 'stock' !~ '^[0-9]{1,9}$')
       or (v ->> 'active' is not null and v ->> 'active' not in ('true', 'false'))
    then
      raise exception 'Invalid variant size, color, price or stock' using errcode = '22023';
    end if;
    price_value := (v ->> 'price_minor')::bigint;
    sale_value := (v ->> 'sale_price_minor')::bigint;
    cost_value := (v ->> 'cost_price_minor')::bigint;
    if price_value > 9007199254740991 or sale_value > price_value
       or cost_value > 9007199254740991
       or (coalesce((v ->> 'active')::boolean, true) and price_value = 0) then
      raise exception 'Invalid variant prices' using errcode = '22023';
    end if;
    pair_key := size_value || chr(31) || color_value;
    if pair_key = any (pairs) then
      raise exception 'Duplicate size and color combination' using errcode = '22023';
    end if;
    pairs := pairs || pair_key;
  end loop;
  if variant_count = 0 then
    if coalesce(p ->> 'base_price_minor', '') !~ '^[0-9]{1,16}$' then
      raise exception 'A regular price is required' using errcode = '22023';
    end if;
    base_price := (p ->> 'base_price_minor')::bigint;
    if base_price <= 0 or base_price > 9007199254740991 then
      raise exception 'A positive regular price is required' using errcode = '22023';
    end if;
    if p ->> 'base_stock' is not null and (p ->> 'base_stock') !~ '^[0-9]{1,9}$' then
      raise exception 'Invalid stock quantity' using errcode = '22023';
    end if;
    base_stock := coalesce((p ->> 'base_stock')::integer, 1);
  end if;

  insert into public.products
    (id, category_id, name, slug, description, status, brand, highlights, tags,
     badges, seo_title, seo_description, meta_keywords, youtube_video_id)
  values
    (product_id, category_value, name_value, slug_value, description_value, status_value,
     brand_value, highlights_value, tags_value, badges_value,
     nullif(p ->> 'seo_title', ''), nullif(p ->> 'seo_description', ''),
     nullif(p ->> 'meta_keywords', ''), youtube_value);

  if variant_count = 0 then
    -- Simple product: one default variant, active, holding the base stock.
    variant_id := gen_random_uuid();
    sku_value := 'AA-' || substr(md5(gen_random_uuid()::text), 1, 12);
    insert into public.product_variants
      (id, product_id, sku, size, color, price_minor, sale_price_minor,
       cost_price_minor, active)
    values
      (variant_id, product_id, sku_value, 'One Size', 'Standard', base_price,
       case when coalesce(p ->> 'base_sale_price_minor', '') ~ '^[0-9]{1,16}$'
            then (p ->> 'base_sale_price_minor')::bigint end,
       case when coalesce(p ->> 'base_cost_price_minor', '') ~ '^[0-9]{1,16}$'
            then (p ->> 'base_cost_price_minor')::bigint end,
       true);
    insert into public.inventory (variant_id, on_hand) values (variant_id, base_stock);
    if base_stock > 0 then
      insert into public.inventory_movements (variant_id, actor_id, delta, on_hand_after, reason)
      values (variant_id, auth.uid(), base_stock, base_stock, 'Initial stock on product creation');
    end if;
  else
    for v in select * from jsonb_array_elements(p -> 'variants') loop
      variant_id := gen_random_uuid();
      sku_value := 'AA-' || substr(md5(gen_random_uuid()::text), 1, 12);
      size_value := btrim(v ->> 'size');
      color_value := btrim(v ->> 'color');
      price_value := (v ->> 'price_minor')::bigint;
      sale_value := (v ->> 'sale_price_minor')::bigint;
      cost_value := (v ->> 'cost_price_minor')::bigint;
      stock_value := coalesce((v ->> 'stock')::integer, 1);
      active_value := coalesce((v ->> 'active')::boolean, true);
      insert into public.product_variants
        (id, product_id, sku, size, color, price_minor, sale_price_minor,
         cost_price_minor, active)
      values
        (variant_id, product_id, sku_value, size_value, color_value,
         price_value, sale_value, cost_value, active_value);
      insert into public.inventory (variant_id, on_hand) values (variant_id, stock_value);
      if stock_value > 0 then
        insert into public.inventory_movements (variant_id, actor_id, delta, on_hand_after, reason)
        values (variant_id, auth.uid(), stock_value, stock_value, 'Initial stock on product creation');
      end if;
    end loop;
  end if;

  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.created', product_id,
          jsonb_build_object('name', name_value, 'slug', slug_value,
                             'status', status_value, 'variant_count',
                             greatest(variant_count, 1)));
  return product_id;
end $$;
revoke all on function public.admin_create_product(jsonb) from public, anon;
grant execute on function public.admin_create_product(jsonb) to authenticated;
-- ------------------------------------------- update RPC (002 + video key)
-- Same payload addition; an absent/empty key clears the video.
create or replace function public.admin_update_product(target_id uuid, expected_updated_at timestamptz, p jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  previous public.products;
  saved timestamptz;
  v jsonb;
  name_value text;
  slug_value text;
  description_value text;
  status_value text;
  category_value uuid;
  brand_value text;
  youtube_value text;
  highlights_value text[];
  tags_value text[];
  badges_value text[];
  variant_count integer := 0;
  new_count integer := 0;
  pairs text[] := '{}'::text[];
  pair_key text;
  input_ids uuid[] := '{}'::uuid[];
  variant_uuid uuid;
  size_value text;
  color_value text;
  price_value bigint;
  sale_value bigint;
  cost_value bigint;
  stock_value integer;
  active_value boolean;
  sku_value text;
begin
  perform private.require_admin('catalogue.manage');
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid product payload' using errcode = '22023';
  end if;
  name_value := btrim(p ->> 'name');
  slug_value := p ->> 'slug';
  description_value := coalesce(p ->> 'description', '');
  status_value := p ->> 'status';
  brand_value := nullif(btrim(coalesce(p ->> 'brand', '')), '');
  youtube_value := nullif(btrim(coalesce(p ->> 'youtube_video_id', '')), '');
  if name_value is null or length(name_value) not between 1 and 200
     or slug_value is null or length(slug_value) > 160
     or slug_value !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(description_value) > 20000
     or coalesce(status_value, '') not in ('published', 'archived')
     or (brand_value is not null and length(brand_value) > 120)
     or (p ->> 'seo_title' is not null and length(p ->> 'seo_title') > 160)
     or (p ->> 'seo_description' is not null and length(p ->> 'seo_description') > 320)
     or (p ->> 'meta_keywords' is not null and length(p ->> 'meta_keywords') > 500)
     or (youtube_value is not null and youtube_value !~ '^[A-Za-z0-9_-]{11}$')
  then
    raise exception 'Invalid product fields' using errcode = '22023';
  end if;
  if p ->> 'category_id' is not null then
    if (p ->> 'category_id') !~ '^[0-9a-f-]{36}$' then
      raise exception 'Invalid category' using errcode = '22023';
    end if;
    category_value := (p ->> 'category_id')::uuid;
    if not exists (select 1 from public.categories where id = category_value) then
      raise exception 'Category not found' using errcode = '22023';
    end if;
  end if;
  highlights_value := private.catalog_text_list(p -> 'highlights', 20, 200);
  tags_value := private.catalog_text_list(p -> 'tags', 20, 40);
  badges_value := private.catalog_text_list(p -> 'badges', 5, 40);
  if not (badges_value <@ array['Featured Product', 'Best Seller', 'New Arrival',
                                 'Premium Collection', 'Free Delivery']) then
    raise exception 'Unknown product badge' using errcode = '22023';
  end if;
  if p -> 'variants' is not null and jsonb_typeof(p -> 'variants') <> 'array' then
    raise exception 'Invalid variants' using errcode = '22023';
  end if;

  select * into previous from public.products where id = target_id for update;
  if not found then raise exception 'Product not found' using errcode = '22023'; end if;
  if expected_updated_at is null or previous.updated_at is distinct from expected_updated_at then
    raise exception 'Product changed; reload' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.products where slug = slug_value and id <> target_id) then
    raise exception 'That URL slug already exists' using errcode = '22023';
  end if;

  -- Validate variants, collecting the (size, color) pairs they will hold,
  -- then check them against the variants this payload does not touch.
  for v in select * from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) loop
    variant_count := variant_count + 1;
    size_value := btrim(v ->> 'size');
    color_value := btrim(v ->> 'color');
    if size_value is null or length(size_value) not between 1 and 40
       or upper(size_value) in ('N/A', 'NA', 'UNKNOWN')
       or color_value is null or length(color_value) not between 1 and 80
       or coalesce(v ->> 'price_minor', '') !~ '^[0-9]{1,16}$'
       or (v ->> 'sale_price_minor' is not null and v ->> 'sale_price_minor' !~ '^[0-9]{1,16}$')
       or (v ->> 'cost_price_minor' is not null and v ->> 'cost_price_minor' !~ '^[0-9]{1,16}$')
       or (v ->> 'stock' is not null and v ->> 'stock' !~ '^[0-9]{1,9}$')
       or (v ->> 'active' is not null and v ->> 'active' not in ('true', 'false'))
       or (v ->> 'id' is not null and (v ->> 'id') !~ '^[0-9a-f-]{36}$')
    then
      raise exception 'Invalid variant size, color, price or stock' using errcode = '22023';
    end if;
    price_value := (v ->> 'price_minor')::bigint;
    sale_value := (v ->> 'sale_price_minor')::bigint;
    cost_value := (v ->> 'cost_price_minor')::bigint;
    if price_value > 9007199254740991 or sale_value > price_value
       or cost_value > 9007199254740991
       or (coalesce((v ->> 'active')::boolean, true) and price_value = 0) then
      raise exception 'Invalid variant prices' using errcode = '22023';
    end if;
    pair_key := size_value || chr(31) || color_value;
    if pair_key = any (pairs) then
      raise exception 'Duplicate size and color combination' using errcode = '22023';
    end if;
    pairs := pairs || pair_key;
    if v ->> 'id' is not null then
      input_ids := input_ids || (v ->> 'id')::uuid;
    else
      new_count := new_count + 1;
    end if;
  end loop;
  if (select count(*) from public.product_variants where product_id = target_id) + new_count > 100 then
    raise exception 'Maximum 100 variants per product' using errcode = '22023';
  end if;
  if exists (select 1 from public.product_variants
              where product_id = target_id and id <> all (input_ids)
                and (size || chr(31) || color) = any (pairs)) then
    raise exception 'Duplicate size and color combination' using errcode = '22023';
  end if;
  if cardinality(input_ids) > 0 and exists (
      select 1 from unnest(input_ids) x
      where not exists (select 1 from public.product_variants
                         where id = x and product_id = target_id)) then
    raise exception 'Variant does not belong to this product' using errcode = '22023';
  end if;

  update public.products set
    category_id = category_value, name = name_value, slug = slug_value,
    description = description_value, status = status_value, brand = brand_value,
    highlights = highlights_value, tags = tags_value, badges = badges_value,
    seo_title = nullif(p ->> 'seo_title', ''),
    seo_description = nullif(p ->> 'seo_description', ''),
    meta_keywords = nullif(p ->> 'meta_keywords', ''),
    youtube_video_id = youtube_value
  where id = target_id returning updated_at into saved;

  for v in select * from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) loop
    size_value := btrim(v ->> 'size');
    color_value := btrim(v ->> 'color');
    price_value := (v ->> 'price_minor')::bigint;
    sale_value := (v ->> 'sale_price_minor')::bigint;
    cost_value := (v ->> 'cost_price_minor')::bigint;
    active_value := coalesce((v ->> 'active')::boolean, true);
    if v ->> 'id' is not null then
      variant_uuid := (v ->> 'id')::uuid;
      update public.product_variants set
        size = size_value, color = color_value, price_minor = price_value,
        sale_price_minor = sale_value, cost_price_minor = cost_value,
        active = active_value
      where id = variant_uuid;
    else
      variant_uuid := gen_random_uuid();
      sku_value := 'AA-' || substr(md5(gen_random_uuid()::text), 1, 12);
      stock_value := coalesce((v ->> 'stock')::integer, 1);
      insert into public.product_variants
        (id, product_id, sku, size, color, price_minor, sale_price_minor,
         cost_price_minor, active)
      values
        (variant_uuid, target_id, sku_value, size_value, color_value,
         price_value, sale_value, cost_value, active_value);
      insert into public.inventory (variant_id, on_hand) values (variant_uuid, stock_value);
      if stock_value > 0 then
        insert into public.inventory_movements (variant_id, actor_id, delta, on_hand_after, reason)
        values (variant_uuid, auth.uid(), stock_value, stock_value, 'Initial stock on variant creation');
      end if;
    end if;
  end loop;

  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.updated', target_id,
          jsonb_build_object('before', jsonb_build_object('name', previous.name, 'slug', previous.slug, 'status', previous.status),
                             'after', jsonb_build_object('name', name_value, 'slug', slug_value, 'status', status_value,
                                                         'variant_count', variant_count)));
  return saved;
end $$;
revoke all on function public.admin_update_product(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.admin_update_product(uuid, timestamptz, jsonb) to authenticated;
-- --------------------------------- public catalogue RPC (008 + video key)
-- The feed row gains 'youtube_video_id' (null when unset). No cost
-- fields, no SKUs: the public-read scope is unchanged apart from
-- this public-by-design ID.
create or replace function public.published_admin_catalogue(page_offset integer default 0, page_limit integer default 100)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(row_data order by published_at desc nulls last, id), '[]'::jsonb) from (
  select p.id, p.published_at, jsonb_build_object(
   'id', p.id, 'slug', p.slug, 'name', p.name, 'description', p.description,
   'category_id', p.category_id, 'youtube_video_id', p.youtube_video_id,
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
commit;
