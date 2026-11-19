-- Published-category media: let the storefront serve a category photo or
-- banner that an admin stored in the private 'attires-product-drafts'
-- bucket, ONLY while it is linked to a category that is currently
-- published.
--
-- AUTHORED ONLY — NOT APPLIED. Do not apply blind: the live schema is
-- unverified, so apply only through the approved migration process,
-- after a schema-drift check, and only together with the code that
-- references /api/product-media for category images
-- (frontend/claude/src/lib/store-settings.ts, mergeDbCategories).
-- Promoting that code WITHOUT this migration breaks category photos
-- for rows that have a stored image (the media URL 404s); rows with no
-- stored image keep their static photo either way.
--
-- DESIGN (same pattern as migration 20261115000800 for product photos):
-- the bucket stays private and NO bytes are copied. ONE additive
-- Storage SELECT policy lets anyone read an object ONLY while it is
-- referenced by a published category's image_storage_path or
-- banner_storage_path, checked per request by the definer function
-- is_published_category_media. Unpublishing revokes image access
-- immediately, with no stale copies. Draft, unpublished, and unlinked
-- objects stay staff-only, and the restrictive delete/update policies
-- from 004 are untouched. The promotion gate that inspects
-- pg_policies for storage.objects (see the product_media_published
-- policy) must inspect this policy too before promotion.
begin;

-- ------------------------------ published-only Storage read check + policy
-- category images/banners are not readable by anon, so the check runs as
-- a definer function that reveals only a yes/no for one object path.
-- (anon has no usage on schema private, hence public.)
create function public.is_published_category_media(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.categories c
  where c.published
    and (c.image_storage_path = object_name or c.banner_storage_path = object_name));
$$;
revoke all on function public.is_published_category_media(text) from public;
grant execute on function public.is_published_category_media(text) to anon, authenticated;

create policy published_category_media_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'attires-product-drafts' and public.is_published_category_media(name));

commit;
