-- Admin panel catalogue: additive product/category/variant columns + RPCs.
--
-- Production-capable by design: every RPC below is SECURITY DEFINER with
-- private.require_admin (permission + MFA AAL2) and NO staging checks, NO
-- staging-URL checks and NO isProductionStorefront-style gating. The older
-- admin_save_* RPCs are staging-gated in the ACTION layer; these RPCs are
-- the production path for the new /admin/catalog/* panel and must stay so.
--
-- Additive only: every new column is nullable or defaulted, so existing
-- rows are untouched. Nothing here modifies existing tables' behaviour,
-- policies, triggers or RPCs. NEVER applied blind: the live schema is
-- unverified, so apply only through the approved migration process.
--
-- Deliberate rules (mirror the TypeScript action layer):
-- * The UI status vocabulary is Active/Inactive only. These RPCs accept
--   'published' and 'archived' ONLY and reject 'draft' outright, so a
--   product can never be (re)created as a draft through the new panel.
-- * Variant SKUs are internal only: the server generates them, the UI
--   never shows or accepts them.
-- * Existing-variant stock is NEVER changed here. Stock moves only via
--   public.adjust_inventory (audit-trailed). Variant payloads may carry an
--   initial stock value, honoured for NEW variants only.
begin;

-- ---------------------------------------------------------------- columns
alter table public.products
  add column brand text check (brand is null or length(brand) <= 120),
  add column highlights text[] not null default '{}'
    check (cardinality(highlights) <= 20),
  add column tags text[] not null default '{}'
    check (cardinality(tags) <= 20),
  add column badges text[] not null default '{}'
    check (cardinality(badges) <= 5
      and badges <@ array['Featured Product', 'Best Seller', 'New Arrival',
                          'Premium Collection', 'Free Delivery']),
  add column seo_title text check (seo_title is null or length(seo_title) <= 160),
  add column seo_description text check (seo_description is null or length(seo_description) <= 320),
  add column meta_keywords text check (meta_keywords is null or length(meta_keywords) <= 500);

alter table public.product_variants
  add column cost_price_minor bigint
    check (cost_price_minor is null
      or cost_price_minor between 0 and 9007199254740991);

alter table public.categories
  add column description text not null default ''
    check (length(description) <= 2000),
  add column image_storage_path text
    check (image_storage_path is null
      or image_storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  add column banner_storage_path text
    check (banner_storage_path is null
      or banner_storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  add column seo_title text check (seo_title is null or length(seo_title) <= 160),
  add column seo_description text check (seo_description is null or length(seo_description) <= 320),
  add column sort_position integer not null default 0 check (sort_position >= 0);

create index categories_sort_idx
  on public.categories (parent_id, sort_position, name);

-- ------------------------------------------------------- helper: text list
-- Validate a jsonb array of strings into a text[] (length + count bounds).
create function private.catalog_text_list(value jsonb, max_items integer, max_length integer)
returns text[] language plpgsql immutable set search_path = '' as $$
declare result text[];
begin
  if value is null then return '{}'::text[]; end if;
  if jsonb_typeof(value) <> 'array' then
    raise exception 'Expected a list of text values' using errcode = '22023';
  end if;
  select coalesce(array_agg(x order by ord), '{}'::text[]) into result
    from jsonb_array_elements_text(value) with ordinality as t(x, ord);
  if cardinality(result) > max_items then
    raise exception 'Too many list values' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(result) v
              where v is null or length(btrim(v)) = 0 or length(v) > max_length) then
    raise exception 'Invalid list value' using errcode = '22023';
  end if;
  return result;
end $$;
revoke all on function private.catalog_text_list(jsonb, integer, integer) from public;
grant execute on function private.catalog_text_list(jsonb, integer, integer) to authenticated;

-- ------------------------------------------------------------- create RPC
-- p: {name, slug, description, status, category_id, brand, highlights[],
--     tags[], badges[], seo_title, seo_description, meta_keywords,
--     base_price_minor, base_stock, variants: [{size, color, price_minor,
--     sale_price_minor, cost_price_minor, stock, active}]}
-- With no variants, one default variant (One Size / Standard, active) is
-- created at base_price_minor with base_stock units (form default 1).
create function public.admin_create_product(p jsonb)
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
  if name_value is null or length(name_value) not between 1 and 200
     or slug_value is null or length(slug_value) > 160
     or slug_value !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(description_value) > 20000
     or coalesce(status_value, '') not in ('published', 'archived')
     or (brand_value is not null and length(brand_value) > 120)
     or (p ->> 'seo_title' is not null and length(p ->> 'seo_title') > 160)
     or (p ->> 'seo_description' is not null and length(p ->> 'seo_description') > 320)
     or (p ->> 'meta_keywords' is not null and length(p ->> 'meta_keywords') > 500)
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
     badges, seo_title, seo_description, meta_keywords)
  values
    (product_id, category_value, name_value, slug_value, description_value, status_value,
     brand_value, highlights_value, tags_value, badges_value,
     nullif(p ->> 'seo_title', ''), nullif(p ->> 'seo_description', ''),
     nullif(p ->> 'meta_keywords', ''));

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

-- ------------------------------------------------------------- update RPC
-- Same payload shape as admin_create_product. Variants carrying an "id"
-- are updated in place (stock untouched: use adjust_inventory); variants
-- without an "id" are inserted with their initial stock. Variants absent
-- from the payload are left alone (never deleted implicitly).
create function public.admin_update_product(target_id uuid, expected_updated_at timestamptz, p jsonb)
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
  if name_value is null or length(name_value) not between 1 and 200
     or slug_value is null or length(slug_value) > 160
     or slug_value !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(description_value) > 20000
     or coalesce(status_value, '') not in ('published', 'archived')
     or (brand_value is not null and length(brand_value) > 120)
     or (p ->> 'seo_title' is not null and length(p ->> 'seo_title') > 160)
     or (p ->> 'seo_description' is not null and length(p ->> 'seo_description') > 320)
     or (p ->> 'meta_keywords' is not null and length(p ->> 'meta_keywords') > 500)
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
    meta_keywords = nullif(p ->> 'meta_keywords', '')
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

-- --------------------------------------------------------- status-only RPC
-- CREATE OR REPLACE (not plain CREATE): staging already has an
-- admin_set_product_status with this signature from the unrecorded
-- 20261104000100 migration, which exists in no repo file. The old
-- function is orphaned (the only app caller is the new admin lib, which
-- expects the semantics below), so replacing it is safe.
create or replace function public.admin_set_product_status(target_id uuid, expected_updated_at timestamptz, new_status text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare previous public.products; saved timestamptz;
begin
  perform private.require_admin('catalogue.manage');
  if coalesce(new_status, '') not in ('published', 'archived') then
    raise exception 'Status must be Active or Inactive' using errcode = '22023';
  end if;
  select * into previous from public.products where id = target_id for update;
  if not found then raise exception 'Product not found' using errcode = '22023'; end if;
  if expected_updated_at is null or previous.updated_at is distinct from expected_updated_at then
    raise exception 'Product changed; reload' using errcode = 'PT409';
  end if;
  if previous.status = new_status then return previous.updated_at; end if;
  update public.products set status = new_status where id = target_id returning updated_at into saved;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.status_changed', target_id,
          jsonb_build_object('before', previous.status, 'after', new_status));
  return saved;
end $$;
revoke all on function public.admin_set_product_status(uuid, timestamptz, text) from public, anon;
grant execute on function public.admin_set_product_status(uuid, timestamptz, text) to authenticated;

-- ------------------------------------------------------------ duplicate RPC
-- Copies the product and its variants (fresh internal SKUs). The copy
-- starts Inactive (archived), carries ZERO stock (stock is physical and
-- must never be double-counted), and does NOT copy images.
create function public.admin_duplicate_product(target_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  source public.products;
  new_id uuid := gen_random_uuid();
  new_slug text;
  attempt integer := 0;
  variant_row public.product_variants;
  new_variant_id uuid;
begin
  perform private.require_admin('catalogue.manage');
  select * into source from public.products where id = target_id for update;
  if not found then raise exception 'Product not found' using errcode = '22023'; end if;
  new_slug := source.slug || '-copy';
  while exists (select 1 from public.products where slug = new_slug) loop
    attempt := attempt + 1;
    if attempt > 100 then
      raise exception 'Could not find a free slug for the copy' using errcode = '22023';
    end if;
    new_slug := source.slug || '-copy-' || attempt;
  end loop;
  insert into public.products
    (id, category_id, name, slug, description, status, brand, highlights, tags,
     badges, seo_title, seo_description, meta_keywords)
  values
    (new_id, source.category_id, source.name, new_slug, source.description, 'archived',
     source.brand, source.highlights, source.tags, source.badges,
     source.seo_title, source.seo_description, source.meta_keywords);
  for variant_row in select * from public.product_variants where product_id = target_id order by created_at loop
    new_variant_id := gen_random_uuid();
    insert into public.product_variants
      (id, product_id, sku, size, color, price_minor, sale_price_minor,
       cost_price_minor, active)
    values
      (new_variant_id, new_id,
       'AA-' || substr(md5(gen_random_uuid()::text), 1, 12),
       variant_row.size, variant_row.color, variant_row.price_minor,
       variant_row.sale_price_minor, variant_row.cost_price_minor, variant_row.active);
    insert into public.inventory (variant_id, on_hand) values (new_variant_id, 0);
  end loop;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.duplicated', new_id,
          jsonb_build_object('source_id', target_id, 'slug', new_slug, 'status', 'archived'));
  return new_id;
end $$;
revoke all on function public.admin_duplicate_product(uuid) from public, anon;
grant execute on function public.admin_duplicate_product(uuid) to authenticated;

-- -------------------------------------------------------------- delete RPC
-- Deletes only a fully unreferenced product. Every guard raises an honest
-- 22023 message naming the blocker instead of leaking a bare FK error.
create function public.admin_delete_product(target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare previous public.products;
begin
  perform private.require_admin('catalogue.manage');
  select * into previous from public.products where id = target_id for update;
  if not found then raise exception 'Product not found' using errcode = '22023'; end if;
  if exists (select 1 from public.product_variants where product_id = target_id) then
    raise exception 'This product still has variants and cannot be deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.order_items where product_id = target_id) then
    raise exception 'This product appears in orders and cannot be deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.checkout_items where product_id = target_id) then
    raise exception 'This product appears in checkouts and cannot be deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.product_media where product_id = target_id) then
    raise exception 'Remove all product images before deleting this product' using errcode = '22023';
  end if;
  if exists (select 1 from public.product_catalogue_terms where product_id = target_id) then
    raise exception 'This product is assigned to catalogue terms and cannot be deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.thrift_intake where product_id = target_id) then
    raise exception 'This imported garment record cannot be deleted here' using errcode = '22023';
  end if;
  if exists (select 1 from public.product_reviews where product_id = target_id) then
    raise exception 'This product has reviews and cannot be deleted' using errcode = '22023';
  end if;
  delete from public.products where id = target_id;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.deleted', target_id,
          jsonb_build_object('name', previous.name, 'slug', previous.slug));
end $$;
revoke all on function public.admin_delete_product(uuid) from public, anon;
grant execute on function public.admin_delete_product(uuid) to authenticated;

-- ------------------------------------------------------------ category RPCs
-- p: {id, expected_updated_at, name, slug, parent_id, published,
--     description, image_storage_path, banner_storage_path, seo_title,
--     seo_description, sort_position}
-- Creates when the id is unused, updates otherwise (optimistic concurrency
-- via expected_updated_at, PT409 on mismatch). Max category depth is 3
-- (root = 1); parent cycles are rejected.
create function public.admin_save_category(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target_id uuid;
  previous public.categories;
  existed boolean := false;
  saved timestamptz;
  expected timestamptz;
  name_value text;
  slug_value text;
  parent_value uuid;
  published_value boolean;
  description_value text;
  image_value text;
  banner_value text;
  sort_value integer;
  walk uuid;
  parent_depth integer := 0;
  new_depth integer;
  subtree_height integer := 1;
  guard_count integer := 0;
begin
  perform private.require_admin('catalogue.manage');
  if p is null or jsonb_typeof(p) <> 'object'
     or (p ->> 'id') !~ '^[0-9a-f-]{36}$' then
    raise exception 'Invalid category payload' using errcode = '22023';
  end if;
  target_id := (p ->> 'id')::uuid;
  name_value := btrim(p ->> 'name');
  slug_value := p ->> 'slug';
  description_value := coalesce(p ->> 'description', '');
  if name_value is null or length(name_value) not between 1 and 120
     or slug_value is null or length(slug_value) > 160
     or slug_value !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(description_value) > 2000
     or coalesce(p ->> 'published', '') not in ('true', 'false')
     or (p ->> 'seo_title' is not null and length(p ->> 'seo_title') > 160)
     or (p ->> 'seo_description' is not null and length(p ->> 'seo_description') > 320)
     or (p ->> 'sort_position' is not null and (p ->> 'sort_position') !~ '^[0-9]{1,9}$')
  then
    raise exception 'Invalid category fields' using errcode = '22023';
  end if;
  published_value := (p ->> 'published')::boolean;
  sort_value := coalesce((p ->> 'sort_position')::integer, 0);
  image_value := nullif(p ->> 'image_storage_path', '');
  banner_value := nullif(p ->> 'banner_storage_path', '');
  if (image_value is not null
      and image_value !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$')
     or (banner_value is not null
      and banner_value !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'Invalid category image reference' using errcode = '22023';
  end if;
  if p ->> 'parent_id' is not null then
    if (p ->> 'parent_id') !~ '^[0-9a-f-]{36}$' then
      raise exception 'Invalid parent category' using errcode = '22023';
    end if;
    parent_value := (p ->> 'parent_id')::uuid;
    if parent_value = target_id then
      raise exception 'A category cannot be its own parent' using errcode = '22023';
    end if;
    if not exists (select 1 from public.categories where id = parent_value) then
      raise exception 'Parent category not found' using errcode = '22023';
    end if;
  end if;
  -- Walk the parent chain: reject cycles and enforce max depth 3.
  walk := parent_value;
  while walk is not null loop
    guard_count := guard_count + 1;
    if guard_count > 10 then
      raise exception 'Category hierarchy is too deep or cyclic' using errcode = '22023';
    end if;
    if walk = target_id then
      raise exception 'A category cannot be moved under its own child' using errcode = '22023';
    end if;
    parent_depth := parent_depth + 1;
    select parent_id into walk from public.categories where id = walk;
  end loop;
  new_depth := parent_depth + 1;
  if new_depth > 3 then
    raise exception 'Categories may be at most 3 levels deep' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('catalogue-category:' || target_id::text, 0));
  select * into previous from public.categories where id = target_id for update;
  existed := found;
  if existed then
    expected := (p ->> 'expected_updated_at')::timestamptz;
    if expected is null or previous.updated_at is distinct from expected then
      raise exception 'Category changed; reload' using errcode = 'PT409';
    end if;
    -- Moving a subtree must not push any descendant past depth 3.
    with recursive sub(id, d) as (
      select id, 1 from public.categories where id = target_id
      union all
      select c.id, s.d + 1 from public.categories c join sub s on c.parent_id = s.id
    ) select max(d) into subtree_height from sub;
    if new_depth + subtree_height - 1 > 3 then
      raise exception 'Moving this category would exceed 3 levels of depth' using errcode = '22023';
    end if;
  elsif p ->> 'expected_updated_at' is not null then
    raise exception 'Category changed; reload' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.categories where slug = slug_value and id <> target_id) then
    raise exception 'That URL slug already exists' using errcode = '22023';
  end if;

  if not existed then
    insert into public.categories
      (id, parent_id, name, slug, published, description,
       image_storage_path, banner_storage_path, seo_title, seo_description, sort_position)
    values
      (target_id, parent_value, name_value, slug_value, published_value, description_value,
       image_value, banner_value, nullif(p ->> 'seo_title', ''),
       nullif(p ->> 'seo_description', ''), sort_value)
    returning updated_at into saved;
  else
    update public.categories set
      parent_id = parent_value, name = name_value, slug = slug_value,
      published = published_value, description = description_value,
      image_storage_path = image_value, banner_storage_path = banner_value,
      seo_title = nullif(p ->> 'seo_title', ''),
      seo_description = nullif(p ->> 'seo_description', ''),
      sort_position = sort_value
    where id = target_id returning updated_at into saved;
  end if;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'category.saved', target_id,
          jsonb_build_object('before', case when existed then to_jsonb(previous) else null end, 'after', p));
  return target_id;
end $$;
revoke all on function public.admin_save_category(jsonb) from public, anon;
grant execute on function public.admin_save_category(jsonb) to authenticated;

create function public.admin_delete_category(target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare previous public.categories;
begin
  perform private.require_admin('catalogue.manage');
  select * into previous from public.categories where id = target_id for update;
  if not found then raise exception 'Category not found' using errcode = '22023'; end if;
  if exists (select 1 from public.categories where parent_id = target_id) then
    raise exception 'This category still has subcategories and cannot be deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.products where category_id = target_id) then
    raise exception 'Products are assigned to this category and it cannot be deleted' using errcode = '22023';
  end if;
  delete from public.categories where id = target_id;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'category.deleted', target_id,
          jsonb_build_object('name', previous.name, 'slug', previous.slug));
end $$;
revoke all on function public.admin_delete_category(uuid) from public, anon;
grant execute on function public.admin_delete_category(uuid) to authenticated;

-- Sets sort_position from the array order (0-based). Callers pass one
-- sibling group at a time; categories outside the array are untouched.
create function public.admin_reorder_categories(ordered_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin('catalogue.manage');
  if ordered_ids is null or cardinality(ordered_ids) = 0 then
    raise exception 'No categories to reorder' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(ordered_ids) x) <> cardinality(ordered_ids)
     or (select count(*) from public.categories where id = any (ordered_ids)) <> cardinality(ordered_ids) then
    raise exception 'Reorder list must contain existing categories exactly once' using errcode = '22023';
  end if;
  update public.categories
     set sort_position = array_position(ordered_ids, id) - 1
   where id = any (ordered_ids);
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'categories.reordered', ordered_ids[1],
          jsonb_build_object('ordered_ids', to_jsonb(ordered_ids)));
end $$;
revoke all on function public.admin_reorder_categories(uuid[]) from public, anon;
grant execute on function public.admin_reorder_categories(uuid[]) to authenticated;

commit;
