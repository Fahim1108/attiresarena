begin;
-- Order-history photos (client feedback item 14): the order history
-- shows the store logo for a line whose product left the published
-- feed, because orderMediaMap resolves only from the published feed.
-- This function resolves the ordered product's actual cover photo
-- regardless of published state, for the products in the caller's
-- own orders only.
--
-- WHY THIS FUNCTION EXISTS: the customer client cannot read
-- product_media directly (staff-only SELECT policy, migration
-- 20261030000400) and the published feed RPCs return published rows
-- only, so no client-side query can ever return an unpublished
-- product's photo. The function runs SECURITY DEFINER and checks
-- ownership itself: a signed-in caller resolves only products in
-- orders whose user_id is their own auth.uid(); the server-trusted
-- guest lookup (service_role, phone already verified by
-- customer_track_order_by_phone) resolves the looked-up order's
-- products. Grants go to authenticated + service_role ONLY; anon is
-- revoked, so no browser can call it without a session.
-- The returned payload contains ONLY product id, slug, and the
-- cover-photo URL + alt — no prices, no stock, and no product data
-- beyond the slug the order line already shows. A product with no
-- media returns no row: the caller keeps the logo fallback, so the
-- logo appears only when truly no photo exists. Pre-migration the
-- RPC does not exist and the call errors: the code treats that as an
-- empty map (logo fallback, today's behaviour), never a crash.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run, after a schema-drift check.

create function public.customer_order_media(p_order_ids uuid[])
returns table (product_id uuid, slug text, image_src text, image_alt text)
language sql stable security definer set search_path = '' as $$
  select distinct p.id, p.slug,
    '/api/product-media/' || split_part(pm.storage_path, '/', 1) || '/' || split_part(pm.storage_path, '/', 2),
    coalesce(nullif(pm.alt_text, ''), p.name)
  from public.products p
  join public.product_media pm on pm.product_id = p.id
  join public.order_items oi on oi.product_id = p.id
  join public.orders o on o.id = oi.order_id
  where o.id = any(p_order_ids)
    and pm.storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
    and pm.position = (select min(m2.position) from public.product_media m2 where m2.product_id = p.id)
    and (
      (coalesce(auth.role(), '') = 'authenticated' and o.user_id = auth.uid())
      or coalesce(auth.role(), '') = 'service_role'
    );
$$;
revoke all on function public.customer_order_media(uuid[]) from public, anon;
grant execute on function public.customer_order_media(uuid[]) to authenticated, service_role;

commit;
