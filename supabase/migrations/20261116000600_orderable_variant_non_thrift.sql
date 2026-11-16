begin;
-- Sizes + Shop-by-Size + full ordering build: make admin-published
-- (non-thrift) products orderable.
--
-- THE CHECKOUT BLOCK: private.orderable_variant (v2, migration
-- 20261113000300) INNER JOINs public.thrift_intake, so a variant whose
-- product has no intake row produces NO ROW AT ALL. set_checkout_items
-- and place_checkout_order both treat "no row" as CK001 ("This product
-- is not available"), which makes every admin-published product
-- visible but not purchasable: the storefront feed
-- published_admin_catalogue EXCLUDES intake products by definition,
-- and admin_publish_product refuses them, so no admin product can
-- ever satisfy the v2 join.
--
-- THIS FILE replaces ONLY private.orderable_variant(uuid) with a
-- two-branch version (the v1 LEFT JOIN shape from 20261113000200, with
-- v2's guards kept and the missing non-thrift availability check
-- added). The signature, SECURITY DEFINER / STABLE / search_path
-- attributes and revokes are unchanged, so CREATE OR REPLACE applies
-- cleanly and the two callers inherit the fix with no changes:
--  * Thrift branch (product HAS an intake row): IDENTICAL to v2 —
--    verification flags, size/color match against the verified intake
--    values, intake stock > 0, intake price for both price columns.
--    It does NOT require p.is_published: published_thrift_catalogue
--    requires only p.status = 'published' plus the verifications,
--    and thrift products publish through intake verification, never
--    through admin_publish_product (which refuses them), so
--    is_published may be false for an orderable thrift product.
--    Putting is_published in the shared conjunction would break
--    thrift ordering, so the requirement lives in the non-thrift
--    branch of the CASE only.
--  * Non-thrift branch (no intake row): variant price_minor as the
--    regular price and coalesce(sale_price_minor, price_minor) as the
--    unit price, both required > 0, AND p.is_published. The
--    is_published requirement is feed parity: eligibility must equal
--    exactly the public feed, and published_admin_catalogue requires
--    p.is_published AND p.status = 'published'. status alone is
--    reachable without ever passing the publish readiness checks —
--    via the form status field or admin_set_product_status, which
--    sets ONLY status — so without this conjunct a feed-invisible
--    product would be orderable by direct variant-UUID submission.
--    is_thrift is COMPUTED (i.product_id IS NOT NULL), not hardcoded.
--  * BOTH branches require p.status = 'published', v.active, and
--    s.available > 0. The inventory join is INNER: a variant without
--    an inventory row produces no row and fails closed as CK001
--    (every RPC-created variant has an inventory row, so this only
--    bites corrupt/legacy rows). v1 lacked the availability check for
--    non-thrift products; this file does NOT restore v1 verbatim.
-- Quantity (CK011), reserve math, price authority, rate limits and
-- the orders_enabled gate are untouched: they live in the callers.
--
-- ACCEPTED RESIDUAL (coordinator decision, conscious choice): a
-- product published and later stripped of media or moved to a hidden
-- category stays orderable until unpublished. Full feed parity would
-- need media/category EXISTS checks in this function; the edge
-- requires post-publish media/category removal while the product
-- stays published. The function is staging-only, orders are COD and
-- visible/cancellable in admin, so the residual is accepted rather
-- than widening this replacement. Revisit if the feed predicate
-- changes.
--
-- AUTHORED ONLY — NEVER APPLIED BY THIS BUILD. This file was written
-- locally and has not been applied to staging or production by any
-- step in this build. Applying it is a separate, owner-approved,
-- gated migration run against the STAGING project only.
--
-- SCHEMA-DRIFT-CHECK PRECONDITION (coordinator decision OQ-8): the live
-- Supabase schema was never verified via API, so this file assumes the
-- repository migrations reflect staging. BEFORE ANY APPLY, verify the
-- staging migration history matches the repository files (including
-- 20261113000200/20261113000300, which define the function replaced
-- here) and confirm the live private.orderable_variant definition is
-- the v2 body. NEVER apply blind. If the live definition differs,
-- stop and reconcile first; do not apply this file on top of an
-- unknown definition.
--
-- APPLY ORDER: this migration ALONE. It has no dependency on any other
-- unapplied migration (014/015, 20261116000100–00500): it references
-- only products, product_variants, thrift_intake and inventory, all
-- created by the foundation/thrift migrations. It may be applied in
-- the same run as other pending migrations or on its own; its own
-- ordering requirement is only the drift check above.
--
-- PARSE-CHECK REQUIREMENT (review item S6): BEFORE ANY APPLY, run
-- this file through a real Postgres parser (pglast/pg_query, or a
-- scratch local Postgres) and record the result in the apply
-- runbook. The operator staging-migrations check does NOT prove
-- this SQL parses — it only builds the migration plan (orders files,
-- rejects duplicates/unknown history). The begin;/commit; wrapper
-- means a syntax failure at apply time rolls back atomically, so
-- this is a verification step, not a code change.
--
-- HONEST PRE-APPLY BEHAVIOR: until this migration is applied AND the
-- separate orders_enabled database flag is flipped AND the staging
-- checkout env flag is set, ordering for admin products fails honestly
-- at each layer (CK001 from the v2 function while it stands; CK008
-- while orders_enabled is false; disabled Place Order button while the
-- code gate fails). Applying this file alone does NOT turn ordering
-- on. See the build report for the full gate table.
--
-- MUST NOT CONTAIN (verified by review): no orders_enabled flip, no
-- change to any other function, no new column/table, no has_permission
-- change, no RLS change, no seed data. Additive only: one function
-- replacement.
create or replace function private.orderable_variant(target_variant uuid)
returns table(product_id uuid, product_name text, sku text, size text, color text,
 regular_price_minor bigint, unit_price_minor bigint, is_thrift boolean, orderable boolean)
language sql stable security definer set search_path = '' as $$
 select p.id, p.name, v.sku, v.size, v.color,
  case when i.product_id is not null then i.price_minor else v.price_minor end,
  case when i.product_id is not null then i.price_minor else coalesce(v.sale_price_minor, v.price_minor) end,
  i.product_id is not null,
  (p.status = 'published' and v.active and s.available > 0 and
   case when i.product_id is not null
    then i.size_verified and i.details_verified
     and i.actual_size is not null and i.actual_color is not null
     and v.size = i.actual_size and v.color = i.actual_color
     and i.price_minor > 0 and i.stock_quantity > 0
    else p.is_published and v.price_minor > 0 and coalesce(v.sale_price_minor, v.price_minor) > 0 end)
 from public.product_variants v
 join public.products p on p.id = v.product_id
 left join public.thrift_intake i on i.product_id = p.id
 join public.inventory s on s.variant_id = v.id
 where v.id = target_variant;
$$;
revoke all on function private.orderable_variant(uuid) from public, anon, authenticated;
commit;
