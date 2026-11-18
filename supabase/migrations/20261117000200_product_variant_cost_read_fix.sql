begin;
-- Anonymous cost-exposure fix: close the direct-read hole for
-- public.product_variants.cost_price_minor.
--
-- THE HOLE: the foundation migration grants table-level SELECT on
-- product_variants to anon and authenticated, and a table-level grant
-- covers every column, including columns added later. When migration
-- 20261115000200 added cost_price_minor, the existing grant covered
-- it immediately. The row-level policies (variant_public /
-- variant_staff) cannot filter columns, so an anonymous caller could
-- read the cost of every published, active variant through a direct
-- PostgREST table read, and any staff session with catalogue.read
-- could read ALL variants' costs, bypassing the UI hiding. The
-- public feed RPCs never returned costs; only direct table reads
-- leaked. The cost-write trigger (20261115001000) guards writes
-- only and never affected reads.
--
-- S6 PARSE-CHECK REQUIRED: this SQL must be parsed against real
-- Postgres before any gated apply. The operator migration-planning
-- check only orders files; it does not prove this SQL parses.
--
-- NEVER apply blind: apply only through an explicit, owner-approved
-- migration run, after a schema-drift check. Production apply needs
-- separate approval. Staging apply is a SEPARATE decision: do not
-- assume it from the production approval, or vice versa.
--
-- DEPENDENCIES (must already exist on the target database):
--   * foundation (20261024010934): table public.product_variants,
--     the table-level SELECT grant, policies variant_public and
--     variant_staff;
--   * 20261115000200 (file 21): column cost_price_minor;
--   * 20261027000200 (admin_catalogue): private.require_admin and
--     table public.admin_audit_logs;
--   * 20261115001000 (file 29): permission costs.read, function
--     public.admin_variant_costs, the enforce_cost_permission
--     trigger, and private.has_permission v4;
--   * 20261030000500 (file 15): function
--     public.admin_save_product_variant, replaced below.
-- This file sorts after all 42 existing migrations and depends on
-- files 21 and 29 in particular. In the production batch it MUST be
-- ordered AFTER files 21 and 29, so production never has a window
-- with the cost column but without this fix.
--
-- DRIFT CHECK (run before any apply; STOP and escalate on mismatch):
--   * product_variants has exactly these 11 columns, in this order:
--     id, product_id, sku, size, color, price_minor,
--     sale_price_minor, active, created_at, updated_at,
--     cost_price_minor;
--   * the current ACL is table-level SELECT for anon and
--     authenticated with no column privileges
--     (relacl shows anon=r, authenticated=r);
--   * policies variant_public and variant_staff exist unchanged;
--   * trigger enforce_cost_permission exists on product_variants;
--   * function public.admin_variant_costs(uuid[]) exists with its
--     costs.read enforcement and 1-500 bounds;
--   * function public.admin_save_product_variant(uuid, timestamptz,
--     uuid, jsonb) exists with the file-15 body (the replacement
--     below must be diffed against the live definition: the ONLY
--     intended difference is the audit capture shape).
-- The ghost migration 20261104000100 (present in staging history
-- with no repo file) must be confirmed at drift-check time not to
-- define or alter anything on product_variants.
--
-- Contents ONLY:
--   (a) revoke the table-level SELECT grant and re-grant an
--       explicit 10-column list excluding cost_price_minor, to
--       anon + authenticated. A column-only REVOKE is a proven
--       no-op against a table-level grant and must never be
--       substituted. The two policies, the trigger,
--       has_permission, and every other table's grants are
--       untouched: row visibility is identical before and after.
--   (b) CREATE OR REPLACE of admin_save_product_variant replacing
--       ONLY the whole-row to_jsonb audit capture (which copied
--       the full variant row, including the cost, into
--       admin_audit_logs readable by catalogue.manage holders)
--       with an explicit cost-free field list. Signature,
--       SECURITY DEFINER, search_path, grants, validation,
--       draft-only guard, and INSERT/UPDATE semantics are
--       preserved exactly. The staging gate for this function
--       lives in the action layer (variant-actions.ts), not in
--       this function, so the replacement is gate-neutral.
-- No roles, permissions, checkout, publication, or staging-gate
-- changes. No down-migration: rollback of the grant change would
-- mean a new forward migration re-granting table-level SELECT,
-- which would reopen the hole and must never be done silently.
--
-- HISTORY: the operator migration run records this file in
-- supabase_migrations.schema_migrations. This file contains NO
-- history INSERT; do not add one here.
--
-- KNOWN RESIDUALS (documented, not fixed here):
--   * Historical admin_audit_logs rows written before this fix
--     may still contain costs in changes.before. Scrubbing audit
--     history is a data change needing explicit owner approval.
--   * admin_variant_costs writes one audit row per call (count
--     only, no costs); each cost-viewer detail/analytics load
--     therefore adds one row. The audit insert is preserved.
--   * SELECT * (select=*) on product_variants by a direct caller
--     now fails with 42501 instead of returning rows. No repo
--     code selects *; external direct-API consumers doing so
--     break loudly rather than silently losing a column.
--   * PostgREST schema-cache pickup of the new grants must be
--     verified live after apply (gated read-only check).

-- (a) Column-list grant: cost_price_minor is readable by NO direct
-- caller. The gated admin_variant_costs RPC (costs.read + MFA) is
-- the only cost-read path. Revoking the table-level grant first is
-- essential: a column-only revoke cannot undo it.
revoke select on public.product_variants from anon, authenticated;
grant select (id, product_id, sku, size, color, price_minor, sale_price_minor, active, created_at, updated_at)
  on public.product_variants to anon, authenticated;

-- FAIL-CLOSED RULE: any future column added to product_variants is
-- invisible to anon/authenticated until explicitly granted. The
-- next migration that adds a column meant to be publicly readable
-- MUST extend the grant list above; a column meant to stay
-- restricted (like cost_price_minor) must stay off the list and be
-- served only through a gated RPC.
comment on table public.product_variants is
  'Direct SELECT for anon/authenticated is an explicit 10-column grant excluding cost_price_minor (see migration 20261117000200). New columns are invisible until explicitly granted: fail-closed by design. Cost prices are readable only via the gated admin_variant_costs RPC.';
comment on column public.product_variants.cost_price_minor is
  'Cost price. Excluded from the anon/authenticated SELECT grant: readable only via public.admin_variant_costs (costs.read + MFA AAL2). Never add this column to a direct-read grant.';

-- (b) Audit-capture replacement for admin_save_product_variant.
-- Body copied from 20261030000500; the ONLY change is the audit
-- insert: the whole-row to_jsonb capture (full row incl. cost) becomes an
-- explicit 10-field object with the same field order and values,
-- minus cost_price_minor. When no previous row exists (INSERT
-- path), every field is null, exactly as before.
create or replace function public.admin_save_product_variant(target_id uuid,expected_updated_at timestamptz,target_variant uuid,variant jsonb)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare p public.products; previous public.product_variants; saved timestamptz;
 sku_value text:=btrim(variant->>'sku'); size_value text:=btrim(variant->>'size'); color_value text:=btrim(variant->>'color');
 regular bigint; sale bigint; enabled boolean;
begin
 perform private.require_admin('catalogue.manage');
 if target_id is null or target_variant is null or expected_updated_at is null or variant is null or jsonb_typeof(variant)<>'object'
  or coalesce(sku_value,'') !~ '[^[:space:]]' or length(sku_value)>100
  or coalesce(size_value,'') !~ '[^[:space:]]' or length(size_value)>40 or upper(size_value) in ('N/A','NA','UNKNOWN')
  or coalesce(color_value,'') !~ '[^[:space:]]' or length(color_value)>80
  or coalesce(variant->>'price_minor','') !~ '^[0-9]{1,16}$'
  or (variant->>'sale_price_minor' is not null and variant->>'sale_price_minor' !~ '^[0-9]{1,16}$')
  or coalesce(variant->>'active','') not in ('true','false') then
  raise exception 'Invalid SKU, actual size, color or price' using errcode='22023';
 end if;
 regular:=(variant->>'price_minor')::bigint; sale:=(variant->>'sale_price_minor')::bigint; enabled:=(variant->>'active')::boolean;
 if regular>9007199254740991 or sale>regular or (enabled and regular=0) then raise exception 'Invalid prices' using errcode='22023'; end if;
 select * into p from public.products where id=target_id for update;
 if not found or p.status<>'draft' then raise exception 'Edit SKUs on a draft only' using errcode='22023'; end if;
 if p.updated_at is distinct from expected_updated_at then raise exception 'Product changed; reload' using errcode='PT409'; end if;
 if exists(select 1 from public.thrift_intake where product_id=target_id) then raise exception 'Use physical garment verification; do not invent thrift variants' using errcode='22023'; end if;
 select * into previous from public.product_variants where id=target_variant for update;
 if found then
  if previous.product_id<>target_id then raise exception 'SKU belongs to another product' using errcode='22023'; end if;
  if previous.sku=sku_value and previous.size=size_value and previous.color=color_value and previous.price_minor=regular and previous.sale_price_minor is not distinct from sale and previous.active=enabled then return p.updated_at; end if;
  update public.product_variants set sku=sku_value,size=size_value,color=color_value,price_minor=regular,sale_price_minor=sale,active=enabled where id=target_variant;
 else
  if (select count(*) from public.product_variants where product_id=target_id)>=100 then raise exception 'Maximum 100 SKUs per product' using errcode='22023'; end if;
  insert into public.product_variants(id,product_id,sku,size,color,price_minor,sale_price_minor,active)
   values(target_variant,target_id,sku_value,size_value,color_value,regular,sale,enabled);
  insert into public.inventory(variant_id) values(target_variant);
 end if;
 update public.products set updated_at=clock_timestamp() where id=target_id returning updated_at into saved;
 insert into public.admin_audit_logs(actor_id,action,target_id,changes)
 values(auth.uid(),'product.variant_saved',target_id,jsonb_build_object('variant_id',target_variant,'before',jsonb_build_object('id',previous.id,'product_id',previous.product_id,'sku',previous.sku,'size',previous.size,'color',previous.color,'price_minor',previous.price_minor,'sale_price_minor',previous.sale_price_minor,'active',previous.active,'created_at',previous.created_at,'updated_at',previous.updated_at),'after',variant));
 return saved;
end $$;
revoke all on function public.admin_save_product_variant(uuid,timestamptz,uuid,jsonb) from public,anon;
grant execute on function public.admin_save_product_variant(uuid,timestamptz,uuid,jsonb) to authenticated;
commit;
