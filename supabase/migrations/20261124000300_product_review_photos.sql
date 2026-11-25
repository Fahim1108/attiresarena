begin;
-- Customer review photos (client feedback item 19): reviews may carry
-- optional photos (max 3 per review), auto-compressed on upload.
--
-- New bucket 'review-photos' (private, 5 MB, jpeg/png/webp) + table
-- public.product_review_photos + attach RPC + delivery policy.
-- Photos are visible publicly ONLY once their review is approved
-- (and the product is published); pending/rejected photos are visible
-- only to their author. Linked bytes cannot be overwritten or removed
-- by any authenticated Storage request (restrictive policies, same
-- pattern as product_media, migration 20261030000400).
--
-- The attach RPC is the only write path for the table: the table has
-- no INSERT/UPDATE/DELETE grant or policy, so direct table writes
-- cannot work by design. Identity comes from the caller's JWT
-- (auth.uid()) inside the RPC; no user id is accepted.
-- Pre-migration the bucket/table/RPC do not exist: the photo upload
-- fails in the server action and the review itself still submits;
-- the form says so instead of failing the review.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run, after a schema-drift check.

-- Bucket (private; delivery goes through /api/review-photos, which
-- fetches with the anon key so the policy below is evaluated).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('review-photos','review-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id='review-photos' and
   (public or file_size_limit is distinct from 5242880 or allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp'])) then
   raise exception 'Existing review-photos bucket configuration differs; operator review required';
 end if;
end $$;

create table public.product_review_photos (
 id uuid primary key default gen_random_uuid(),
 review_id uuid not null references public.product_reviews(id) on delete cascade,
 storage_path text not null unique,
 position integer not null check(position between 0 and 2),
 created_at timestamptz not null default now(),
 unique(review_id, position)
);
create index product_review_photos_review_idx on public.product_review_photos(review_id);
alter table public.product_review_photos enable row level security;
revoke all on public.product_review_photos from public, anon, authenticated;
grant select (id, review_id, storage_path, position) on public.product_review_photos to anon, authenticated;
-- Public list: only photos of approved reviews on published products.
create policy review_photos_approved_read on public.product_review_photos for select to anon, authenticated
 using (exists(select 1 from public.product_reviews r join public.products p on p.id = r.product_id
   where r.id = review_id and r.status = 'approved' and p.status = 'published'));
-- Own photos, any status: the author sees their pending photos too.
create policy review_photos_own_read on public.product_review_photos for select to authenticated
 using (exists(select 1 from public.product_reviews r where r.id = review_id and r.customer_id = auth.uid()));

-- Delivery check for the /api/review-photos route: the object is
-- linked to an approved review's photo on a published product.
create function public.is_approved_review_photo(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.product_review_photos ph
  join public.product_reviews r on r.id = ph.review_id
  join public.products p on p.id = r.product_id
  where ph.storage_path = object_name and r.status = 'approved' and p.status = 'published');
$$;
revoke all on function public.is_approved_review_photo(text) from public;

-- Storage policies: customers upload into their own folder only;
-- approved photos are readable through the policy-evaluating
-- endpoint; linked bytes cannot be overwritten or removed.
create policy review_photos_upload on storage.objects for insert to authenticated
 with check(bucket_id='review-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy review_photos_read on storage.objects for select to anon, authenticated
 using (bucket_id='review-photos' and public.is_approved_review_photo(name));
create policy review_photos_no_linked_delete on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'review-photos' or not exists(select 1 from public.product_review_photos where storage_path=name));
create policy review_photos_no_linked_update on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'review-photos' or not exists(select 1 from public.product_review_photos where storage_path=name))
 with check(bucket_id<>'review-photos' or not exists(select 1 from public.product_review_photos where storage_path=name));

-- Attach one uploaded photo to the caller's own review. Max 3 photos
-- per review (positions 0-2). Returns the photo id.
create function public.attach_product_review_photo(p_review_id uuid, p_storage_path text, p_position integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare customer uuid:=auth.uid(); result uuid; object_id uuid; photo_count integer;
begin
 if customer is null then raise exception 'Sign in to add a review photo' using errcode='42501'; end if;
 if p_review_id is null or p_storage_path is null or p_position is null or p_position not between 0 and 2 then
   raise exception 'Invalid review photo' using errcode='22023'; end if;
 if p_storage_path !~ ('^'||customer::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') then
   raise exception 'Only your uploaded image may be attached' using errcode='22023'; end if;
 if not exists(select 1 from public.product_reviews where id=p_review_id and customer_id=customer) then
   raise exception 'Review not found' using errcode='22023'; end if;
 select count(*) into photo_count from public.product_review_photos where review_id=p_review_id;
 if photo_count>=3 then raise exception 'Maximum 3 photos per review' using errcode='22023'; end if;
 select id into object_id from storage.objects where bucket_id='review-photos' and name=p_storage_path
   and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp') for update;
 if not found then raise exception 'Uploaded image not found' using errcode='22023'; end if;
 if exists(select 1 from public.product_review_photos where review_id=p_review_id and storage_path=p_storage_path) then
   select id into result from public.product_review_photos where review_id=p_review_id and storage_path=p_storage_path;
   return result;
 end if;
 insert into public.product_review_photos(review_id,storage_path,position) values(p_review_id,p_storage_path,p_position)
  returning id into result;
 return result;
end $$;
revoke all on function public.attach_product_review_photo(uuid,text,integer) from public, anon;
grant execute on function public.attach_product_review_photo(uuid,text,integer) to authenticated;

commit;
