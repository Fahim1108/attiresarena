begin;
-- SEO follow-up M-B: allow the google_search_console_verification
-- setting key (migration 011 follow-up).
--
-- DEPENDENCY: apply only by an explicit, owner-approved migration run,
-- after a schema-drift check (same discipline as every prior migration).
-- The app code (SETTING_KEYS + schema + admin form + save path) lands
-- with this file; until it is applied, saving the key fails at the DB
-- allowlist and the render path keeps working only if the value was
-- stored by some other means.
--
-- WHAT CHANGES (additive only — the 011 key set plus one key):
--  * store_settings_public policy: the token is public-readable, by the
--    same rationale as the other SEO keys — it is rendered in the page
--    <head> as a google-site-verification meta tag anyway.
--  * admin_set_setting: the key joins allowed_keys, with the same
--    validation the render path already uses (parseGoogleVerification
--    in src/lib/seo.ts: trimmed, <=500 chars, no whitespace, no
--    markup-significant characters; empty clears it).
-- Nothing else in migration 011 is re-applied here: custom code and
-- marketing secrets are untouched.

comment on table public.store_settings is
  'Public-safe store settings. Allowed keys: announcement_bar, store_name, contact_phone, contact_email, contact_address, whatsapp_number, social_facebook, social_instagram, social_youtube, social_tiktok, footer_about, seo_default_title, seo_default_description, seo_social_image_path, seo_page_overrides, logo_storage_path, favicon_storage_path, meta_pixel_id, meta_pixel_events, ga_measurement_id, sms_provider, sms_sender_id, sms_enabled, custom_head_code, custom_body_code, seo_keywords, seo_og_title, seo_og_description, seo_og_image_url, seo_twitter_card, seo_canonical_base_url, seo_robots, seo_sitemap, google_search_console_verification, display_currency, display_timezone, low_stock_threshold. Custom code keys are writable only via admin_set_custom_code. The SMS API secret is not a setting key; it lives in marketing_secrets. Any other key is rejected by admin_set_setting.';

-- Public reads: the original 17 keys plus the public-safe v2 keys.
drop policy if exists store_settings_public on public.store_settings;
create policy store_settings_public on public.store_settings for select
  to anon, authenticated using (key in (
    'announcement_bar','store_name','contact_phone','contact_email',
    'contact_address','whatsapp_number','social_facebook','social_instagram',
    'social_youtube','social_tiktok','footer_about','seo_default_title',
    'seo_default_description','seo_social_image_path','seo_page_overrides',
    'logo_storage_path','favicon_storage_path',
    'meta_pixel_id','meta_pixel_events','ga_measurement_id',
    'custom_head_code','custom_body_code',
    'seo_keywords','seo_og_title','seo_og_description','seo_og_image_url',
    'seo_twitter_card','seo_canonical_base_url','seo_robots','seo_sitemap',
    'google_search_console_verification'
  ));

-- Settings write, extended. Same signature, MFA and permission behaviour
-- as migration 005; the announcement-bar branch is unchanged. New keys get
-- shape validation here so a malformed value can never be stored through
-- the RPC, even from a direct PostgREST call.
create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  allowed_keys text[] := array[
    'announcement_bar','store_name','contact_phone','contact_email',
    'contact_address','whatsapp_number','social_facebook','social_instagram',
    'social_youtube','social_tiktok','footer_about','seo_default_title',
    'seo_default_description','seo_social_image_path','seo_page_overrides',
    'logo_storage_path','favicon_storage_path',
    'meta_pixel_id','meta_pixel_events','ga_measurement_id',
    'sms_provider','sms_sender_id','sms_enabled',
    'custom_head_code','custom_body_code',
    'seo_keywords','seo_og_title','seo_og_description','seo_og_image_url',
    'seo_twitter_card','seo_canonical_base_url','seo_robots','seo_sitemap',
    'google_search_console_verification',
    'display_currency','display_timezone','low_stock_threshold'
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
  if p_key in ('custom_head_code','custom_body_code') then
    raise exception 'Custom code must be saved through the owner-only action' using errcode = '42501';
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
    elsif p_key = 'meta_pixel_id' then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception 'Pixel ID must be text' using errcode = '22023';
      end if;
      text_value := p_value #>> '{}';
      if text_value <> '' and text_value !~ '^[0-9]{5,20}$' then
        raise exception 'Pixel ID must be 5-20 digits' using errcode = '22023';
      end if;
    elsif p_key = 'meta_pixel_events' then
      if jsonb_typeof(p_value) <> 'object'
        or not (p_value ?& array['PageView','ViewContent','AddToCart','InitiateCheckout','Purchase']) then
        raise exception 'Pixel events value is invalid' using errcode = '22023';
      end if;
    elsif p_key = 'ga_measurement_id' then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception 'Measurement ID must be text' using errcode = '22023';
      end if;
      text_value := p_value #>> '{}';
      if text_value <> '' and text_value !~ '^G-[A-Z0-9]{4,20}$' then
        raise exception 'Measurement ID is invalid' using errcode = '22023';
      end if;
    elsif p_key in ('sms_provider','sms_sender_id') then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception 'SMS setting must be text' using errcode = '22023';
      end if;
      text_value := p_value #>> '{}';
      if length(text_value) > 80 then
        raise exception 'SMS setting is too long' using errcode = '22023';
      end if;
    elsif p_key = 'sms_enabled' then
      if jsonb_typeof(p_value) <> 'boolean' then
        raise exception 'SMS enabled must be true or false' using errcode = '22023';
      end if;
    elsif p_key in ('seo_keywords','seo_og_title','seo_og_description') then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception 'SEO setting must be text' using errcode = '22023';
      end if;
      if length(p_value #>> '{}') > 500 then
        raise exception 'SEO setting is too long' using errcode = '22023';
      end if;
    elsif p_key in ('seo_og_image_url','seo_canonical_base_url') then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception 'SEO URL must be text' using errcode = '22023';
      end if;
      text_value := p_value #>> '{}';
      if text_value <> '' and text_value !~ '^https?://' then
        raise exception 'SEO URL must start with http:// or https://' using errcode = '22023';
      end if;
    elsif p_key = 'seo_twitter_card' then
      if jsonb_typeof(p_value) <> 'string'
        or (p_value #>> '{}') not in ('summary','summary_large_image') then
        raise exception 'Twitter card type is invalid' using errcode = '22023';
      end if;
    elsif p_key = 'seo_robots' then
      if jsonb_typeof(p_value) <> 'object'
        or not (p_value ? 'index') or not (p_value ? 'follow')
        or jsonb_typeof(p_value->'index') is distinct from 'boolean'
        or jsonb_typeof(p_value->'follow') is distinct from 'boolean' then
        raise exception 'Robots value is invalid' using errcode = '22023';
      end if;
    elsif p_key = 'seo_sitemap' then
      if jsonb_typeof(p_value) <> 'object'
        or not (p_value ?& array['includeShop','includeCategories','includePolicies','includeProducts']) then
        raise exception 'Sitemap value is invalid' using errcode = '22023';
      end if;
    elsif p_key = 'google_search_console_verification' then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception 'Search Console verification must be text' using errcode = '22023';
      end if;
      text_value := p_value #>> '{}';
      if text_value <> '' and (length(text_value) > 500 or text_value ~ '\s' or text_value ~ '[<>"'']') then
        raise exception 'Search Console verification is invalid' using errcode = '22023';
      end if;
    elsif p_key in ('display_currency','display_timezone') then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception 'Display setting must be text' using errcode = '22023';
      end if;
      text_value := p_value #>> '{}';
      if length(btrim(text_value)) < 1 or length(text_value) > 64 then
        raise exception 'Display setting is invalid' using errcode = '22023';
      end if;
    elsif p_key = 'low_stock_threshold' then
      if jsonb_typeof(p_value) <> 'number'
        or p_value::text !~ '^[0-9]+$'
        or (p_value::text)::integer < 0 or (p_value::text)::integer > 999 then
        raise exception 'Low-stock threshold must be 0-999' using errcode = '22023';
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
commit;
