begin;
-- Visible-banner image delivery (storefront wiring, admin panel content).
--
-- Banner images live in the private bucket `attires-product-drafts`
-- under the banners/ prefix. The banners table itself is already
-- publicly readable for visible rows, but no Storage policy lets
-- anonymous readers fetch the image bytes — so saved banners could
-- never render on the storefront. This migration adds the missing
-- read path, mirroring the published-only product-media policy
-- (20261115000800): a SECURITY DEFINER check function that reveals
-- only a yes/no for one object path, plus a Storage SELECT policy
-- that lets anyone read an object ONLY while it is linked to a
-- banner that is currently visible.
--
-- No table-level public policy is added or changed. The check runs
-- as a definer function that reveals only a yes/no for one object
-- path. (anon has no usage on schema private, hence public.)
--
-- Until this migration is applied, /api/banner-media answers 404
-- for every banner image and the homepage probe
-- (resolveBannerImageUrls) skips those banners, so the storefront
-- keeps its static slides instead of showing broken images.

create function public.is_visible_banner_media(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.banners b
  where b.image_storage_path = object_name and b.visible);
$$;
revoke all on function public.is_visible_banner_media(text) from public;
grant execute on function public.is_visible_banner_media(text) to anon, authenticated;

create policy visible_banner_media_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'attires-product-drafts' and public.is_visible_banner_media(name));

commit;
