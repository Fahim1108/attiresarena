begin;

-- DELIVERY ZONE SETTINGS (2026-11-22, Fahim voice request).
--
-- Admin-editable delivery zones: the admin picks ANY of Bangladesh's 64
-- districts as the "Inside" zone and edits both charges (Inside + Outside).
-- The storefront, the checkout estimate and the advance amount all read the
-- saved values; nothing in the charge path is hardcoded any more.
--
-- PREREQUISITE: 20261121000300 must already be applied (it created the
-- delivery_inside_barishal_city_minor / delivery_outside_barishal_city_minor
-- columns this migration renames). Do NOT apply 20261121000100 or
-- 20261121000200 after this file.
--
-- INSIDE-ZONE DEFINITION CHANGE (explicit): "Inside" used to mean only
-- Barishal Sadar upazila of Barishal district. From this migration it means
-- the WHOLE selected district (delivery_inside_district, default
-- 'Barishal'): every upazila of that district pays the inside charge.
-- The old upazila rule is gone, in the app and in the checkout function.
--
-- HOW IT STAYS IN SYNC: the admin writes three public.store_settings keys
-- (delivery_inside_district, delivery_inside_charge_minor,
-- delivery_outside_charge_minor). The storefront reads those keys. The
-- trigger below mirrors them into the single private.checkout_settings row
-- that place_checkout_order reads, so the server-charged amount can never
-- drift from what the storefront shows.
--
-- REPEAT ORDERS (Fahim, voice 2026-11-22): one account / one phone number
-- must be able to place unlimited orders. The live caps were
-- orders_per_phone_per_day = 2 (CK006, 3rd order in 24h refused) and
-- orders_per_client_per_hour = 5 (CK005). Both are set to 100000, the
-- column CHECK maximum, which effectively removes the caps. No app-code
-- change is needed for this part.

-- 1. Generic charge columns + inside district on the checkout settings.
alter table private.checkout_settings
  rename column delivery_inside_barishal_city_minor to delivery_inside_minor;
alter table private.checkout_settings
  rename column delivery_outside_barishal_city_minor to delivery_outside_minor;
alter table private.checkout_settings
  add column delivery_inside_district text not null default 'Barishal';

-- Repeat-order caps lifted to the column maximum (see header note).
update private.checkout_settings
  set orders_per_phone_per_day = 100000,
      orders_per_client_per_hour = 100000,
      updated_at = clock_timestamp();

-- 2. Mirror the three admin-editable delivery keys into checkout_settings.
-- Security definer so the trigger can write the private table whichever
-- role saves the setting. Defensive by design: a sync problem must never
-- block an admin save (the storefront still shows the saved values; the
-- checkout keeps charging the last synced ones until the next save).
create or replace function private.sync_delivery_settings_from_store()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.key = 'delivery_inside_district'
       and jsonb_typeof(new.value) = 'string'
       and length(btrim(new.value #>> '{}')) between 1 and 64 then
      update private.checkout_settings
        set delivery_inside_district = btrim(new.value #>> '{}'),
            updated_at = clock_timestamp();
    elsif new.key in ('delivery_inside_charge_minor', 'delivery_outside_charge_minor')
       and jsonb_typeof(new.value) = 'number'
       and new.value::text ~ '^[0-9]+$'
       and (new.value::text)::bigint between 0 and 1000000 then
      if new.key = 'delivery_inside_charge_minor' then
        update private.checkout_settings
          set delivery_inside_minor = (new.value::text)::bigint,
              updated_at = clock_timestamp();
      else
        update private.checkout_settings
          set delivery_outside_minor = (new.value::text)::bigint,
              updated_at = clock_timestamp();
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists store_settings_delivery_sync on public.store_settings;
create trigger store_settings_delivery_sync
  after insert or update of value on public.store_settings
  for each row when (new.key in ('delivery_inside_district','delivery_inside_charge_minor','delivery_outside_charge_minor'))
  execute function private.sync_delivery_settings_from_store();

-- 3. Seed the delivery keys with today's values (Barishal / 5000 / 14000).
-- Existing rows win: a DB that already has them keeps its values. The
-- trigger above fires on these inserts and mirrors them into
-- checkout_settings (a no-op there, the renamed columns already hold
-- 5000 / 14000 and the district defaults to 'Barishal').
insert into public.store_settings(key, value, updated_by) values
  ('delivery_inside_district', '"Barishal"', null),
  ('delivery_inside_charge_minor', '5000', null),
  ('delivery_outside_charge_minor', '14000', null)
  on conflict (key) do nothing;

-- 4. Public-read allowlist: the storefront reads the delivery keys as
-- anonymous (same pattern as the other public-safe keys).
comment on table public.store_settings is
  'Public-safe store settings. Allowed keys: announcement_bar, store_name, contact_phone, contact_email, contact_address, whatsapp_number, social_facebook, social_instagram, social_youtube, social_tiktok, footer_about, seo_default_title, seo_default_description, seo_social_image_path, seo_page_overrides, logo_storage_path, favicon_storage_path, meta_pixel_id, meta_pixel_events, ga_measurement_id, sms_provider, sms_sender_id, sms_enabled, custom_head_code, custom_body_code, seo_keywords, seo_og_title, seo_og_description, seo_og_image_url, seo_twitter_card, seo_canonical_base_url, seo_robots, seo_sitemap, google_search_console_verification, display_currency, display_timezone, low_stock_threshold, delivery_inside_district, delivery_inside_charge_minor, delivery_outside_charge_minor. Custom code keys are writable only via admin_set_custom_code. The SMS API secret is not a setting key; it lives in marketing_secrets. Any other key is rejected by admin_set_setting.';

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
    'google_search_console_verification',
    'delivery_inside_district','delivery_inside_charge_minor','delivery_outside_charge_minor'
  ));

-- 5. Admin write path: the three delivery keys join admin_set_setting
-- (same signature, MFA and settings.manage behaviour as before), with
-- shape validation so a malformed value can never be stored, even from a
-- direct PostgREST call. The full function below is the 20261119000400
-- version verbatim except the allowlist and the three new branches.
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
    'display_currency','display_timezone','low_stock_threshold',
    'delivery_inside_district','delivery_inside_charge_minor','delivery_outside_charge_minor'
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
    elsif p_key = 'delivery_inside_district' then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception 'Inside district must be text' using errcode = '22023';
      end if;
      text_value := p_value #>> '{}';
      if length(btrim(text_value)) < 1 or length(text_value) > 64 then
        raise exception 'Inside district is invalid' using errcode = '22023';
      end if;
    elsif p_key in ('delivery_inside_charge_minor','delivery_outside_charge_minor') then
      if jsonb_typeof(p_value) <> 'number'
        or p_value::text !~ '^[0-9]+$'
        or (p_value::text)::bigint < 0 or (p_value::text)::bigint > 1000000 then
        raise exception 'Delivery charge must be 0-1000000 minor units' using errcode = '22023';
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
-- 6. place_checkout_order redefined with the district zone rule.
-- The full 8-arg function below is the 20261121000300 version verbatim
-- except the delivery-charge comment and CASE (inside = the saved
-- district, charges from the renamed columns). CREATE OR REPLACE keeps
-- the existing grants (no drops, no re-grant needed).
create or replace function public.place_checkout_order(raw_token text, delivery jsonb, payment_method text,
 order_note text default null, client_key text default null, expected_items jsonb default null,
 p_coupon_code text default null, p_payment jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.checkout_sessions; cfg private.checkout_settings; item record; info record; stock record;
 new_order uuid := gen_random_uuid(); number integer; subtotal bigint := 0; delivery_charge bigint; total bigint;
 now_ts timestamptz := clock_timestamp(); lines integer := 0; after_stock integer; units integer; subject text; v_phone text;
 v_division text; v_district text; v_area text; v_address text; v_note text;
 discount bigint := 0; coupon_id uuid; validation jsonb; clean_code text;
 v_provider text; v_txid text; v_sender text; v_idem text;
begin
 subject := private.checkout_caller_subject(client_key);
 s := private.locked_checkout_session(raw_token);

 -- Idempotency: a session that already produced an order returns that order. A retry with the
 -- same items succeeds at any later time. A different cart is refused, and the server then starts
 -- a new checkout. Retries never consume the rate limit.
 if s.order_id is not null then
  if expected_items is not null and not private.same_checkout_items(s.order_id, expected_items) then
   raise exception 'This checkout already produced an order with different items' using errcode = 'CK004';
  end if;
  return private.checkout_order_result(s.order_id, true);
 end if;

 perform private.require_orders_enabled();
 select * into strict cfg from private.checkout_settings;
 if s.lifecycle_status not in ('active','abandoned') then
  raise exception 'Checkout session is no longer active' using errcode = '22023';
 end if;

 v_division := btrim(coalesce(delivery->>'division', '')); v_district := btrim(coalesce(delivery->>'district', ''));
 v_area := btrim(coalesce(delivery->>'area', '')); v_address := btrim(coalesce(delivery->>'address_line', ''));
 v_note := nullif(btrim(coalesce(order_note, '')), '');
 if delivery is null or jsonb_typeof(delivery) <> 'object'
  or length(v_area) not between 1 and 120 or length(v_address) not between 8 and 500
  or length(coalesce(v_note, 'x')) > 500 then
  raise exception 'Enter a complete delivery address' using errcode = '22023';
 end if;
 if not exists(select 1 from private.delivery_locations l where l.division = v_division and l.district = v_district) then
  raise exception 'The district does not belong to the division' using errcode = 'CK007';
 end if;
 if payment_method is distinct from 'cod' then
  raise exception 'Only Cash on Delivery is available' using errcode = '22023';
 end if;

 perform private.consume_checkout_rate('place', subject, interval '1 hour', cfg.orders_per_client_per_hour);

 v_phone := private.normalize_bd_phone(s.phone);
 perform pg_advisory_xact_lock(hashtextextended('phone:' || v_phone, 0));
 if (select count(*) from public.orders o where o.phone = v_phone and o.placed_at > clock_timestamp() - interval '1 day')
    >= cfg.orders_per_phone_per_day then
  raise exception 'Too many orders for this mobile number today' using errcode = 'CK006';
 end if;

 select coalesce(sum(quantity), 0) into units from public.checkout_items where checkout_session_id = s.id;
 if units > cfg.max_units_per_order then
  raise exception 'Too many items in one order' using errcode = 'CK010';
 end if;

 -- Items come from the database in a fixed order, so concurrent orders cannot deadlock.
 for item in select * from public.checkout_items where checkout_session_id = s.id order by variant_id loop
  select * into info from private.orderable_variant(item.variant_id);
  if not found or not info.orderable then
   raise exception 'A product in your order is no longer available' using errcode = 'CK001';
  end if;
  if item.quantity <> 1 then
   raise exception 'Only one of each item is available' using errcode = 'CK011';
  end if;
  select * into stock from public.inventory where variant_id = item.variant_id for update;
  if not found or stock.available < item.quantity then
   raise exception 'Not enough stock' using errcode = 'CK002';
  end if;
  update public.checkout_items set regular_price_minor = info.regular_price_minor,
    unit_price_minor = info.unit_price_minor, price_snapshot_at = now_ts where id = item.id;
  subtotal := subtotal + info.unit_price_minor * item.quantity; lines := lines + 1;
 end loop;
 if lines = 0 then raise exception 'Your checkout is empty' using errcode = 'CK003'; end if;

 -- Coupon: validated by public.validate_coupon against the server-computed
 -- subtotal. The coupon row is locked so concurrent redemptions cannot race
 -- the usage limits. A coupon that no longer applies refuses the order
 -- (CK009) instead of placing it at full price.
 if p_coupon_code is not null and btrim(p_coupon_code) <> '' then
  clean_code := upper(btrim(p_coupon_code));
  select id into coupon_id from public.coupons where code = clean_code for update;
  if coupon_id is null then
   raise exception 'Coupon could not be applied' using errcode = 'CK009';
  end if;
  validation := public.validate_coupon(clean_code, s.user_id, v_phone, subtotal);
  if not coalesce((validation->>'valid')::boolean, false) then
   raise exception 'Coupon could not be applied' using errcode = 'CK009';
  end if;
  discount := coalesce((validation->>'discount_minor')::bigint, 0);
 end if;

 -- Delivery charge: the admin-selected inside district (stored in
 -- private.checkout_settings.delivery_inside_district, default
 -- 'Barishal') pays the inside charge; every other district in
 -- Bangladesh pays the outside charge. No free-delivery threshold:
 -- every order pays the inside or the outside charge.
 delivery_charge := case
  when v_district = cfg.delivery_inside_district then cfg.delivery_inside_minor
  else cfg.delivery_outside_minor end;
 total := subtotal + delivery_charge - discount;

 insert into public.orders(id, checkout_session_id, user_id, customer_name, phone, email, division, district, area, address_line, note,
   payment_method, subtotal_minor, delivery_charge_minor, discount_minor, total_minor, placed_at)
 values (new_order, s.id, s.user_id, s.customer_name, v_phone, s.email, v_division, v_district,
   v_area, v_address, v_note, 'cod', subtotal, delivery_charge, discount, total, now_ts);

 -- One redemption per order: the partial unique index on
 -- (coupon_id, order_id) makes a double record impossible.
 if coupon_id is not null then
  insert into public.coupon_redemptions(coupon_id, user_id, phone, order_id)
  values (coupon_id, s.user_id, v_phone, new_order);
 end if;

 -- Advance payment: the TxID + sender number the customer submitted with
 -- the order, recorded as a structured row in the same transaction as
 -- the order itself. The amount is the server-computed delivery charge
 -- (the advance), never a browser-sent amount. A malformed payment
 -- object is ignored here — the note line still carries the details —
 -- but a TxID already used by another live submission refuses the
 -- order (CK013), so one payment can never back two orders. A reused
 -- idempotency key is ignored: the session replay path above already
 -- returns the original order, so this only fires for a genuinely
 -- repeated key.
 if p_payment is not null and jsonb_typeof(p_payment) = 'object' then
  v_provider := lower(btrim(coalesce(p_payment->>'provider', '')));
  v_txid := btrim(coalesce(p_payment->>'transaction_id', ''));
  v_sender := btrim(coalesce(p_payment->>'sender_number', ''));
  v_idem := btrim(coalesce(p_payment->>'idempotency_key', ''));
  if v_provider in ('bkash', 'nagad')
   and v_txid ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' and length(v_txid) <= 128
   and v_sender ~ '^01[3-9][0-9]{8}$'
   and v_idem ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   begin
    insert into public.payment_submissions(order_id, provider, transaction_id, sender_number, advance_minor, status, submitted_at, idempotency_key)
    values (new_order, v_provider, v_txid, v_sender, delivery_charge, 'submitted', now_ts, v_idem::uuid)
    on conflict (idempotency_key) do nothing;
   exception when unique_violation then
    raise exception 'This Transaction ID was already used for another order' using errcode = 'CK013';
   end;
  end if;
 end if;

 number := private.assign_customer_order_number(new_order);
 update public.orders set order_number = number where id = new_order;

 insert into public.order_items(order_id, product_id, variant_id, product_name, sku, size, color,
   unit_price_minor, quantity, line_total_minor)
 select new_order, c.product_id, c.variant_id, p.name, v.sku, v.size, v.color,
   c.unit_price_minor, c.quantity, c.unit_price_minor * c.quantity
 from public.checkout_items c join public.product_variants v on v.id = c.variant_id
 join public.products p on p.id = c.product_id where c.checkout_session_id = s.id;

 for item in select * from public.checkout_items where checkout_session_id = s.id order by variant_id loop
  update public.inventory set on_hand = on_hand - item.quantity
   where variant_id = item.variant_id and available >= item.quantity returning on_hand into after_stock;
  if not found then raise exception 'Not enough stock' using errcode = 'CK002'; end if;
  insert into public.inventory_movements(variant_id, actor_id, delta, on_hand_after, reason)
  values (item.variant_id, null, -item.quantity, after_stock, 'Order ' || number);
  update public.thrift_intake set stock_quantity = 0 where product_id = item.product_id;
 end loop;

 perform private.complete_checkout_session(s.id, new_order);
 return private.checkout_order_result(new_order, false);
end $$;

commit;
