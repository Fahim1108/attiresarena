begin;
-- Admin Panel V2, reference-adaptation pass (builder 5).
--
-- ORDER / DEPENDENCIES: apply after 001-012. Depends on:
--   - public.role_permissions + public.user_roles (foundation
--     20261024010934), whose rows the role-grant RPC rewrites;
--   - private.require_admin / private.has_permission (foundation, extended
--     by 010 to include per-user grants);
--   - public.admin_audit_logs (20261027000200) for audit entries;
--   - private.touch_updated_at() (foundation) for updated_at triggers;
--   - the permission seeds incl. content.manage / settings.manage /
--     users.manage / costs.read (foundation + 010).
--
-- DELIBERATE NON-EXTENSION: the store_settings allowlist (migration 011,
-- 36 keys) is NOT extended here. New reference-adaptation storage lives in
-- the dedicated tables below, so the existing settings allowlist, its
-- validations and its tests stay untouched. Copying 36 keys forward for
-- unrelated layout data would risk dropping a key (a regression) for no
-- benefit.
--
-- Contents:
--   1. public.homepage_widgets + admin_save_widget / admin_delete_widget
--      Read path: public SELECT of active rows only (storefront countdown
--      slot); staff SELECT via content.manage. Writes via RPC only.
--   2. public.url_redirects + admin_save_redirect / admin_delete_redirect
--      Stored only — no enforcement exists yet. Staff SELECT via
--      settings.manage. Writes via RPC only.
--   3. public.layout_settings + admin_set_layout_setting
--      Key/value JSONB for navigation links, footer links, error pages,
--      customize choices, the featured-categories count and the redirect
--      auto-toggle. Public SELECT of the error_404 key only (the
--      storefront 404 page); staff SELECT via content.manage or
--      settings.manage. Writes via RPC only, with per-key permission and
--      shape checks (full nested validation lives in the TypeScript zod
--      schemas; SQL enforces key allowlist, top-level shapes and bounds).
--   4. admin_set_role_permissions(p_role, p_permissions)
--      Rewrites the matrix-editable role_permissions rows for
--      moderator/editor/admin only. settings.manage/users.manage can
--      never be granted here (owner-only invariants) — existing rows
--      for those permissions are preserved, not stripped — and
--      costs.read can never be granted to moderator or editor (existing
--      rows are removed). Owner grants are untouched: the RPC refuses
--      'owner'.
--
-- NEVER apply blind: this file is additive-only and must be reviewed
-- against the live schema before any apply (live schema unverified).

/* ------------------------------------------------------------------ */
/* 1. Homepage widgets                                                 */
/* ------------------------------------------------------------------ */

create table public.homepage_widgets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  type text not null check (type in ('countdown', 'announcement')),
  placement text not null check (placement in (
    'after-hero', 'after-categories', 'after-new-arrivals', 'after-featured'
  )),
  title_visible boolean not null default true,
  title_alignment text not null default 'left' check (title_alignment in ('left', 'center')),
  title_size text not null default 'medium' check (title_size in ('small', 'medium', 'large')),
  subtitle text not null default '' check (length(subtitle) <= 200),
  ends_at timestamptz,
  offer_title text not null default '' check (length(offer_title) <= 120),
  discount_text text not null default '' check (length(discount_text) <= 120),
  style_theme text not null default 'default' check (style_theme in ('default', 'maroon', 'light', 'dark')),
  use_theme_color boolean not null default true,
  background_color text not null default '' check (background_color = '' or background_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color text not null default '' check (accent_color = '' or accent_color ~ '^#[0-9a-fA-F]{6}$'),
  title_color text not null default '' check (title_color = '' or title_color ~ '^#[0-9a-fA-F]{6}$'),
  content_color text not null default '' check (content_color = '' or content_color ~ '^#[0-9a-fA-F]{6}$'),
  sort_position integer not null default 0 check (sort_position between 0 and 999),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type <> 'countdown' or ends_at is not null)
);
create index homepage_widgets_active_idx
  on public.homepage_widgets (active, sort_position, created_at);
create trigger touch_updated_at before update on public.homepage_widgets
  for each row execute function private.touch_updated_at();

alter table public.homepage_widgets enable row level security;
revoke all on public.homepage_widgets from public, anon, authenticated;
grant select on public.homepage_widgets to anon, authenticated;
create policy homepage_widgets_public on public.homepage_widgets for select
  to anon, authenticated using (active);
create policy homepage_widgets_staff on public.homepage_widgets for select
  to authenticated using ((select private.has_permission('content.manage')));

create function public.admin_save_widget(
  p_id uuid,
  p_title text,
  p_type text,
  p_placement text,
  p_title_visible boolean,
  p_title_alignment text,
  p_title_size text,
  p_subtitle text,
  p_ends_at timestamptz,
  p_offer_title text,
  p_discount_text text,
  p_style_theme text,
  p_use_theme_color boolean,
  p_background_color text,
  p_accent_color text,
  p_title_color text,
  p_content_color text,
  p_sort_position integer,
  p_active boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  widget_id uuid;
begin
  perform private.require_admin('content.manage');
  if p_type = 'countdown' and p_ends_at is null then
    raise exception 'Countdown widgets need an end date and time' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.homepage_widgets(
      title, type, placement, title_visible, title_alignment, title_size,
      subtitle, ends_at, offer_title, discount_text, style_theme,
      use_theme_color, background_color, accent_color, title_color,
      content_color, sort_position, active
    ) values (
      p_title, p_type, p_placement, p_title_visible, p_title_alignment,
      p_title_size, p_subtitle, p_ends_at, p_offer_title, p_discount_text,
      p_style_theme, p_use_theme_color, p_background_color, p_accent_color,
      p_title_color, p_content_color, p_sort_position, p_active
    ) returning id into widget_id;
  else
    update public.homepage_widgets set
      title = p_title,
      type = p_type,
      placement = p_placement,
      title_visible = p_title_visible,
      title_alignment = p_title_alignment,
      title_size = p_title_size,
      subtitle = p_subtitle,
      ends_at = p_ends_at,
      offer_title = p_offer_title,
      discount_text = p_discount_text,
      style_theme = p_style_theme,
      use_theme_color = p_use_theme_color,
      background_color = p_background_color,
      accent_color = p_accent_color,
      title_color = p_title_color,
      content_color = p_content_color,
      sort_position = p_sort_position,
      active = p_active
    where id = p_id
    returning id into widget_id;
    if widget_id is null then
      raise exception 'Widget not found' using errcode = '22023';
    end if;
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_save_widget', widget_id,
      jsonb_build_object('title', p_title, 'type', p_type, 'active', p_active));
  return widget_id;
end $$;
revoke all on function public.admin_save_widget(uuid, text, text, text, boolean, text, text, text, timestamptz, text, text, text, boolean, text, text, text, text, integer, boolean) from public, anon;
grant execute on function public.admin_save_widget(uuid, text, text, text, boolean, text, text, text, timestamptz, text, text, text, boolean, text, text, text, text, integer, boolean) to authenticated;

create function public.admin_delete_widget(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin('content.manage');
  delete from public.homepage_widgets where id = p_id;
  if not found then
    raise exception 'Widget not found' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_delete_widget', p_id, jsonb_build_object());
end $$;
revoke all on function public.admin_delete_widget(uuid) from public, anon;
grant execute on function public.admin_delete_widget(uuid) to authenticated;

/* ------------------------------------------------------------------ */
/* 2. Redirects (stored only — no enforcement yet)                     */
/* ------------------------------------------------------------------ */

create table public.url_redirects (
  id uuid primary key default gen_random_uuid(),
  source_path text not null unique
    check (source_path ~ '^/[^[:space:]]*$' and source_path not like '//%'),
  target_path text not null check (
    (target_path ~ '^/[^[:space:]]*$' and target_path not like '//%')
    or target_path ~ '^https?://[^[:space:]]+$'
  ),
  code integer not null check (code in (301, 302)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_path is distinct from target_path)
);
create trigger touch_updated_at before update on public.url_redirects
  for each row execute function private.touch_updated_at();

alter table public.url_redirects enable row level security;
revoke all on public.url_redirects from public, anon, authenticated;
grant select on public.url_redirects to authenticated;
create policy url_redirects_staff on public.url_redirects for select
  to authenticated using ((select private.has_permission('settings.manage')));

create function public.admin_save_redirect(
  p_id uuid,
  p_source_path text,
  p_target_path text,
  p_code integer,
  p_active boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  redirect_id uuid;
begin
  perform private.require_admin('settings.manage');
  if p_source_path !~ '^/[^[:space:]]*$' or p_source_path like '//%' then
    raise exception 'Source must be a site path starting with /' using errcode = '22023';
  end if;
  if not (
    (p_target_path ~ '^/[^[:space:]]*$' and p_target_path not like '//%')
    or p_target_path ~ '^https?://[^[:space:]]+$'
  ) then
    raise exception 'Target must be a site path or a full http(s) URL' using errcode = '22023';
  end if;
  if p_source_path = p_target_path then
    raise exception 'Target must be different from the source' using errcode = '22023';
  end if;
  if p_code not in (301, 302) then
    raise exception 'Redirect code must be 301 or 302' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.url_redirects(source_path, target_path, code, active)
      values (p_source_path, p_target_path, p_code, p_active)
      returning id into redirect_id;
  else
    update public.url_redirects set
      source_path = p_source_path,
      target_path = p_target_path,
      code = p_code,
      active = p_active
    where id = p_id
    returning id into redirect_id;
    if redirect_id is null then
      raise exception 'Redirect not found' using errcode = '22023';
    end if;
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_save_redirect', redirect_id,
      jsonb_build_object('source_path', p_source_path, 'code', p_code, 'active', p_active));
  return redirect_id;
end $$;
revoke all on function public.admin_save_redirect(uuid, text, text, integer, boolean) from public, anon;
grant execute on function public.admin_save_redirect(uuid, text, text, integer, boolean) to authenticated;

create function public.admin_delete_redirect(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin('settings.manage');
  delete from public.url_redirects where id = p_id;
  if not found then
    raise exception 'Redirect not found' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_delete_redirect', p_id, jsonb_build_object());
end $$;
revoke all on function public.admin_delete_redirect(uuid) from public, anon;
grant execute on function public.admin_delete_redirect(uuid) to authenticated;

/* ------------------------------------------------------------------ */
/* 3. Layout settings (key/value JSONB)                                */
/* ------------------------------------------------------------------ */

create table public.layout_settings (
  key text primary key check (key in (
    'redirect_auto', 'featured_categories_count', 'navigation_links',
    'footer_links', 'error_404', 'error_403', 'customize_typography',
    'customize_buttons'
  )),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create trigger touch_updated_at before update on public.layout_settings
  for each row execute function private.touch_updated_at();

alter table public.layout_settings enable row level security;
revoke all on public.layout_settings from public, anon, authenticated;
grant select on public.layout_settings to anon, authenticated;
-- Only the 404 copy is public: the storefront 404 page reads it. Every
-- other key is staff-only.
create policy layout_settings_public on public.layout_settings for select
  to anon, authenticated using (key = 'error_404');
create policy layout_settings_staff on public.layout_settings for select
  to authenticated using (
    (select private.has_permission('content.manage'))
    or (select private.has_permission('settings.manage'))
  );

create function public.admin_set_layout_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  allowed_keys text[] := array[
    'redirect_auto', 'featured_categories_count', 'navigation_links',
    'footer_links', 'error_404', 'error_403', 'customize_typography',
    'customize_buttons'
  ];
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
  -- Content keys may be saved by content or settings staff (same OR
  -- pattern as the announcement bar in migration 011); the rest need
  -- settings.manage.
  if p_key in ('navigation_links', 'footer_links', 'error_404', 'error_403') then
    if not (private.has_permission('content.manage') or private.has_permission('settings.manage')) then
      raise exception 'Staff permission and MFA required' using errcode = '42501';
    end if;
  else
    perform private.require_admin('settings.manage');
  end if;
  -- Top-level shape checks. Nested validation (link hrefs, group sizes)
  -- lives in the TypeScript zod schemas; SQL enforces the shapes and
  -- bounds that keep stored values parseable.
  if p_key = 'redirect_auto' then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception 'Auto-redirect value must be true or false' using errcode = '22023';
    end if;
  elsif p_key = 'featured_categories_count' then
    if jsonb_typeof(p_value) <> 'number'
      or p_value::text !~ '^[0-9]+$'
      or (p_value::text)::integer < 1 or (p_value::text)::integer > 24 then
      raise exception 'Featured categories count must be 1-24' using errcode = '22023';
    end if;
  elsif p_key = 'navigation_links' then
    -- Sequential checks: jsonb_array_length errors on non-arrays, and OR
    -- chains can evaluate to NULL, so each guard raises on its own.
    if jsonb_typeof(p_value) <> 'array' then
      raise exception 'Navigation links value is invalid' using errcode = '22023';
    end if;
    if jsonb_array_length(p_value) > 12 then
      raise exception 'Navigation links value is invalid' using errcode = '22023';
    end if;
  elsif p_key = 'footer_links' then
    if jsonb_typeof(p_value) <> 'array' then
      raise exception 'Footer links value is invalid' using errcode = '22023';
    end if;
    if jsonb_array_length(p_value) > 4 then
      raise exception 'Footer links value is invalid' using errcode = '22023';
    end if;
  elsif p_key in ('error_404', 'error_403') then
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'Error page value is invalid' using errcode = '22023';
    end if;
    if not (p_value ?& array['title', 'subtitle', 'image_url']) then
      raise exception 'Error page value is invalid' using errcode = '22023';
    end if;
    if jsonb_typeof(p_value->'title') <> 'string'
      or length(btrim(p_value->>'title')) < 1 or length(p_value->>'title') > 80 then
      raise exception 'Error page value is invalid' using errcode = '22023';
    end if;
    if jsonb_typeof(p_value->'subtitle') <> 'string'
      or length(p_value->>'subtitle') > 200 then
      raise exception 'Error page value is invalid' using errcode = '22023';
    end if;
    if jsonb_typeof(p_value->'image_url') <> 'string'
      or length(p_value->>'image_url') > 500 then
      raise exception 'Error page value is invalid' using errcode = '22023';
    end if;
  elsif p_key = 'customize_typography' then
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'Typography value is invalid' using errcode = '22023';
    end if;
    if not (p_value ?& array['heading_font', 'body_font']) then
      raise exception 'Typography value is invalid' using errcode = '22023';
    end if;
    if (p_value->>'heading_font') not in ('cormorant', 'playfair', 'inter', 'allura')
      or (p_value->>'body_font') not in ('inter', 'cormorant') then
      raise exception 'Typography value is invalid' using errcode = '22023';
    end if;
  elsif p_key = 'customize_buttons' then
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'Button style value is invalid' using errcode = '22023';
    end if;
    if not (p_value ?& array['style', 'shape', 'radius_px']) then
      raise exception 'Button style value is invalid' using errcode = '22023';
    end if;
    if (p_value->>'style') not in ('solid', 'outline')
      or (p_value->>'shape') not in ('square', 'rounded', 'pill') then
      raise exception 'Button style value is invalid' using errcode = '22023';
    end if;
    if jsonb_typeof(p_value->'radius_px') <> 'number'
      or (p_value->>'radius_px') !~ '^[0-9]+$'
      or (p_value->>'radius_px')::integer < 0 or (p_value->>'radius_px')::integer > 24 then
      raise exception 'Button style value is invalid' using errcode = '22023';
    end if;
  end if;
  insert into public.layout_settings(key, value)
    values (p_key, p_value)
    on conflict (key) do update set value = excluded.value;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_set_layout_setting', auth.uid(), jsonb_build_object('key', p_key));
end $$;
revoke all on function public.admin_set_layout_setting(text, jsonb) from public, anon;
grant execute on function public.admin_set_layout_setting(text, jsonb) to authenticated;

/* ------------------------------------------------------------------ */
/* 4. Role-grant RPC for the access-control matrix                     */
/* ------------------------------------------------------------------ */

create function public.admin_set_role_permissions(p_role text, p_permissions text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  allowed_permissions text[] := array[
    'catalogue.read', 'catalogue.manage', 'inventory.read', 'inventory.adjust',
    'orders.read', 'orders.manage', 'checkout.recover', 'customers.read',
    'coupons.manage', 'content.manage', 'analytics.read', 'costs.read',
    'settings.manage', 'users.manage'
  ];
begin
  perform private.require_admin('users.manage');
  if p_role not in ('moderator', 'editor', 'admin') then
    raise exception 'Role cannot be edited through the access matrix' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_permissions, array[]::text[])) perm
    where perm <> all (allowed_permissions)
  ) then
    raise exception 'Permission is invalid' using errcode = '22023';
  end if;
  if coalesce(p_permissions, array[]::text[]) && array['settings.manage', 'users.manage'] then
    raise exception 'Settings and user management stay owner-only' using errcode = '22023';
  end if;
  if p_role in ('moderator', 'editor') and 'costs.read' = any (coalesce(p_permissions, array[]::text[])) then
    raise exception 'Cost prices are never visible to moderators and editors' using errcode = '22023';
  end if;
  -- Replace only the matrix-editable grants. Owner-only grants
  -- (settings.manage/users.manage) already on the role are preserved
  -- rather than silently stripped; costs.read rows on moderator/editor
  -- are removed because they can never be re-added through this RPC.
  delete from public.role_permissions
    where role = p_role
    and permission not in ('settings.manage', 'users.manage');
  insert into public.role_permissions(role, permission)
    select p_role, perm from (select distinct unnest(coalesce(p_permissions, array[]::text[])) as perm) s;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin_set_role_permissions', auth.uid(),
      jsonb_build_object('role', p_role, 'permissions', to_jsonb(coalesce(p_permissions, array[]::text[]))));
end $$;
revoke all on function public.admin_set_role_permissions(text, text[]) from public, anon;
grant execute on function public.admin_set_role_permissions(text, text[]) to authenticated;

commit;
