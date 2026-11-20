begin;
-- Storefront redirect resolution (migration 20261115001300 created the
-- storage only: "Stored only — no enforcement exists yet").
--
-- The storefront cannot read url_redirects directly: RLS grants SELECT
-- only to authenticated staff with settings.manage, and the storefront
-- serves anonymous visitors. This migration adds the one read the
-- storefront needs:
--
--  public.resolve_storefront_redirects() returns jsonb
--    { "auto": boolean, "redirects": [{source_path, target_path, code}] }
--
--  * "auto" is the stored redirect_auto toggle (layout_settings key
--    'redirect_auto', a JSON boolean). When it is off or unset, the
--    storefront must not redirect at all — the toggle is the kill switch.
--  * "redirects" is every ACTIVE row, in source order. Inactive rows are
--    never returned, so toggling a redirect off in admin takes effect on
--    the next config fetch (the storefront caches the payload for 60s).
--  * Sources under /admin, /api, /_next and /_vercel are never returned,
--    even if an admin saves one: a redirect must never be able to hijack
--    the admin panel, an API route, or a framework asset. The storefront
--    proxy applies the same exclusion as a second layer.
--
-- SAFETY:
--  * Read-only: a single SELECT, no writes, no side effects. The function
--    is STABLE and SECURITY DEFINER with an empty search_path, following
--    the checkout RPC precedent. It is granted to anon and authenticated
--    — the payload is public by nature (redirect sources and targets are
--    URLs visitors can already see), and the function reveals nothing
--    else: no inactive rows, no ids, no timestamps.
--  * Applying this migration changes nothing on its own: the storefront
--    only redirects once the proxy (src/proxy.ts, same change) ships AND
--    the toggle is on. Re-running is safe (CREATE OR REPLACE).
--
-- DEPENDENCIES: apply AFTER 20261115001300 (url_redirects +
-- layout_settings). NEVER apply blind: apply only through an explicit,
-- owner-approved migration run, after a schema-drift check.

create or replace function public.resolve_storefront_redirects()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'auto', coalesce(
      (select value from public.layout_settings where key = 'redirect_auto'),
      'false'::jsonb
    ) = 'true'::jsonb,
    'redirects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_path', source_path,
        'target_path', target_path,
        'code', code
      ) order by source_path)
      from public.url_redirects
      where active
        and source_path not like '/admin%'
        and source_path not like '/api%'
        and source_path not like '/_next%'
        and source_path not like '/_vercel%'
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.resolve_storefront_redirects() from public, anon, authenticated;
grant execute on function public.resolve_storefront_redirects() to anon, authenticated;

comment on function public.resolve_storefront_redirects() is
  'Storefront redirect config for src/proxy.ts: the redirect_auto toggle plus every active url_redirects row (admin/api/_next/_vercel sources excluded). Read-only; granted to anon because redirect URLs are public.';

commit;
