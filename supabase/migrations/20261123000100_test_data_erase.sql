begin;

-- TEST DATA ERASE (2026-11-23, Fahim approved the scope 2026-11-23 00:44).
--
-- An owner-only admin button ("Danger zone" card on Store Settings) that
-- erases all test data so the store can start from zero before launch.
-- Two RPCs, one shared scope, no app-side delete logic:
--
--   admin_test_data_erase_counts() — read-only preview of exactly what
--     the erase will remove (same predicates as the erase itself).
--   admin_test_data_erase(p_confirmation) — deletes everything in one
--     transaction, in FK order, and returns the deleted counts plus the
--     storage paths and customer user ids the server action must clean
--     up afterwards (storage files via the Storage API, customer auth
--     users via the Supabase Admin API — neither can run inside the
--     database transaction).
--
-- WILL DELETE (all rows):
--   orders + order_items + payment_submissions + order_shipments +
--   courier_booking_claims + coupon_redemptions; then the
--   private.customer_order_numbers ledger rows ONLY (the order-number
--   sequence is NEVER reset — new orders keep counting forward);
--   checkout_items + abandoned_recovery_log, then checkout_sessions;
--   private.checkout_rate_events;
--   ONLY products whose name/slug starts with "test" (case-insensitive,
--   private.is_test_product) plus their variants, inventory, inventory
--   movements, product media, thrift intake and catalogue terms;
--   all product_reviews + review_moderation_log; all coupons; all
--   banners rows (their files are returned for Storage cleanup).
--   Customer auth.users rows with NO user_roles row are returned for
--   deletion via the Admin API (their profiles, addresses and per-user
--   grants cascade); staff auth users are NEVER touched.
--
-- NEVER DELETE: categories, catalogue_terms, store_settings,
--   layout_settings, private.checkout_settings,
--   private.delivery_locations, marketing_secrets,
--   private.telegram_config, private.smtp_config, user_roles,
--   user_permissions, role_permissions,
--   private.owner_provisioning_log, blocked_customers,
--   admin_audit_logs (the erase itself is logged there), staff
--   auth.users, the order-number sequence, pg_cron jobs.
--
-- SAFETY: owner-only at every layer — the RPCs require MFA (AAL2) and a
-- 'owner' row in user_roles (a hard role check, not a permission that a
-- per-user grant could ever enable); the Server Action re-checks
-- requireStaff(["owner"]) + isOwner; the confirmation word must be
-- exactly 'ERASE'. Almost every FK is ON DELETE RESTRICT, so children
-- are deleted before parents; the whole erase is one transaction, so
-- the 15-minute sweeps never see partial state. Storage files and
-- customer auth accounts are cleaned up by the server action AFTER the
-- transaction commits, from the lists the RPC returns; if that cleanup
-- fails, the database rows are already gone and the leftovers are
-- reported, so pressing Erase again retries just the leftovers.

-- Test-product predicate, shared by the counts and the erase so the
-- preview can never disagree with what gets deleted. SQL is
-- authoritative; the TypeScript mirror is isTestProductName in
-- src/lib/admin/settings-shared.ts.
create or replace function private.is_test_product(p_name text, p_slug text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(btrim(coalesce(p_name, ''))) like 'test%'
      or lower(btrim(coalesce(p_slug, ''))) like 'test%';
$$;
revoke all on function private.is_test_product(text, text) from public, anon, authenticated;

-- Owner gate for both RPCs: MFA (AAL2) plus a hard 'owner' role row.
-- Deliberately NOT a permission check: no per-user grant must ever be
-- able to enable this.
create or replace function private.require_owner() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or auth.jwt()->>'aal' is distinct from 'aal2' then
    raise exception 'Staff permission and MFA required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'owner') then
    raise exception 'Test data erase requires owner permission' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_owner() from public, anon, authenticated;

-- Read-only preview: counts of everything the erase would remove,
-- plus the names of the test products (so the owner sees exactly
-- which products go) and the number of storage files.
create or replace function public.admin_test_data_erase_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_test_ids uuid[];
begin
  perform private.require_owner();
  select coalesce(array_agg(id), array[]::uuid[]) into v_test_ids
    from public.products where private.is_test_product(name, slug);
  return jsonb_build_object(
    'orders', (select count(*) from public.orders),
    'order_items', (select count(*) from public.order_items),
    'payment_submissions', (select count(*) from public.payment_submissions),
    'order_shipments', (select count(*) from public.order_shipments),
    'courier_booking_claims', (select count(*) from public.courier_booking_claims),
    'coupon_redemptions', (select count(*) from public.coupon_redemptions),
    'checkout_sessions', (select count(*) from public.checkout_sessions),
    'checkout_items', (select count(*) from public.checkout_items),
    'abandoned_recovery_log', (select count(*) from public.abandoned_recovery_log),
    'checkout_rate_events', (select count(*) from private.checkout_rate_events),
    'test_products', coalesce(array_length(v_test_ids, 1), 0),
    'test_product_names', (select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
      from public.products where private.is_test_product(name, slug)),
    'test_product_variants', (select count(*) from public.product_variants where product_id = any (v_test_ids)),
    'test_product_media', (select count(*) from public.product_media where product_id = any (v_test_ids)),
    'test_inventory_movements', (select count(*) from public.inventory_movements
      where variant_id in (select id from public.product_variants where product_id = any (v_test_ids))),
    'test_thrift_intake', (select count(*) from public.thrift_intake where product_id = any (v_test_ids)),
    'test_catalogue_terms', (select count(*) from public.product_catalogue_terms where product_id = any (v_test_ids)),
    'product_reviews', (select count(*) from public.product_reviews),
    'review_moderation_log', (select count(*) from public.review_moderation_log),
    'coupons', (select count(*) from public.coupons),
    'banners', (select count(*) from public.banners),
    'customers', (select count(*) from auth.users u
      where not exists (select 1 from public.user_roles r where r.user_id = u.id)),
    'storage_files', (select count(*) from public.product_media where product_id = any (v_test_ids))
      + (select count(*) from public.banners)
  );
end $$;
revoke all on function public.admin_test_data_erase_counts() from public, anon;
grant execute on function public.admin_test_data_erase_counts() to authenticated;

-- The erase itself. One transaction; children before parents (almost
-- every FK is ON DELETE RESTRICT). Returns the deleted counts plus the
-- storage paths and customer user ids the server action cleans up after
-- the transaction commits. The audit row is written in the same
-- transaction, so a failed erase leaves no audit trail and a
-- successful one is always recorded.
create or replace function public.admin_test_data_erase(p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_counts jsonb;
  v_test_ids uuid[];
  v_storage_paths text[];
  v_customer_ids uuid[];
begin
  if p_confirmation is distinct from 'ERASE' then
    raise exception 'Confirmation is required: type ERASE to erase test data' using errcode = '22023';
  end if;
  perform private.require_owner();

  -- Collect the scope BEFORE deleting anything.
  select coalesce(array_agg(id), array[]::uuid[]) into v_test_ids
    from public.products where private.is_test_product(name, slug);
  select coalesce(array_agg(storage_path), array[]::text[]) into v_storage_paths
    from public.product_media where product_id = any (v_test_ids);
  select v_storage_paths || coalesce(array_agg(image_storage_path), array[]::text[])
    into v_storage_paths from public.banners;
  select coalesce(array_agg(u.id), array[]::uuid[]) into v_customer_ids
    from auth.users u
    where not exists (select 1 from public.user_roles r where r.user_id = u.id);

  -- Counts, also before deleting (the counts function must agree).
  v_counts := jsonb_build_object(
    'orders', (select count(*) from public.orders),
    'order_items', (select count(*) from public.order_items),
    'payment_submissions', (select count(*) from public.payment_submissions),
    'order_shipments', (select count(*) from public.order_shipments),
    'courier_booking_claims', (select count(*) from public.courier_booking_claims),
    'coupon_redemptions', (select count(*) from public.coupon_redemptions),
    'checkout_sessions', (select count(*) from public.checkout_sessions),
    'checkout_items', (select count(*) from public.checkout_items),
    'abandoned_recovery_log', (select count(*) from public.abandoned_recovery_log),
    'checkout_rate_events', (select count(*) from private.checkout_rate_events),
    'test_products', coalesce(array_length(v_test_ids, 1), 0),
    'test_product_names', (select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
      from public.products where private.is_test_product(name, slug)),
    'test_product_variants', (select count(*) from public.product_variants where product_id = any (v_test_ids)),
    'test_product_media', (select count(*) from public.product_media where product_id = any (v_test_ids)),
    'test_inventory_movements', (select count(*) from public.inventory_movements
      where variant_id in (select id from public.product_variants where product_id = any (v_test_ids))),
    'test_thrift_intake', (select count(*) from public.thrift_intake where product_id = any (v_test_ids)),
    'test_catalogue_terms', (select count(*) from public.product_catalogue_terms where product_id = any (v_test_ids)),
    'product_reviews', (select count(*) from public.product_reviews),
    'review_moderation_log', (select count(*) from public.review_moderation_log),
    'coupons', (select count(*) from public.coupons),
    'banners', (select count(*) from public.banners),
    'customers', coalesce(array_length(v_customer_ids, 1), 0),
    'storage_files', coalesce(array_length(v_storage_paths, 1), 0)
  );

  -- Reviews first: review_moderation_log references reviews (restrict),
  -- and reviews reference products (restrict) and profiles (cascade).
  delete from public.review_moderation_log;
  delete from public.product_reviews;

  -- Orders and everything that references them, then the order-number
  -- ledger rows. The sequence is NEVER reset.
  delete from public.order_shipments;
  delete from public.courier_booking_claims;
  delete from public.coupon_redemptions;
  delete from public.payment_submissions;
  delete from public.order_items;
  delete from public.orders;
  delete from private.customer_order_numbers;

  -- Checkout sessions last among the order family: orders reference
  -- sessions (restrict), and checkout items / recovery log do too.
  delete from public.checkout_items;
  delete from public.abandoned_recovery_log;
  delete from public.checkout_sessions;
  delete from private.checkout_rate_events;

  -- TEST products only, children before parents.
  delete from public.product_catalogue_terms where product_id = any (v_test_ids);
  delete from public.product_media where product_id = any (v_test_ids);
  delete from public.inventory_movements
    where variant_id in (select id from public.product_variants where product_id = any (v_test_ids));
  delete from public.inventory
    where variant_id in (select id from public.product_variants where product_id = any (v_test_ids));
  delete from public.product_variants where product_id = any (v_test_ids);
  delete from public.thrift_intake where product_id = any (v_test_ids);
  delete from public.products where id = any (v_test_ids);

  -- Coupons (redemptions are already gone) and banners.
  delete from public.coupons;
  delete from public.banners;

  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin.test_data_erased', auth.uid(),
            jsonb_build_object('deleted', v_counts));

  return jsonb_build_object(
    'deleted', v_counts,
    'storage_paths', to_jsonb(v_storage_paths),
    'customer_user_ids', to_jsonb(v_customer_ids)
  );
end $$;
revoke all on function public.admin_test_data_erase(text) from public, anon;
grant execute on function public.admin_test_data_erase(text) to authenticated;

commit;
