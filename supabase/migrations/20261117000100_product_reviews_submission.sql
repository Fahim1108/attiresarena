begin;
-- Product review submission: verified-purchase flag, edit (upsert)
-- semantics, and the staff moderation listing.
--
-- S6 PARSE-CHECK REQUIRED: this SQL must be parsed against real Postgres
-- before any gated apply. The operator migration-planning check only
-- orders files; it does not prove this SQL parses.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run against the STAGING project, after a
-- schema-drift check. Production apply needs separate approval.
--
-- PRECONDITION (Q1): the objects created by migration
-- 20261026000200_product_reviews.sql MUST already exist on the target
-- database: table public.product_reviews, functions
-- public.submit_product_review(uuid, integer, text, text) and
-- public.moderate_product_review(uuid, boolean), and table
-- public.review_moderation_log (plus private.touch_updated_at() from
-- the foundation migration and private.require_admin() /
-- private.customer ordering tables from the order-domain migrations).
-- The objects are ASSUMED present per the applied-migration history
-- in the repo, but that history is not live evidence: no live
-- verification was done in this build. The apply-time drift check
-- MUST confirm the objects exist on the target database before any
-- apply. This file contains NO CREATE TABLE: if the precondition
-- fails, STOP and escalate instead of applying.
--
-- Defensive shape: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS, CREATE OR REPLACE for every function, DROP TRIGGER IF
-- EXISTS before CREATE TRIGGER, so a re-run after a partial apply
-- does not fail on the objects it already created.
--
-- Contents ONLY:
--   (a) verified_purchase + updated_at columns on product_reviews,
--       the touch trigger, and two indexes;
--   (b) the SELECT grant extension for the new columns (no new
--       grantee, no customer_id exposure);
--   (c) private.customer_ordered_product: the single verified-purchase
--       predicate (an order exists for that customer+product with a
--       status other than cancelled/returned);
--   (d) submit_product_review rewritten as an upsert (same signature
--       and grants): an edit replaces content and returns the review
--       to pending; edits do not count toward the 15-minute rate
--       limit, which still gates inserts only;
--   (e) moderate_product_review refreshed (same signature and grants):
--       refreshes verified_purchase at moderation time;
--   (f) admin_list_product_reviews: the capped, status-filtered staff
--       listing RPC, gated on catalogue.manage.
--   (g) read_own_product_review: the caller's own review for one
--       product, scoped by auth.uid() inside a SECURITY DEFINER
--       function. A direct select cannot serve this read: the
--       column-list SELECT grant omits customer_id (any filter on
--       it is denied with 42501), and dropping the filter would
--       return other customers' approved rows through the
--       approved_reviews policy (permissive policies combine with
--       OR). The RPC returns at most the caller's one row.
-- No roles, permissions, checkout, or publication changes. The
-- verified_purchase value is a stored snapshot refreshed at
-- submit/edit/moderate time; an order cancelled after approval leaves
-- a stale badge until the review is re-moderated (accepted residual).

-- (a) Columns, trigger, indexes.
alter table public.product_reviews
  add column if not exists verified_purchase boolean not null default false;
alter table public.product_reviews
  add column if not exists updated_at timestamptz not null default now();
comment on column public.product_reviews.verified_purchase is
  'Snapshot: the author had a non-cancelled, non-returned order containing this product when the review was last submitted, edited, or moderated. Refreshed only at those moments.';
drop trigger if exists touch_product_reviews_updated_at on public.product_reviews;
create trigger touch_product_reviews_updated_at before update on public.product_reviews
  for each row execute function private.touch_updated_at();
create index if not exists product_reviews_customer_idx on public.product_reviews(customer_id);
create index if not exists product_reviews_pending_idx on public.product_reviews(created_at desc)
  where status = 'pending';

-- (b) New columns must join the column-list SELECT grant or they stay
-- invisible to every reader. No new grantee.
grant select(verified_purchase, updated_at) on public.product_reviews to anon, authenticated;

-- (c) The single verified-purchase predicate. Guest orders (user_id IS
-- NULL) can never satisfy it; phone/email matching is deliberately
-- not a fallback.
create or replace function private.customer_ordered_product(p_customer uuid, p_product uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.user_id = p_customer
      and oi.product_id = p_product
      and o.status not in ('cancelled', 'returned')
  );
$$;
revoke all on function private.customer_ordered_product(uuid, uuid) from public, anon, authenticated;
comment on function private.customer_ordered_product(uuid, uuid) is
  'True when the customer has at least one order containing the product whose status is not cancelled or returned.';

-- (d) Upsert submit: same signature, validation, published check,
-- advisory lock, and error codes as the original. An existing row for
-- (product, customer) is updated and returned to pending; only
-- inserts count toward the 15-minute rate limit. The author display
-- name is filled from profiles at insert AND edit time (the
-- moderation RPC keeps overwriting it, so the approved display is
-- unchanged).
create or replace function public.submit_product_review(target_product uuid, stars integer, review_body text, review_title text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  customer uuid := auth.uid();
  result uuid;
  existing_id uuid;
  author_name text;
begin
  if customer is null or coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in to write a review' using errcode = '42501';
  end if;
  if stars is null or stars not between 1 and 5 or review_body is null or length(btrim(review_body)) not between 10 and 3000 or review_title is null or length(review_title) > 160 then
    raise exception 'Invalid review' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = target_product and status = 'published') then
    raise exception 'Product unavailable' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(customer::text, 0));
  select id into existing_id
    from public.product_reviews
    where product_id = target_product and customer_id = customer
    for update;
  author_name := coalesce(nullif((select display_name from public.profiles where id = customer), ''), 'Customer');
  if existing_id is not null then
    update public.product_reviews
      set rating = stars,
          title = btrim(review_title),
          body = btrim(review_body),
          status = 'pending',
          author_display_name = author_name,
          verified_purchase = private.customer_ordered_product(customer, target_product),
          updated_at = now()
      where id = existing_id
      returning id into result;
    return result;
  end if;
  if (select count(*) from public.product_reviews where customer_id = customer and created_at > now() - interval '15 minutes') >= 3 then
    raise exception 'Review rate limit reached' using errcode = '54000';
  end if;
  insert into public.product_reviews (product_id, customer_id, rating, title, body, author_display_name, verified_purchase)
    values (target_product, customer, stars, btrim(review_title), btrim(review_body), author_name, private.customer_ordered_product(customer, target_product))
    returning id into result;
  return result;
end;
$$;
revoke all on function public.submit_product_review(uuid, integer, text, text) from public, anon;
grant execute on function public.submit_product_review(uuid, integer, text, text) to authenticated;

-- (e) Moderation: keep the require_admin gate, the FOR UPDATE read,
-- the status set, the author-name fill, and the audit-log insert;
-- refresh verified_purchase on the same UPDATE.
create or replace function public.moderate_product_review(target_review uuid, approved boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  previous text;
  customer uuid;
  reviewed_product uuid;
begin
  perform private.require_admin('catalogue.manage');
  if approved is null then raise exception 'Approval required' using errcode = '22023'; end if;
  select status, customer_id, product_id into previous, customer, reviewed_product
    from public.product_reviews where id = target_review for update;
  if not found then raise exception 'Review not found' using errcode = '22023'; end if;
  update public.product_reviews
    set status = case when approved then 'approved' else 'rejected' end,
        author_display_name = coalesce(nullif((select display_name from public.profiles where id = customer), ''), 'Customer'),
        verified_purchase = private.customer_ordered_product(customer, reviewed_product)
    where id = target_review;
  insert into public.review_moderation_log (review_id, actor_id, previous_status, new_status)
    values (target_review, auth.uid(), previous, case when approved then 'approved' else 'rejected' end);
end;
$$;
revoke all on function public.moderate_product_review(uuid, boolean) from public, anon;
grant execute on function public.moderate_product_review(uuid, boolean) to authenticated;

-- (f) Staff listing: one call, joined product names, capped at 200,
-- newest first. p_status null lists every status. The RETURNS TABLE
-- columns share names with table columns, so every reference below
-- is table-qualified.
create or replace function public.admin_list_product_reviews(p_status text default null, p_limit integer default 200)
returns table (
  id uuid,
  product_id uuid,
  product_name text,
  customer_id uuid,
  author_display_name text,
  rating integer,
  title text,
  body text,
  status text,
  verified_purchase boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  clamped_limit integer;
begin
  perform private.require_admin('catalogue.manage');
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Invalid review status' using errcode = '22023';
  end if;
  clamped_limit := least(greatest(coalesce(p_limit, 200), 1), 200);
  return query
    select r.id, r.product_id, p.name, r.customer_id, r.author_display_name, r.rating, r.title, r.body, r.status, r.verified_purchase, r.created_at, r.updated_at
    from public.product_reviews r
    join public.products p on p.id = r.product_id
    where (p_status is null or r.status = p_status)
    order by r.created_at desc, r.id desc
    limit clamped_limit;
end;
$$;
revoke all on function public.admin_list_product_reviews(text, integer) from public, anon;
grant execute on function public.admin_list_product_reviews(text, integer) to authenticated;

-- (g) Own-review read: SECURITY DEFINER, scoped by auth.uid() inside
-- the function. Returns at most one row: the caller's review for the
-- product (UNIQUE(product_id, customer_id)). Anonymous and
-- unauthenticated callers are rejected with 42501, matching
-- submit_product_review. The RETURNS TABLE columns share names with
-- table columns, so every reference below is table-qualified.
create or replace function public.read_own_product_review(target_product uuid)
returns table (
  id uuid,
  rating integer,
  title text,
  body text,
  status text,
  verified_purchase boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  customer uuid := auth.uid();
begin
  if customer is null or coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in to view your review' using errcode = '42501';
  end if;
  return query
    select r.id, r.rating, r.title, r.body, r.status, r.verified_purchase, r.created_at, r.updated_at
    from public.product_reviews r
    where r.product_id = target_product and r.customer_id = customer;
end;
$$;
revoke all on function public.read_own_product_review(uuid) from public, anon;
grant execute on function public.read_own_product_review(uuid) to authenticated;

commit;
