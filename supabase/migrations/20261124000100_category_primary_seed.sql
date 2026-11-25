begin;
-- Client feedback 2026-11-24 item 4: categories admin control.
--
-- Seeds the six primary categories (Shirts, Pants, Sneakers, Belt,
-- Wallet, Watches) as published top-level rows, and gives the three
-- shirt sub-categories (Casual/Formal/Check) a real parent (Shirts).
--
-- Until this runs, the storefront merge treats the static config as
-- the fallback (see mergeDbCategories dbOwnsTaxonomy in
-- frontend/claude/src/lib/store-settings.ts); after it runs, the DB
-- is the source of truth — deleting a category in admin removes its
-- tile instead of resurrecting it from the static config.
--
-- Idempotent: safe to re-run. Authored only — NEVER applied by an
-- agent; staging first, then production, only with Fahim's explicit
-- OK each time. No rows are deleted; no product assignment changes
-- (products keep their DB category UUIDs).

insert into public.categories (slug, name, description, published, parent_id, sort_position)
values
  ('shirts', 'Shirts', 'Oxford, linen, check and overshirts cut for Bangladesh''s climate.', true, null, 1),
  ('pants', 'Pants', 'Chinos, relaxed trousers, denim and cargos for every day.', true, null, 2),
  ('sneakers', 'Sneakers', 'Clean, versatile sneakers that go with everything.', true, null, 3),
  ('belts', 'Belt', 'Leather, reversible and woven belts to finish the look.', true, null, 4),
  ('wallets', 'Wallet', 'Slim wallets and card holders in full-grain leather.', true, null, 5),
  ('watches', 'Watches', 'Minimal and chronograph watches for work and weekend.', true, null, 6)
on conflict (slug) do nothing;

-- Give the three canonical shirt sub-categories their real parent.
-- Only rows with parent_id NULL are touched; a sub-category the
-- admin already parented elsewhere is left alone. The messy staging
-- duplicates ("Formal shirts" plural, the garbage-slug "Casual
-- shirt" row) are deliberately NOT touched — the storefront
-- normalizes them to their shirt type already (shirtSubKey in
-- frontend/claude/src/lib/category-hierarchy.ts), and re-parenting
-- staging-only rows by name is not safe to guess in a migration.
update public.categories
set parent_id = (select id from public.categories where slug = 'shirts')
where slug in ('casual-shirt', 'formal-shirt', 'check-shirt')
  and parent_id is null;

commit;
