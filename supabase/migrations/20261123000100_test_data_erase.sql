begin;

-- TEST DATA ERASE (2026-11-23 built; scope REFINED 2026-11-24, Fahim
-- chose the new scope from client feedback).
--
-- An owner-only admin button ("Danger zone" card on Store Settings) that
-- erases admin/test data so the store can start from zero before launch.
-- Two RPCs, one shared scope, no app-side delete logic:
--
--   admin_test_data_erase_counts() — read-only preview of exactly what
--     the erase will remove (same predicates as the erase itself).
--   admin_test_data_erase(p_confirmation) — deletes everything in one
--     transaction and returns the deleted counts. No storage or auth
--     cleanup is needed any more: nothing deleted here has files or
--     auth accounts attached.
--
-- WILL DELETE (all rows):
--   order history: orders + order_items + payment_submissions
--     (TxID records) + coupon_redemptions; then the
--     private.customer_order_numbers ledger rows ONLY (the order-number
--     sequence is NEVER reset — new orders keep counting forward);
--   delivery data: order_shipments + courier_booking_claims (the
--     per-order delivery records). The delivery reference data and
--     charges are SETTINGS and stay (see NEVER DELETE).
--   profit data: there is NO dedicated profit table — profit is derived
--     from orders in the analytics code (order_items unit price minus
--     cost), so deleting the orders deletes all profit data with them.
--   checkout data: checkout_items + abandoned_recovery_log, then
--     checkout_sessions; private.checkout_rate_events;
--   all product_reviews + review_moderation_log; all coupons; all
--   banners rows.
--
-- NEVER DELETE: ALL products (including TEST-named ones — no product
--   deletion at all), ALL customer details (auth.users, profiles,
--   customer_addresses, user_permissions — no customer deletion at
--   all), website/page traffic data (there is NO traffic table in this
--   database — the traffic graph comes from the Google Analytics
--   Data API, so the erase cannot touch it), categories, catalogue_terms,
--   store_settings, layout_settings, private.checkout_settings,
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
-- requireStaff(["owner"]) + isOwner and additionally requires the
-- typed ERASE word AND the owner's re-entered admin login secret (the
-- secret is verified server-side only and never reaches the
-- database). Almost every FK is ON DELETE RESTRICT, so children are
-- deleted before parents; the whole erase is one transaction, so the
-- 15-minute sweeps never see partial state.

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

-- Read-only preview: counts of everything the erase would remove.
create or replace function public.admin_test_data_erase_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_owner();
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
    'product_reviews', (select count(*) from public.product_reviews),
    'review_moderation_log', (select count(*) from public.review_moderation_log),
    'coupons', (select count(*) from public.coupons),
    'banners', (select count(*) from public.banners)
  );
end $$;
revoke all on function public.admin_test_data_erase_counts() from public, anon;
grant execute on function public.admin_test_data_erase_counts() to authenticated;

-- The erase itself. One transaction; children before parents (almost
-- every FK is ON DELETE RESTRICT). Returns the deleted counts. The
-- audit row is written in the same transaction, so a failed erase
-- leaves no audit trail and a successful one is always recorded.
create or replace function public.admin_test_data_erase(p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_counts jsonb;
begin
  if p_confirmation is distinct from 'ERASE' then
    raise exception 'Confirmation is required: type ERASE to erase test data' using errcode = '22023';
  end if;
  perform private.require_owner();

  -- Counts, before deleting (the counts function must agree).
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
    'product_reviews', (select count(*) from public.product_reviews),
    'review_moderation_log', (select count(*) from public.review_moderation_log),
    'coupons', (select count(*) from public.coupons),
    'banners', (select count(*) from public.banners)
  );

  -- Reviews first: review_moderation_log references reviews (restrict),
  -- and reviews reference products (restrict) and profiles (cascade) —
  -- both stay, only the review rows themselves go.
  delete from public.review_moderation_log;
  delete from public.product_reviews;

  -- Orders and everything that references them, then the order-number
  -- ledger rows. The sequence is NEVER reset. Delivery data
  -- (order_shipments, courier_booking_claims) and the profit source
  -- (order_items) go with the orders.
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

  -- Coupons (redemptions are already gone) and banners.
  -- NOTE: banner image files stay in the Storage bucket (orphaned,
  -- referenced by nothing) — the erase no longer touches Storage.
  delete from public.coupons;
  delete from public.banners;

  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
    values (auth.uid(), 'admin.test_data_erased', auth.uid(),
            jsonb_build_object('deleted', v_counts));

  return jsonb_build_object('deleted', v_counts);
end $$;
revoke all on function public.admin_test_data_erase(text) from public, anon;
grant execute on function public.admin_test_data_erase(text) to authenticated;

commit;
