-- PROPOSED — NOT APPLIED. Requires explicit owner approval before it is moved
-- into supabase/migrations/ and applied to STAGING (jwccyndyaamodxjtjtfo) only.
-- Never apply to Production.
--
-- Purpose: the existing schema has no way for staff to publish, unpublish or
-- delete a product, no staff workflow to verify a thrift garment, and no public
-- read path for non-thrift products or their images. This file adds exactly
-- those capabilities, following the conventions of the existing admin RPCs:
-- SECURITY DEFINER, empty search_path, private.require_admin (permission + MFA
-- aal2), expected_updated_at conflict protection (PT409), and an audit entry.
--
-- No table is altered or dropped. No existing policy is changed or weakened.
-- One ADDITIVE Storage SELECT policy is introduced (section 5): anyone may read
-- the image bytes of a product ONLY while that product is published. Draft,
-- archived, deleted and unlinked objects stay staff-only.
begin;

-- 1. Publish / unpublish ----------------------------------------------------
create function public.admin_set_product_publication(target_id uuid,expected_updated_at timestamptz,publish boolean)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare p public.products; saved timestamptz; thrift boolean; problems text[]:='{}';
begin
 perform private.require_admin('catalogue.manage');
 if target_id is null or expected_updated_at is null or publish is null then
  raise exception 'Invalid publication request' using errcode='22023';
 end if;
 select * into p from public.products where id=target_id for update;
 if not found then raise exception 'Product not found' using errcode='22023'; end if;
 if p.updated_at is distinct from expected_updated_at then raise exception 'Product changed; reload' using errcode='PT409'; end if;
 if publish and p.status='published' then return p.updated_at; end if;
 if not publish and p.status<>'published' then return p.updated_at; end if;
 thrift:=exists(select 1 from public.thrift_intake where product_id=target_id);
 if publish then
  -- Server-side readiness: the browser checklist is advisory only.
  if btrim(p.name)='' then problems:=array_append(problems,'name'); end if;
  if btrim(p.description)='' then problems:=array_append(problems,'description'); end if;
  if thrift then
   -- private.guard_thrift_publication additionally enforces verification.
   if not exists(select 1 from public.thrift_intake where product_id=target_id and size_verified and details_verified and price_minor>0 and stock_quantity=1)
    then problems:=array_append(problems,'verified garment'); end if;
  else
   if p.category_id is null then problems:=array_append(problems,'category'); end if;
   if not exists(select 1 from public.product_media where product_id=target_id) then problems:=array_append(problems,'image'); end if;
   if not exists(select 1 from public.product_variants where product_id=target_id and active and price_minor>0) then problems:=array_append(problems,'active priced SKU'); end if;
   if coalesce((select sum(s.available) from public.product_variants v join public.inventory s on s.variant_id=v.id where v.product_id=target_id and v.active),0)<=0
    then problems:=array_append(problems,'stock'); end if;
  end if;
  if cardinality(problems)>0 then
   raise exception 'Product is not ready to publish: %',array_to_string(problems,', ') using errcode='23514';
  end if;
 end if;
 update public.products set status=case when publish then 'published' else 'draft' end,updated_at=clock_timestamp()
  where id=target_id returning updated_at into saved;
 insert into public.admin_audit_logs(actor_id,action,target_id,changes)
 values(auth.uid(),case when publish then 'product.published' else 'product.unpublished' end,target_id,
  jsonb_build_object('before',p.status,'after',case when publish then 'published' else 'draft' end));
 return saved;
end $$;
revoke all on function public.admin_set_product_publication(uuid,timestamptz,boolean) from public,anon;
grant execute on function public.admin_set_product_publication(uuid,timestamptz,boolean) to authenticated;

-- 2. Thrift garment verification -------------------------------------------
-- Saving a garment draft resets verification; this is the explicit staff step
-- that records "I checked the physical size and details".
create function public.admin_verify_thrift_garment(target_id uuid,expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare p public.products; i public.thrift_intake; saved timestamptz;
begin
 perform private.require_admin('catalogue.manage');
 select * into p from public.products where id=target_id for update;
 if not found then raise exception 'Product not found' using errcode='22023'; end if;
 if p.updated_at is distinct from expected_updated_at then raise exception 'Product changed; reload' using errcode='PT409'; end if;
 select * into i from public.thrift_intake where product_id=target_id for update;
 if not found then raise exception 'Not a thrift garment' using errcode='22023'; end if;
 if i.actual_size is null or i.actual_color is null then
  raise exception 'Record the actual size and colour before verifying' using errcode='23514';
 end if;
 update public.thrift_intake set size_verified=true,details_verified=true,updated_at=clock_timestamp() where product_id=target_id;
 update public.products set updated_at=clock_timestamp() where id=target_id returning updated_at into saved;
 insert into public.admin_audit_logs(actor_id,action,target_id,changes)
 values(auth.uid(),'product.garment_verified',target_id,jsonb_build_object('size',i.actual_size,'color',i.actual_color));
 return saved;
end $$;
revoke all on function public.admin_verify_thrift_garment(uuid,timestamptz) from public,anon;
grant execute on function public.admin_verify_thrift_garment(uuid,timestamptz) to authenticated;

-- 3. Safe deletion of a staff-created, unpublished product -----------------
-- Refuses: published products, the original thrift intake records, products
-- with customer reviews, and stock reserved for orders. Inventory history is
-- copied into the audit entry before removal. Returns the Storage paths that
-- were unlinked so the server action can delete those image files through
-- the normal staff-scoped Storage API (no direct storage.objects deletion).
create function public.admin_delete_product(target_id uuid,expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.products; paths jsonb; history jsonb;
begin
 perform private.require_admin('catalogue.manage');
 select * into p from public.products where id=target_id for update;
 if not found then raise exception 'Product not found' using errcode='22023'; end if;
 if p.updated_at is distinct from expected_updated_at then raise exception 'Product changed; reload' using errcode='PT409'; end if;
 if p.status='published' then raise exception 'Unpublish before deleting' using errcode='23514'; end if;
 if exists(select 1 from public.thrift_intake where product_id=target_id) then
  raise exception 'Original thrift intake records cannot be deleted; archive instead' using errcode='23514'; end if;
 if exists(select 1 from public.product_reviews where product_id=target_id) then
  raise exception 'Product has customer reviews and cannot be deleted' using errcode='23514'; end if;
 if exists(select 1 from public.product_variants v join public.inventory s on s.variant_id=v.id where v.product_id=target_id and s.reserved>0) then
  raise exception 'Stock is reserved for orders' using errcode='23514'; end if;
 select coalesce(jsonb_agg(storage_path),'[]'::jsonb) into paths from public.product_media where product_id=target_id;
 select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) into history from public.inventory_movements m
  where m.variant_id in (select id from public.product_variants where product_id=target_id);
 insert into public.admin_audit_logs(actor_id,action,target_id,changes)
 values(auth.uid(),'product.deleted',target_id,jsonb_build_object('product',to_jsonb(p),
  'variants',(select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) from public.product_variants v where v.product_id=target_id),
  'inventory_movements',history,'media',paths));
 delete from public.product_catalogue_terms where product_id=target_id;
 delete from public.product_media where product_id=target_id;
 delete from public.inventory_movements where variant_id in (select id from public.product_variants where product_id=target_id);
 delete from public.inventory where variant_id in (select id from public.product_variants where product_id=target_id);
 delete from public.product_variants where product_id=target_id;
 delete from public.products where id=target_id;
 return paths;
end $$;
revoke all on function public.admin_delete_product(uuid,timestamptz) from public,anon;
grant execute on function public.admin_delete_product(uuid,timestamptz) to authenticated;

-- 4. Public catalogue for staff-managed (non-thrift) products ---------------
-- Returns ONLY status='published' products. Drafts, archived products,
-- inactive SKUs and unpublished brands/collections are never included.
create function public.published_product_catalogue(page_offset integer default 0,page_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(row_data order by created_at desc,id),'[]'::jsonb) from (
  select p.id,p.created_at,jsonb_build_object(
   'id',p.id,'slug',p.slug,'name',p.name,'description',p.description,'created_at',p.created_at,'updated_at',p.updated_at,
   'category',(select jsonb_build_object('slug',c.slug,'name',c.name) from public.categories c where c.id=p.category_id and c.published),
   'terms',(select coalesce(jsonb_agg(jsonb_build_object('kind',t.kind,'slug',t.slug,'name',t.name) order by t.kind,t.name),'[]'::jsonb)
     from public.product_catalogue_terms r join public.catalogue_terms t on t.id=r.term_id where r.product_id=p.id and t.published),
   'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'size',v.size,'color',v.color,
      'price_minor',v.price_minor,'sale_price_minor',v.sale_price_minor,'available',greatest(coalesce(s.available,0),0)) order by v.color,v.size),'[]'::jsonb)
     from public.product_variants v left join public.inventory s on s.variant_id=v.id where v.product_id=p.id and v.active),
   'media',(select coalesce(jsonb_agg(jsonb_build_object('path',m.storage_path,'alt',m.alt_text) order by m.position),'[]'::jsonb)
     from public.product_media m where m.product_id=p.id)
  ) as row_data
  from public.products p
  where p.status='published' and not exists(select 1 from public.thrift_intake i where i.product_id=p.id)
  order by p.created_at desc,p.id
  offset greatest(coalesce(page_offset,0),0) limit least(greatest(coalesce(page_limit,100),1),100)
 ) q;
$$;
revoke all on function public.published_product_catalogue(integer,integer) from public;
grant execute on function public.published_product_catalogue(integer,integer) to anon,authenticated;

-- 5. Additive Storage read policy: images of PUBLISHED products only --------
-- product_media is not readable by anon, so the check runs as a definer
-- function that reveals only a yes/no for one object path. (anon has no usage
-- on schema private, hence public.)
create function public.is_published_product_media(object_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.product_media m join public.products p on p.id=m.product_id
  where m.storage_path=object_name and p.status='published');
$$;
revoke all on function public.is_published_product_media(text) from public;
grant execute on function public.is_published_product_media(text) to anon,authenticated;
create policy published_product_media_read on storage.objects for select to anon,authenticated
 using(bucket_id='attires-product-drafts' and public.is_published_product_media(name));

commit;
