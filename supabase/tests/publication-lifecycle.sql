-- LOCAL TEST ONLY for supabase/proposed/20261110000100_product_publication_lifecycle.sql.
-- Run after bootstrap.sql, all migrations and the proposal. Rolls back.
\set ON_ERROR_STOP on
begin;
create schema test;
grant usage on schema test to anon, authenticated;
create function test.assert_true(condition boolean, label text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create function test.denied(command text, expected_code text, label text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when others then
  if sqlstate = expected_code then raise notice 'PASS: %', label; return; end if; raise;
 end;
 raise exception 'FAIL (operation unexpectedly succeeded): %', label;
end $$;
grant execute on all functions in schema test to anon, authenticated;

-- Fixtures (as superuser): a Product Manager, an Analyst, one category, one draft.
insert into auth.users(id,email) values
 ('a0000000-0000-4000-8000-000000000001','pm@example.test'),
 ('a0000000-0000-4000-8000-000000000002','analyst@example.test');
insert into public.user_roles(user_id,role) values
 ('a0000000-0000-4000-8000-000000000001','product_manager'),
 ('a0000000-0000-4000-8000-000000000002','analyst');
insert into public.categories(id,name,slug,published) values('c0000000-0000-4000-8000-000000000001','Shirts','shirts',true);
insert into public.products(id,name,slug,description) values('b0000000-0000-4000-8000-000000000001','Test Oxford Shirt','test-oxford-shirt','');
create function test.v() returns timestamptz language sql as $$select updated_at from public.products where id='b0000000-0000-4000-8000-000000000001'$$;
grant execute on function test.v() to anon,authenticated;
grant select on public.products to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select test.denied($q$select public.admin_set_product_publication('b0000000-0000-4000-8000-000000000001',test.v(),true)$q$,'42501','Product Manager without MFA cannot publish');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select test.denied($q$select public.admin_set_product_publication('b0000000-0000-4000-8000-000000000001',test.v(),true)$q$,'42501','Analyst cannot publish');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select test.denied($q$select public.admin_set_product_publication('b0000000-0000-4000-8000-000000000001',test.v(),true)$q$,'23514','incomplete draft cannot be published');
select test.denied($q$select public.admin_set_product_publication('b0000000-0000-4000-8000-000000000001',now()-interval '1 day',true)$q$,'PT409','stale version refused');

-- Complete the draft through the existing RPCs and storage, as staff would.
select public.admin_update_product_draft('b0000000-0000-4000-8000-000000000001',test.v(),'Test Oxford Shirt','A plain cotton oxford shirt.');
reset role;
update public.products set category_id='c0000000-0000-4000-8000-000000000001' where id='b0000000-0000-4000-8000-000000000001';
insert into storage.objects(id,bucket_id,name) values('d0000000-0000-4000-8000-000000000001','attires-product-drafts','a0000000-0000-4000-8000-000000000001/front.jpg'),
 ('d0000000-0000-4000-8000-000000000002','attires-product-drafts','a0000000-0000-4000-8000-000000000001/unlinked.jpg');
insert into public.product_media(product_id,storage_object_id,storage_path,alt_text,position)
 values('b0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001/front.jpg','Front',0);
set local role authenticated;
select public.admin_save_product_variant('b0000000-0000-4000-8000-000000000001',test.v(),'e0000000-0000-4000-8000-000000000001','{"sku":"TEST-OX-M","size":"M","color":"White","price_minor":150000,"sale_price_minor":120000,"active":true}');
select test.denied($q$select public.admin_set_product_publication('b0000000-0000-4000-8000-000000000001',test.v(),true)$q$,'23514','no stock: cannot publish');
select public.admin_adjust_product_stock('b0000000-0000-4000-8000-000000000001',test.v(),'e0000000-0000-4000-8000-000000000001',3,'Initial stock count');

-- Anonymous visitors see nothing while it is a draft.
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select test.assert_true(jsonb_array_length(public.published_product_catalogue())=0,'draft excluded from public catalogue');
select test.assert_true((select count(*) from storage.objects where bucket_id='attires-product-drafts')=0,'draft image not readable by anon');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select public.admin_set_product_publication('b0000000-0000-4000-8000-000000000001',test.v(),true);
select test.assert_true((select status='published' from public.products where id='b0000000-0000-4000-8000-000000000001'),'ready product published');
select test.denied($q$select public.admin_delete_product('b0000000-0000-4000-8000-000000000001',test.v())$q$,'23514','published product cannot be deleted');

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select test.assert_true((select p->>'slug'='test-oxford-shirt' and (p->'variants'->0->>'available')::int=3 and (p->'variants'->0->>'sale_price_minor')::int=120000
  and p->'category'->>'slug'='shirts' and p->'media'->0->>'path'='a0000000-0000-4000-8000-000000000001/front.jpg'
  from jsonb_array_elements(public.published_product_catalogue()) p),'published product, SKU, stock, category and image path are public');
select test.assert_true((select array_agg(name)=array['a0000000-0000-4000-8000-000000000001/front.jpg'] from storage.objects where bucket_id='attires-product-drafts'),'only the published image is readable by anon');
select test.denied($q$insert into storage.objects(bucket_id,name) values('attires-product-drafts','x/evil.jpg')$q$,'42501','anon still cannot upload');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select public.admin_set_product_publication('b0000000-0000-4000-8000-000000000001',test.v(),false);
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select test.assert_true(jsonb_array_length(public.published_product_catalogue())=0,'unpublished product leaves public catalogue');
select test.assert_true((select count(*) from storage.objects where bucket_id='attires-product-drafts')=0,'unpublished image no longer readable by anon');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select test.denied($q$select public.admin_delete_product('b0000000-0000-4000-8000-000000000001',test.v())$q$,'42501','Analyst cannot delete');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select test.assert_true(public.admin_delete_product('b0000000-0000-4000-8000-000000000001',test.v())=jsonb_build_array('a0000000-0000-4000-8000-000000000001/front.jpg'),'delete returns unlinked image paths');
reset role;
select test.assert_true(not exists(select 1 from public.products where id='b0000000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.product_variants where id='e0000000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.inventory where variant_id='e0000000-0000-4000-8000-000000000001'),'product, SKU and inventory removed');
select test.assert_true((select array_agg(action order by created_at) @> array['product.published','product.unpublished','product.deleted'] from public.admin_audit_logs where target_id='b0000000-0000-4000-8000-000000000001'),'publish, unpublish and delete audited');
select test.assert_true((select jsonb_array_length(changes->'inventory_movements')=1 from public.admin_audit_logs where action='product.deleted' and target_id='b0000000-0000-4000-8000-000000000001'),'stock history preserved in delete audit');

-- Thrift garments: verification step, and original intake records cannot be deleted.
insert into public.products(id,name,slug,description) values('b0000000-0000-4000-8000-000000000002','Thrift Shirt','aa-shirt-901','Real garment.');
insert into public.thrift_intake(source_id,product_id,image_path,image_sha256,price_minor,actual_size,actual_color)
 values('AA-SHIRT-901','b0000000-0000-4000-8000-000000000002','/inventory/thrift-shirts/AA-SHIRT-901-front.jpg',repeat('a',64),90000,'L','Blue');
create or replace function test.v2() returns timestamptz language sql as $$select updated_at from public.products where id='b0000000-0000-4000-8000-000000000002'$$;
grant execute on function test.v2() to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select test.denied($q$select public.admin_set_product_publication('b0000000-0000-4000-8000-000000000002',test.v2(),true)$q$,'23514','unverified garment cannot be published');
select public.admin_verify_thrift_garment('b0000000-0000-4000-8000-000000000002',test.v2());
reset role;
select test.assert_true((select size_verified and details_verified from public.thrift_intake where source_id='AA-SHIRT-901'),'garment verified by staff step');
set local role authenticated;
select test.denied($q$select public.admin_delete_product('b0000000-0000-4000-8000-000000000002',test.v2())$q$,'23514','original thrift intake cannot be deleted');
rollback;
