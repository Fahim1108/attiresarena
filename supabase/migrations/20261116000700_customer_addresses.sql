begin;
-- Customer saved addresses + profile phone (customer login build).
--
-- S6 PARSE-CHECK REQUIRED: this SQL must be parsed against real Postgres
-- before any gated apply. The operator migration-planning check only
-- orders files; it does not prove this SQL parses.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run against the STAGING project, after a
-- schema-drift check. Production apply needs separate approval.
--
-- Contents ONLY:
--   (a) new table public.customer_addresses with own-row RLS;
--   (b) public.profiles.phone column + the minimal grant extension.
-- No roles, permissions, has_permission, RPC, or checkout changes.
-- Phone is a contact detail (display/prefill only), never an ownership
-- proof and never an authorization input.

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 40),
  full_name text not null check (length(btrim(full_name)) between 3 and 120),
  phone text not null check (phone ~ '^01[3-9][0-9]{8}$'),
  division text not null check (division in ('Barishal','Chattogram','Dhaka','Khulna','Mymensingh','Rajshahi','Rangpur','Sylhet')),
  district text not null check (length(btrim(district)) between 1 and 120),
  area text not null check (length(btrim(area)) between 1 and 120),
  address_line text not null check (length(btrim(address_line)) between 1 and 500),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.customer_addresses is
  'Customer saved addresses. A customer reads/writes only their own rows (user_id = auth.uid()). At most one default address per customer (partial unique index). Phone is a contact detail, never an ownership proof.';
create index customer_addresses_user_idx on public.customer_addresses(user_id);
create unique index customer_addresses_one_default_idx on public.customer_addresses(user_id) where is_default;
create trigger touch_updated_at before update on public.customer_addresses
  for each row execute function private.touch_updated_at();
alter table public.customer_addresses enable row level security;
revoke all on public.customer_addresses from public, anon, authenticated;
grant select, delete on public.customer_addresses to authenticated;
grant insert (user_id, label, full_name, phone, division, district, area, address_line, is_default) on public.customer_addresses to authenticated;
grant update (label, full_name, phone, division, district, area, address_line, is_default) on public.customer_addresses to authenticated;
create policy customer_addresses_own_read on public.customer_addresses for select to authenticated
  using (user_id = (select auth.uid()));
create policy customer_addresses_own_insert on public.customer_addresses for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy customer_addresses_own_update on public.customer_addresses for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy customer_addresses_own_delete on public.customer_addresses for delete to authenticated
  using (user_id = (select auth.uid()));

-- Profile phone: display/prefill only. The grant extension mirrors the
-- existing column-scoped style in 20261024010940_auth_security.sql
-- (insert/update on named columns only); SELECT on profiles is already
-- granted and own-row-policy restricted, so nothing else widens.
alter table public.profiles add column phone text check (phone is null or phone ~ '^01[3-9][0-9]{8}$');
comment on column public.profiles.phone is
  'Customer contact phone, display/prefill only. Unverified; never an ownership proof and never used to authorize access.';
grant insert (phone), update (phone) on public.profiles to authenticated;
commit;
