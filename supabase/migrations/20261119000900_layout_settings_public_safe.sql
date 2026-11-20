-- Widen the public SELECT policy on public.layout_settings to the
-- display settings the storefront renders: navigation links, footer
-- link groups, and the theme customize choices. These are public-safe
-- (same class as error_404 copy, already public): no secrets, no
-- personal data, no internal state. The storefront reads them through
-- the anonymous REST client in getStorefrontContent; without this
-- policy the rows are invisible to anon and the storefront keeps its
-- static header/footer/theme (fail-safe).
--
-- Stays staff-only on purpose: redirect_auto and
-- featured_categories_count (operational settings) and error_403
-- (no 403 page exists). No other policy or function changes.
--
-- NOT APPLIED by this change: apply through the normal staging /
-- production migration flow. Until it is applied, saved navigation
-- links, footer links and customize choices are stored but not
-- rendered; the store name, logo and favicon need no migration (their
-- keys are already public-readable in store_settings, and brand
-- images are delivered by the service-role /api/brand-media route).
begin;

drop policy if exists layout_settings_public on public.layout_settings;
create policy layout_settings_public on public.layout_settings for select
  to anon, authenticated using (key in (
    'error_404', 'navigation_links', 'footer_links',
    'customize_typography', 'customize_buttons'
  ));

commit;
