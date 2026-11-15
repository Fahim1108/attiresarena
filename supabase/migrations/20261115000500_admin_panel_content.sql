begin;
-- Admin panel content: store settings, content blocks, banners.
--
-- Dependency: migration 20261115000100 (builder A) adds the
-- content.manage / settings.manage permission rows. These policies and RPCs
-- reference the permission names only, so this migration applies cleanly
-- before 001 but denies staff access until the 001 grants exist.
--
-- Writes go through the SECURITY DEFINER RPCs below only. No direct
-- insert/update/delete grant is given to anon/authenticated on these tables.
-- Public reads are limited to visible rows (and, for store_settings, to the
-- public-safe key allowlist). Storage policies at the end of this file are
-- additive and scoped to the banners/ and brand/ prefixes; the existing
-- draft-media policies are untouched.

create table public.store_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.store_settings is
  'Public-safe store settings. Allowed keys: announcement_bar, store_name, contact_phone, contact_email, contact_address, whatsapp_number, social_facebook, social_instagram, social_youtube, social_tiktok, footer_about, seo_default_title, seo_default_description, seo_social_image_path, seo_page_overrides, logo_storage_path, favicon_storage_path. Any other key is rejected by admin_set_setting.';

create table public.content_blocks (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text check (title is null or length(title) <= 200),
  body text not null default '' check (length(body) <= 20000),
  image_storage_path text check (image_storage_path is null or length(image_storage_path) <= 500),
  sort_position integer not null default 0 check (sort_position between 0 and 9999),
  visible boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  subtitle text check (subtitle is null or length(subtitle) <= 300),
  image_storage_path text not null check (length(image_storage_path) between 1 and 500),
  link_url text check (link_url is null or length(link_url) <= 1000),
  sort_position integer not null default 0 check (sort_position between 0 and 9999),
  visible boolean not null default true,
  placement text not null default 'hero' check (placement in ('hero', 'promo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index banners_placement_idx on public.banners(placement, sort_position, created_at);

create trigger touch_updated_at before update on public.store_settings
  for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.content_blocks
  for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.banners
  for each row execute function private.touch_updated_at();

alter table public.store_settings enable row level security;
alter table public.content_blocks enable row level security;
alter table public.banners enable row level security;
revoke all on public.store_settings, public.content_blocks, public.banners
  from public, anon, authenticated;
grant select on public.store_settings, public.content_blocks, public.banners
  to anon, authenticated;

-- Public (anonymous storefront) reads: visible rows only, and for
-- store_settings only the allowlisted public-safe keys.
create policy store_settings_public on public.store_settings for select
  to anon, authenticated using (key in (
    'announcement_bar','store_name','contact_phone','contact_email',
    'contact_address','whatsapp_number','social_facebook','social_instagram',
    'social_youtube','social_tiktok','footer_about','seo_default_title',
    'seo_default_description','seo_social_image_path','seo_page_overrides',
    'logo_storage_path','favicon_storage_path'
  ));
create policy store_settings_staff on public.store_settings for select
  to authenticated using (
    (select private.has_permission('settings.manage'))
    or (select private.has_permission('content.manage'))
  );
create policy content_blocks_public on public.content_blocks for select
  to anon, authenticated using (visible);
create policy content_blocks_staff on public.content_blocks for select
  to authenticated using ((select private.has_permission('content.manage')));
create policy banners_public on public.banners for select
  to anon, authenticated using (visible);
create policy banners_staff on public.banners for select
  to authenticated using ((select private.has_permission('content.manage')));

-- Settings write. The announcement bar is edited from the Content area, so
-- content.manage may set that one key; every other key needs settings.manage.
-- admin_audit_logs.target_id is a uuid, so text-keyed resources record the
-- actor id there and carry the key in the changes payload.
create function public.admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  allowed_keys text[] := array[
    'announcement_bar','store_name','contact_phone','contact_email',
    'contact_address','whatsapp_number','social_facebook','social_instagram',
    'social_youtube','social_tiktok','footer_about','seo_default_title',
    'seo_default_description','seo_social_image_path','seo_page_overrides',
    'logo_storage_path','favicon_storage_path'
  ];
  text_value text;
begin
  if p_key is null or not (p_key = any (allowed_keys)) then
    raise exception 'Setting key is not allowed' using errcode = '22023';
  end if;
  if p_value is null or length(p_value::text) > 8000 then
    raise exception 'Setting value is invalid' using errcode = '22023';
  end if;
  if auth.uid() is null or auth.jwt()->>'aal' is distinct from 'aal2' then
    raise exception 'Staff permission and MFA required' using errcode = '42501';
  end if;
  if p_key = 'announcement_bar' then
    if not (private.has_permission('content.manage') or private.has_permission('settings.manage')) then
      raise exception 'Staff permission and MFA required' using errcode = '42501';
    end if;
    if jsonb_typeof(p_value) <> 'object'
      or not (p_value ? 'text') or not (p_value ? 'visible')
      or jsonb_typeof(p_value->'text') <> 'string'
      or jsonb_typeof(p_value->'visible') <> 'boolean'
      or length(btrim(p_value->>'text')) < 1 or length(p_value->>'text') > 200 then
      raise exception 'Announcement bar value is invalid' using errcode = '22023';
    end if;
  else
    perform private.require_admin('settings.manage');
    if p_key in ('social_facebook','social_instagram','social_youtube','social_tiktok') then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception 'Social link must be text' using errcode = '22023';
      end if;
      text_value := p_value #>> '{}';
      if text_value <> '' and text_value !~ '^https?://' then
        raise exception 'Social link must start with http:// or https://' using errcode = '22023';
      end if;
    elsif p_key in ('logo_storage_path','favicon_storage_path','seo_social_image_path') then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception 'Image path must be text' using errcode = '22023';
      end if;
      text_value := p_value #>> '{}';
      if text_value <> '' and text_value !~ '^brand/' then
        raise exception 'Image path must use the brand/ prefix' using errcode = '22023';
      end if;
    elsif p_key = 'seo_page_overrides' then
      if jsonb_typeof(p_value) <> 'object' then
        raise exception 'Page overrides must be an object' using errcode = '22023';
      end if;
    elsif jsonb_typeof(p_value) <> 'string' then
      raise exception 'Setting value must be text' using errcode = '22023';
    end if;
  end if;
  insert into public.store_settings(key, value, updated_by)
    values (p_key, p_value, auth.uid())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_set_setting', auth.uid(), jsonb_build_object('key', p_key, 'value', p_value));
end $$;
revoke all on function public.admin_set_setting(text, jsonb) from public, anon;
grant execute on function public.admin_set_setting(text, jsonb) to authenticated;

create function public.admin_save_content_block(
  p_slug text, p_title text, p_body text, p_image_storage_path text,
  p_sort_position integer, p_visible boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin('content.manage');
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Slug is invalid' using errcode = '22023';
  end if;
  if p_title is not null and length(p_title) > 200 then
    raise exception 'Title is too long' using errcode = '22023';
  end if;
  if p_body is null or length(p_body) > 20000 then
    raise exception 'Body is invalid' using errcode = '22023';
  end if;
  if p_image_storage_path is not null
    and p_image_storage_path !~ '^(banners|brand)/' then
    raise exception 'Image path must use the banners/ or brand/ prefix' using errcode = '22023';
  end if;
  if p_sort_position is null or p_sort_position < 0 or p_sort_position > 9999 then
    raise exception 'Sort position is invalid' using errcode = '22023';
  end if;
  insert into public.content_blocks(slug, title, body, image_storage_path, sort_position, visible, updated_by)
    values (p_slug, nullif(btrim(coalesce(p_title, '')), ''), p_body,
      nullif(p_image_storage_path, ''), p_sort_position, coalesce(p_visible, true), auth.uid())
    on conflict (slug) do update set
      title = excluded.title, body = excluded.body,
      image_storage_path = excluded.image_storage_path,
      sort_position = excluded.sort_position, visible = excluded.visible,
      updated_by = excluded.updated_by;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_save_content_block', auth.uid(), jsonb_build_object('slug', p_slug, 'visible', coalesce(p_visible, true)));
end $$;
revoke all on function public.admin_save_content_block(text, text, text, text, integer, boolean) from public, anon;
grant execute on function public.admin_save_content_block(text, text, text, text, integer, boolean) to authenticated;

create function public.admin_delete_content_block(p_slug text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin('content.manage');
  delete from public.content_blocks where slug = p_slug;
  if not found then
    raise exception 'Content block not found' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_delete_content_block', auth.uid(), jsonb_build_object('slug', p_slug));
end $$;
revoke all on function public.admin_delete_content_block(text) from public, anon;
grant execute on function public.admin_delete_content_block(text) to authenticated;

create function public.admin_save_banner(
  p_id uuid, p_title text, p_subtitle text, p_image_storage_path text,
  p_link_url text, p_sort_position integer, p_visible boolean, p_placement text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  banner_id uuid := coalesce(p_id, gen_random_uuid());
  clean_link text := nullif(btrim(coalesce(p_link_url, '')), '');
begin
  perform private.require_admin('content.manage');
  if p_title is null or length(btrim(p_title)) < 1 or length(p_title) > 200 then
    raise exception 'Banner title is invalid' using errcode = '22023';
  end if;
  if p_subtitle is not null and length(p_subtitle) > 300 then
    raise exception 'Banner subtitle is too long' using errcode = '22023';
  end if;
  if p_image_storage_path is null or p_image_storage_path !~ '^banners/' or length(p_image_storage_path) > 500 then
    raise exception 'Banner image path must use the banners/ prefix' using errcode = '22023';
  end if;
  if clean_link is not null and clean_link !~ '^(/|https?://)' then
    raise exception 'Banner link must be a site path or an http(s) URL' using errcode = '22023';
  end if;
  if p_sort_position is null or p_sort_position < 0 or p_sort_position > 9999 then
    raise exception 'Sort position is invalid' using errcode = '22023';
  end if;
  if p_placement not in ('hero', 'promo') then
    raise exception 'Placement is invalid' using errcode = '22023';
  end if;
  insert into public.banners(id, title, subtitle, image_storage_path, link_url, sort_position, visible, placement)
    values (banner_id, btrim(p_title), nullif(btrim(coalesce(p_subtitle, '')), ''),
      p_image_storage_path, clean_link, p_sort_position, coalesce(p_visible, true), p_placement)
    on conflict (id) do update set
      title = excluded.title, subtitle = excluded.subtitle,
      image_storage_path = excluded.image_storage_path, link_url = excluded.link_url,
      sort_position = excluded.sort_position, visible = excluded.visible,
      placement = excluded.placement;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_save_banner', banner_id, jsonb_build_object('title', btrim(p_title), 'placement', p_placement));
  return banner_id;
end $$;
revoke all on function public.admin_save_banner(uuid, text, text, text, text, integer, boolean, text) from public, anon;
grant execute on function public.admin_save_banner(uuid, text, text, text, text, integer, boolean, text) to authenticated;

create function public.admin_delete_banner(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin('content.manage');
  delete from public.banners where id = p_id;
  if not found then
    raise exception 'Banner not found' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_delete_banner', p_id, jsonb_build_object('id', p_id));
end $$;
revoke all on function public.admin_delete_banner(uuid) from public, anon;
grant execute on function public.admin_delete_banner(uuid) to authenticated;

create function public.admin_reorder_banners(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  banner_count integer;
begin
  perform private.require_admin('content.manage');
  if p_ids is null then
    raise exception 'Banner order is invalid' using errcode = '22023';
  end if;
  select count(*) into banner_count from public.banners;
  if cardinality(p_ids) <> banner_count then
    raise exception 'Banner order must list every banner exactly once' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_ids) with ordinality as u(id, position)
    where not exists (select 1 from public.banners b where b.id = u.id)
  ) then
    raise exception 'Banner order contains an unknown banner' using errcode = '22023';
  end if;
  update public.banners b set sort_position = u.position - 1
    from unnest(p_ids) with ordinality as u(id, position)
    where b.id = u.id;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_reorder_banners', auth.uid(), jsonb_build_object('order', p_ids));
end $$;
revoke all on function public.admin_reorder_banners(uuid[]) from public, anon;
grant execute on function public.admin_reorder_banners(uuid[]) to authenticated;

-- Content media in the existing private bucket. The existing draft-media
-- policies require the first folder to be the uploader's uid and
-- catalogue.manage; content editors (content.manage / settings.manage) use
-- the banners/ and brand/ prefixes instead. These policies are additive:
-- they grant nothing to anon and nothing outside the two prefixes.
-- Bucket configuration (private, 5 MiB, jpeg/png/webp) is unchanged, and
-- the application enforces a 768 KiB Server Action limit.
create policy content_media_read on storage.objects for select to authenticated
  using (bucket_id = 'attires-product-drafts' and auth.jwt()->>'aal' = 'aal2'
    and (storage.foldername(name))[1] in ('banners', 'brand')
    and ((select private.has_permission('content.manage'))
      or (select private.has_permission('settings.manage'))));
create policy content_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attires-product-drafts' and auth.jwt()->>'aal' = 'aal2'
    and (storage.foldername(name))[1] in ('banners', 'brand')
    and ((select private.has_permission('content.manage'))
      or (select private.has_permission('settings.manage'))));
create policy content_media_update on storage.objects for update to authenticated
  using (bucket_id = 'attires-product-drafts' and auth.jwt()->>'aal' = 'aal2'
    and (storage.foldername(name))[1] in ('banners', 'brand')
    and ((select private.has_permission('content.manage'))
      or (select private.has_permission('settings.manage'))))
  with check (bucket_id = 'attires-product-drafts' and auth.jwt()->>'aal' = 'aal2'
    and (storage.foldername(name))[1] in ('banners', 'brand')
    and ((select private.has_permission('content.manage'))
      or (select private.has_permission('settings.manage'))));
create policy content_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attires-product-drafts' and auth.jwt()->>'aal' = 'aal2'
    and (storage.foldername(name))[1] in ('banners', 'brand')
    and ((select private.has_permission('content.manage'))
      or (select private.has_permission('settings.manage'))));
commit;
