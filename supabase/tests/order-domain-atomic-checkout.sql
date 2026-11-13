-- LOCAL TEST ONLY for 20261113000200 (order domain), rewritten for 20261113000300.
-- Eligibility now matches the storefront feed: published, verified THRIFT garments only.
-- Run after bootstrap.sql and every repository migration. Rolls back everything.
\set ON_ERROR_STOP on
begin;
create schema test;
grant usage on schema test to anon, authenticated, service_role;
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
create table test.tokens(k text primary key, t text not null);
create function test.tok(key text) returns text language sql stable as $$select t from test.tokens where k = key$$;
create function test.h(raw text) returns text language sql immutable as $$select encode(sha256(convert_to(raw,'UTF8')),'hex')$$;
grant all on test.tokens to service_role, authenticated, anon;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- Tests are throttled by default; the rate-limit behaviour itself is tested in the security suite.
update private.checkout_settings set orders_enabled = true, sessions_per_client_per_hour = 100000,
 writes_per_client_per_minute = 100000, orders_per_client_per_hour = 100000, orders_per_phone_per_day = 100000;

-- The existing order-number regression deliberately exhausts this NON-transactional sequence; reset it (disposable DB).
select setval('private.customer_order_number_sequence', 10000, false);
-- ------------------------------------------------------------------ fixtures (superuser)
insert into auth.users(id,email,is_anonymous) values
 ('a2000000-0000-4000-8000-000000000001','owner@example.test',false),
 ('a2000000-0000-4000-8000-000000000002','analyst@example.test',false),
 ('a2000000-0000-4000-8000-000000000003','customer@example.test',false),
 ('a2000000-0000-4000-8000-000000000004','other@example.test',false);
insert into public.user_roles(user_id,role) values
 ('a2000000-0000-4000-8000-000000000001','owner'),('a2000000-0000-4000-8000-000000000002','analyst');
insert into public.categories(id,name,slug,published) values ('c2000000-0000-4000-8000-000000000001','Shirts','shirts',true);
insert into public.products(id,category_id,name,slug,description,status) values
 ('b2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Thrift Oxford','aa-shirt-901','x','draft'),
 ('b2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','Thrift Polo','aa-shirt-902','x','draft'),
 ('b2000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000001','Thrift Unpublished','aa-shirt-903','x','draft'),
 ('b2000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000001','Plain Non-thrift Tee','basic-tee','x','draft'),
 ('b2000000-0000-4000-8000-000000000005','c2000000-0000-4000-8000-000000000001','Thrift Sold Out','aa-shirt-905','x','draft'),
 ('b2000000-0000-4000-8000-000000000006','c2000000-0000-4000-8000-000000000001','Thrift Wrong Size','aa-shirt-906','x','draft');
insert into public.product_variants(id,product_id,sku,size,color,price_minor,active) values
 ('e2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','AA-SHIRT-901','M','White',0,true),
 ('e2000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','AA-SHIRT-902','L','Navy',0,true),
 ('e2000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000003','AA-SHIRT-903','M','Blue',0,true),
 ('e2000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000004','TEE-M-BLK','M','Black',50000,true),
 ('e2000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000005','AA-SHIRT-905','M','Grey',0,true),
 ('e2000000-0000-4000-8000-000000000006','b2000000-0000-4000-8000-000000000006','AA-SHIRT-906','S','Red',0,true);
insert into public.inventory(variant_id,on_hand) values
 ('e2000000-0000-4000-8000-000000000001',1),('e2000000-0000-4000-8000-000000000002',1),('e2000000-0000-4000-8000-000000000003',1),
 ('e2000000-0000-4000-8000-000000000004',10),('e2000000-0000-4000-8000-000000000005',1),('e2000000-0000-4000-8000-000000000006',1);
insert into public.thrift_intake(source_id,product_id,image_path,image_sha256,price_minor,stock_quantity,actual_size,actual_color,size_verified,details_verified) values
 ('AA-SHIRT-901','b2000000-0000-4000-8000-000000000001','/inventory/thrift-shirts/AA-SHIRT-901-front.jpg',repeat('a',64),120000,1,'M','White',true,true),
 ('AA-SHIRT-902','b2000000-0000-4000-8000-000000000002','/inventory/thrift-shirts/AA-SHIRT-902-front.jpg',repeat('b',64),90000,1,'L','Navy',true,true),
 ('AA-SHIRT-903','b2000000-0000-4000-8000-000000000003','/inventory/thrift-shirts/AA-SHIRT-903-front.jpg',repeat('c',64),100000,1,'M','Blue',true,true),
 ('AA-SHIRT-905','b2000000-0000-4000-8000-000000000005','/inventory/thrift-shirts/AA-SHIRT-905-front.jpg',repeat('e',64),70000,0,'M','Grey',true,true),
 ('AA-SHIRT-906','b2000000-0000-4000-8000-000000000006','/inventory/thrift-shirts/AA-SHIRT-906-front.jpg',repeat('f',64),60000,1,'M','Red',true,true);
-- Publish the verified garments (publication requires verification, as the storefront does).
update public.products set status='published' where id in ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000006');
update public.products set status='published' where id='b2000000-0000-4000-8000-000000000004';
-- Size mismatch on purpose: the variant says S, the verified intake says M.
update public.product_variants set size='S' where id='e2000000-0000-4000-8000-000000000006';
update public.thrift_intake set actual_size='M' where source_id='AA-SHIRT-906';

insert into public.products(id,category_id,name,slug,description,status) values
 ('b2000000-0000-4000-8000-000000000007','c2000000-0000-4000-8000-000000000001','Thrift AA-SHIRT-907','aa-shirt-907','x','draft'),
 ('b2000000-0000-4000-8000-000000000008','c2000000-0000-4000-8000-000000000001','Thrift AA-SHIRT-908','aa-shirt-908','x','draft'),
 ('b2000000-0000-4000-8000-000000000009','c2000000-0000-4000-8000-000000000001','Thrift AA-SHIRT-909','aa-shirt-909','x','draft'),
 ('b2000000-0000-4000-8000-000000000010','c2000000-0000-4000-8000-000000000001','Thrift AA-SHIRT-910','aa-shirt-910','x','draft'),
 ('b2000000-0000-4000-8000-000000000011','c2000000-0000-4000-8000-000000000001','Thrift AA-SHIRT-911','aa-shirt-911','x','draft'),
 ('b2000000-0000-4000-8000-000000000012','c2000000-0000-4000-8000-000000000001','Thrift AA-SHIRT-912','aa-shirt-912','x','draft'),
 ('b2000000-0000-4000-8000-000000000013','c2000000-0000-4000-8000-000000000001','Thrift AA-SHIRT-913','aa-shirt-913','x','draft');
insert into public.product_variants(id,product_id,sku,size,color,price_minor,active) values
 ('e2000000-0000-4000-8000-000000000007','b2000000-0000-4000-8000-000000000007','AA-SHIRT-907','M','Navy',0,true),
 ('e2000000-0000-4000-8000-000000000008','b2000000-0000-4000-8000-000000000008','AA-SHIRT-908','M','Olive',0,true),
 ('e2000000-0000-4000-8000-000000000009','b2000000-0000-4000-8000-000000000009','AA-SHIRT-909','L','Cream',0,true),
 ('e2000000-0000-4000-8000-000000000010','b2000000-0000-4000-8000-000000000010','AA-SHIRT-910','M','Maroon',0,true),
 ('e2000000-0000-4000-8000-000000000011','b2000000-0000-4000-8000-000000000011','AA-SHIRT-911','M','Teal',0,true),
 ('e2000000-0000-4000-8000-000000000012','b2000000-0000-4000-8000-000000000012','AA-SHIRT-912','M','Sand',0,true),
 ('e2000000-0000-4000-8000-000000000013','b2000000-0000-4000-8000-000000000013','AA-SHIRT-913','S','Ivory',0,true);
insert into public.inventory(variant_id,on_hand) values
 ('e2000000-0000-4000-8000-000000000007',1),
 ('e2000000-0000-4000-8000-000000000008',1),
 ('e2000000-0000-4000-8000-000000000009',1),
 ('e2000000-0000-4000-8000-000000000010',1),
 ('e2000000-0000-4000-8000-000000000011',1),
 ('e2000000-0000-4000-8000-000000000012',1),
 ('e2000000-0000-4000-8000-000000000013',1);
insert into public.thrift_intake(source_id,product_id,image_path,image_sha256,price_minor,stock_quantity,actual_size,actual_color,size_verified,details_verified) values
 ('AA-SHIRT-907','b2000000-0000-4000-8000-000000000007','/inventory/thrift-shirts/AA-SHIRT-907-front.jpg',repeat('07',32),80000,1,'M','Navy',true,true),
 ('AA-SHIRT-908','b2000000-0000-4000-8000-000000000008','/inventory/thrift-shirts/AA-SHIRT-908-front.jpg',repeat('08',32),70000,1,'M','Olive',true,true),
 ('AA-SHIRT-909','b2000000-0000-4000-8000-000000000009','/inventory/thrift-shirts/AA-SHIRT-909-front.jpg',repeat('09',32),60000,1,'L','Cream',true,true),
 ('AA-SHIRT-910','b2000000-0000-4000-8000-000000000010','/inventory/thrift-shirts/AA-SHIRT-910-front.jpg',repeat('10',32),50000,1,'M','Maroon',true,true),
 ('AA-SHIRT-911','b2000000-0000-4000-8000-000000000011','/inventory/thrift-shirts/AA-SHIRT-911-front.jpg',repeat('11',32),40000,1,'M','Teal',true,true),
 ('AA-SHIRT-912','b2000000-0000-4000-8000-000000000012','/inventory/thrift-shirts/AA-SHIRT-912-front.jpg',repeat('12',32),30000,1,'M','Sand',true,true),
 ('AA-SHIRT-913','b2000000-0000-4000-8000-000000000013','/inventory/thrift-shirts/AA-SHIRT-913-front.jpg',repeat('13',32),45000,1,'S','Ivory',true,true);
update public.products set status='published' where id in ('b2000000-0000-4000-8000-000000000007','b2000000-0000-4000-8000-000000000008','b2000000-0000-4000-8000-000000000009','b2000000-0000-4000-8000-000000000010','b2000000-0000-4000-8000-000000000011','b2000000-0000-4000-8000-000000000012','b2000000-0000-4000-8000-000000000013');

-- Expired credential, written as a session that started eight days ago.
insert into test.tokens values ('expired',repeat('e',64));
insert into public.checkout_sessions(id,token_hash,customer_name,phone,started_at,last_activity_at,expires_at) values
 ('d2000000-0000-4000-8000-000000000009',test.h(repeat('e',64)),'Expired Guest','01700000009',now()-interval '8 days',now()-interval '8 days',now()-interval '1 day');

-- ------------------------------------------------------------------ eligibility parity with the storefront feed (superuser)
select test.assert_true((select bool_and(o.orderable = coalesce((select (g->>'in_stock')::boolean from jsonb_array_elements(public.published_thrift_catalogue()) g where (g->>'variant_id')::uuid = v.id), false))
  from public.product_variants v join lateral (select * from private.orderable_variant(v.id)) o on true),
  'orderable matches the storefront feed for every fixture variant (published, verified, in stock)');
select test.assert_true((not exists(select 1 from private.orderable_variant('e2000000-0000-4000-8000-000000000004') where orderable)),'published non-thrift product is never orderable');
select test.assert_true((select count(*)=0 from private.orderable_variant('e2000000-0000-4000-8000-00000000ffff')),'unknown variant UUID is not orderable');
select test.assert_true((not exists(select 1 from private.orderable_variant('e2000000-0000-4000-8000-000000000003') where orderable)),'unpublished thrift garment is not orderable');
select test.assert_true((not exists(select 1 from private.orderable_variant('e2000000-0000-4000-8000-000000000005') where orderable)),'sold-out garment is not orderable');
select test.assert_true((not exists(select 1 from private.orderable_variant('e2000000-0000-4000-8000-000000000006') where orderable)),'variant size that differs from the verified intake is not orderable');

-- ------------------------------------------------------------------ privileges
select test.assert_true(not has_function_privilege('anon','public.place_checkout_order(text,jsonb,text,text,text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.set_checkout_items(text,jsonb,text)','EXECUTE'),'anonymous callers cannot place or edit orders');
select test.assert_true(has_function_privilege('service_role','public.place_checkout_order(text,jsonb,text,text,text,jsonb)','EXECUTE'),'trusted server can place orders');
select test.assert_true(not has_table_privilege('anon','public.orders','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon','public.order_items','SELECT,INSERT,UPDATE,DELETE'),'anon has no table privilege on orders or order_items');
select test.assert_true(not has_table_privilege('authenticated','public.orders','INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated','public.order_items','INSERT,UPDATE,DELETE'),'authenticated cannot write orders or order_items directly');
select test.assert_true(not has_table_privilege('service_role','public.orders','SELECT,INSERT,UPDATE,DELETE'),'trusted server has no direct table access to orders (only RPCs)');
select test.assert_true(not has_table_privilege('authenticated','private.checkout_settings','SELECT,UPDATE') and not has_table_privilege('anon','private.checkout_settings','SELECT'),'settings are not readable or writable by API roles');
select test.assert_true(not has_function_privilege('anon','public.admin_set_order_status(uuid,timestamptz,text)','EXECUTE') and not has_function_privilege('authenticated','private.orderable_variant(uuid)','EXECUTE') and not has_function_privilege('service_role','private.orderable_variant(uuid)','EXECUTE'),'admin and internal functions are not executable by API roles');
select test.assert_true((select count(*)>=3 from pg_constraint where conname in ('checkout_sessions_order_id_fkey','customer_order_numbers_order_id_fkey','orders_checkout_session_id_fkey') and contype='f'),'checkout session, order number ledger and order row all reference orders');

-- ------------------------------------------------------------------ settings-gated ordering
update private.checkout_settings set orders_enabled = false;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select test.denied($q$select public.start_checkout_session('Disabled Guest','01700000010',null,'step2-client-0001')$q$,'CK008','ordering disabled in the database: checkout cannot start');
reset role;
update private.checkout_settings set orders_enabled = true;

-- ------------------------------------------------------------------ guest checkout (trusted server)
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into test.tokens select 'g1', public.start_checkout_session('  Nasrin Akter ','+880 1712-345678','Guest@Example.TEST','step2-client-0001')->>'token';
select test.denied('select public.place_checkout_order(''' || test.tok('g1') || ''',''{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}'',''cod'',null,''step2-client-0001'',null)','CK003','empty checkout rejected');
select test.denied('select public.set_checkout_items(''' || test.tok('g1') || ''',''[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":2}]'',''step2-client-0001'')','CK011','thrift garment cannot be ordered in quantity 2');
select test.denied('select public.set_checkout_items(''' || test.tok('g1') || ''',''[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":0}]'',''step2-client-0001'')','22023','quantity 0 rejected');
select test.denied('select public.set_checkout_items(''' || test.tok('g1') || ''',''[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":100}]'',''step2-client-0001'')','22023','quantity 100 rejected');
select test.denied('select public.set_checkout_items(''' || test.tok('g1') || ''',''[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":"2; drop"}]'',''step2-client-0001'')','22023','non-numeric quantity rejected');
select test.denied('select public.set_checkout_items(''' || test.tok('g1') || ''',''[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1},{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1}]'',''step2-client-0001'')','22023','duplicate line rejected');
select test.denied('select public.set_checkout_items(''' || test.tok('g1') || ''',''[{"variant_id":"not-a-uuid","quantity":1}]'',''step2-client-0001'')','22023','invalid product UUID rejected');
select test.denied('select public.set_checkout_items(''' || test.tok('g1') || ''',''[{"variant_id":"e2000000-0000-4000-8000-00000000ffff","quantity":1}]'',''step2-client-0001'')','CK001','unknown product UUID rejected');
select test.denied('select public.set_checkout_items(''' || test.tok('g1') || ''',''[{"variant_id":"e2000000-0000-4000-8000-000000000004","quantity":1}]'',''step2-client-0001'')','CK001','published non-thrift product (known UUID) rejected');
select test.denied('select public.set_checkout_items(''' || test.tok('g1') || ''',''[{"variant_id":"e2000000-0000-4000-8000-000000000003","quantity":1}]'',''step2-client-0001'')','CK001','unpublished product (known UUID) rejected');
select test.denied('select public.set_checkout_items(''' || test.tok('g1') || ''',''[{"variant_id":"e2000000-0000-4000-8000-000000000005","quantity":1}]'',''step2-client-0001'')','CK001','sold-out product rejected at checkout');
-- Client-supplied prices, totals, coupons and product ids are never read.
select test.assert_true((public.set_checkout_items(test.tok('g1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1,"unit_price_minor":1,"price":1,"line_total_minor":1,"total":1,"coupon":"WELCOME10","product_id":"x"}]','step2-client-0001')->>'subtotal_minor')::bigint=120000,'manipulated client price, total and coupon are ignored');
select test.denied('select public.place_checkout_order(''' || test.tok('g1') || ''',''{"division":"Atlantis","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}'',''cod'',null,''step2-client-0001'',null)','CK007','unknown division rejected');
select test.denied('select public.place_checkout_order(''' || test.tok('g1') || ''',''{"division":"Sylhet","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}'',''cod'',null,''step2-client-0001'',null)','CK007','district that belongs to another division rejected (invalid combination)');
select test.denied('select public.place_checkout_order(''' || test.tok('g1') || ''',''{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"short"}'',''cod'',null,''step2-client-0001'',null)','22023','incomplete address rejected');
select test.denied('select public.place_checkout_order(''' || test.tok('g1') || ''',''{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}'',''online'',null,''step2-client-0001'',null)','22023','payment method other than COD rejected');
insert into test.tokens select 'r1', (public.place_checkout_order(test.tok('g1'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2","total_minor":1,"subtotal_minor":1,"discount_minor":999999}','cod','Call before delivery','step2-client-0001',
  '[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1}]'))::text;
select test.assert_true((test.tok('r1')::jsonb->>'total_minor')::bigint=128000 and (test.tok('r1')::jsonb->>'subtotal_minor')::bigint=120000 and (test.tok('r1')::jsonb->>'delivery_charge_minor')::bigint=8000 and (test.tok('r1')::jsonb->>'already_placed')::boolean=false,'guest order: authoritative intake price, inside-Dhaka delivery, manipulated totals ignored');

-- Duplicate submission straight after: the original order, nothing new.
select test.assert_true((public.place_checkout_order(test.tok('g1'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null,'step2-client-0001','[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1}]')->>'order_id')=(test.tok('r1')::jsonb->>'order_id'),'immediate retry returns the original order');
-- A retry with a different cart is refused, so the server can start a new checkout.
select test.denied('select public.place_checkout_order(''' || test.tok('g1') || ''',''{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}'',''cod'',null,''step2-client-0001'',''[{"variant_id":"e2000000-0000-4000-8000-000000000002","quantity":1}]'')','CK004','retry with different items is refused');
-- Delayed retry: the placement is backdated by two hours, with triggers suspended for this test only.
reset role;
set local session_replication_role = replica;
update public.orders set placed_at = now() - interval '2 hours' where id = (test.tok('r1')::jsonb->>'order_id')::uuid;
set local session_replication_role = origin;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select test.assert_true((public.place_checkout_order(test.tok('g1'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null,'step2-client-0001','[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1}]')->>'order_id')=(test.tok('r1')::jsonb->>'order_id'),'delayed retry two hours later returns the original order');
select test.denied('select public.set_checkout_items(''' || test.tok('g1') || ''',''[]'',''step2-client-0001'')','22023','items frozen once the order exists');
select test.denied('select public.update_checkout_contact(''' || test.tok('g1') || ''',''Someone Else'',''01799999999'',null,''step2-client-0001'')','22023','contact frozen once the order exists');
reset role;
select test.assert_true((select count(*)=1 from public.orders),'exactly one order after all retries');
select test.assert_true((select customer_name='Nasrin Akter' and phone='01712345678' and email='guest@example.test' and user_id is null and status='pending' and payment_status='unpaid' and payment_method='cod' and discount_minor=0 and district='Dhaka' and note='Call before delivery' and checkout_session_id=(select id from public.checkout_sessions where token_hash=test.h(test.tok('g1'))) from public.orders),'order stores normalised phone, contact, address, pending/unpaid/COD, and its checkout session');
select test.assert_true((select count(*)=1 and bool_and(product_name='Thrift Oxford' and sku='AA-SHIRT-901' and size='M' and color='White' and unit_price_minor=120000 and quantity=1 and line_total_minor=120000) from public.order_items),'one order item with full snapshot');
select test.assert_true((select on_hand=0 from public.inventory where variant_id='e2000000-0000-4000-8000-000000000001'),'stock 1 -> 0 exactly once despite retries');
select test.assert_true((select count(*)=1 and bool_and(delta=-1 and on_hand_after=0 and actual_id) from (select delta, on_hand_after, actor_id is null as actual_id from public.inventory_movements where variant_id='e2000000-0000-4000-8000-000000000001') m),'one inventory ledger row for the order');
select test.assert_true((select stock_quantity=0 from public.thrift_intake where source_id='AA-SHIRT-901'),'storefront intake stock follows the sale');
select test.assert_true((select lifecycle_status='completed' and recovery_status='pending' and abandoned_at is null and order_id=(test.tok('r1')::jsonb->>'order_id')::uuid from public.checkout_sessions where token_hash=test.h(test.tok('g1'))),'active checkout -> completed, linked, recovery stays pending');
select test.assert_true((select count(*)=1 from private.customer_order_numbers n join public.orders o on o.id=n.order_id and o.order_number=n.customer_number),'order number recorded in the private ledger');
update public.products set name='Renamed Oxford' where id='b2000000-0000-4000-8000-000000000001';
select test.assert_true((select product_name='Thrift Oxford' from public.order_items),'historical order item keeps the name it was sold under');
update public.products set name='Thrift Oxford' where id='b2000000-0000-4000-8000-000000000001';

-- Sold out: the product is no longer orderable for anyone.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into test.tokens select 'g2', public.start_checkout_session('Late Buyer','01511111111',null,'step2-client-0002')->>'token';
select test.denied('select public.set_checkout_items(''' || test.tok('g2') || ''',''[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1}]'',''step2-client-0002'')','CK001','sold-out garment cannot be added by a later buyer');

-- ------------------------------------------------------------------ multi-item order and free delivery
insert into test.tokens select 'g3', public.start_checkout_session('Rahim Uddin','01811111111',null,'step2-client-0003')->>'token';
select public.set_checkout_items(test.tok('g3'),'[{"variant_id":"e2000000-0000-4000-8000-000000000007","quantity":1},{"variant_id":"e2000000-0000-4000-8000-000000000008","quantity":1},{"variant_id":"e2000000-0000-4000-8000-000000000009","quantity":1}]','step2-client-0003');
insert into test.tokens select 'r3', (public.place_checkout_order(test.tok('g3'),'{"division":"Chattogram","district":"Chattogram","area":"Pahartali","address_line":"House 9, Lane 4"}','cod',null,'step2-client-0003',null))::text;
select test.assert_true((test.tok('r3')::jsonb->>'subtotal_minor')::bigint=210000 and (test.tok('r3')::jsonb->>'delivery_charge_minor')::bigint=0 and (test.tok('r3')::jsonb->>'total_minor')::bigint=210000,'multi-item order above the threshold: free delivery, server total');
reset role;
select test.assert_true((select bool_and(on_hand=0) from public.inventory where variant_id in ('e2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000008','e2000000-0000-4000-8000-000000000009')),'each garment in a multi-item order decremented once');

-- ------------------------------------------------------------------ insufficient stock rolls back the whole order
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into test.tokens select 'g4', public.start_checkout_session('Karim Mia','01911111111',null,'step2-client-0004')->>'token';
select public.set_checkout_items(test.tok('g4'),'[{"variant_id":"e2000000-0000-4000-8000-000000000010","quantity":1},{"variant_id":"e2000000-0000-4000-8000-000000000011","quantity":1}]','step2-client-0004');
reset role;
-- Another buyer takes the last unit of the second garment between the checkout and the order.
update public.inventory set on_hand = 0 where variant_id='e2000000-0000-4000-8000-000000000011';
update public.thrift_intake set stock_quantity = 0 where source_id='AA-SHIRT-911';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select test.denied('select public.place_checkout_order(''' || test.tok('g4') || ''',''{"division":"Dhaka","district":"Gazipur","area":"Tongi","address_line":"House 3, Block B"}'',''cod'',null,''step2-client-0004'',null)','CK001','order with a no-longer-available item rejected');
reset role;
select test.assert_true((select count(*)=2 from public.orders) and (select count(*)=4 from public.order_items),'failed order left no order and no order items');
select test.assert_true((select on_hand=1 from public.inventory where variant_id='e2000000-0000-4000-8000-000000000010'),'whole order rolled back: the in-stock garment was not decremented');
select test.assert_true((select lifecycle_status='active' and order_id is null from public.checkout_sessions where token_hash=test.h(test.tok('g4'))),'checkout stays active after a rejected order');
select test.assert_true((select count(*)>=1 from public.inventory where on_hand<0)=false,'stock is never negative');

-- ------------------------------------------------------------------ authenticated customer checkout
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
insert into test.tokens select 'c1', public.start_checkout_session('Signed In Customer','01311111111',null,'ignored-for-customers')->>'token';
select public.set_checkout_items(test.tok('c1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000013","quantity":1}]','ignored-for-customers');
insert into test.tokens select 'rc', (public.place_checkout_order(test.tok('c1'),'{"division":"Khulna","district":"Khulna","area":"Sonadanga","address_line":"House 2, Road 8"}','cod',null,'ignored-for-customers',null))::text;
select test.assert_true((test.tok('rc')::jsonb->>'total_minor')::bigint=58000,'authenticated order priced server-side: 45000 garment + 13000 outside Dhaka');
select test.assert_true((select count(*)=1 from public.orders where user_id='a2000000-0000-4000-8000-000000000003'),'authenticated order is linked to the customer');
select test.assert_true((select count(*)=1 from public.orders) and (select count(*)=1 from public.order_items),'customer sees only their own order and its items');
select test.denied($q$update public.orders set status='delivered'$q$,'42501','customer cannot change an order');
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select test.assert_true((select count(*)=0 from public.orders) and (select count(*)=0 from public.order_items),'another customer sees no orders');
reset role;

-- ------------------------------------------------------------------ abandonment after contact capture, then recovery
insert into public.checkout_sessions(id,token_hash,customer_name,phone,started_at,last_activity_at,expires_at) values
 ('d2000000-0000-4000-8000-000000000001',test.h(repeat('1',64)),'Pending Guest','01700000001',now()-interval '45 minutes',now()-interval '45 minutes',now()+interval '6 days');
insert into test.tokens values ('ab1',repeat('1',64));
insert into public.checkout_items(checkout_session_id,product_id,variant_id,quantity,regular_price_minor,unit_price_minor,price_snapshot_at)
 values('d2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000012','e2000000-0000-4000-8000-000000000012',1,30000,30000,now());
insert into public.checkout_sessions(id,token_hash,customer_name,phone,started_at,last_activity_at,expires_at) values
 ('d2000000-0000-4000-8000-000000000002',test.h(repeat('2',64)),'Contact Only Guest','01700000002',now()-interval '45 minutes',now()-interval '45 minutes',now()+interval '6 days');
select test.assert_true(private.mark_abandoned_checkout_sessions()=1,'only the session with a cart and 45 idle minutes is abandoned; the contact-only session is untouched');
select test.assert_true((select lifecycle_status='abandoned' and abandoned_at is not null from public.checkout_sessions where id='d2000000-0000-4000-8000-000000000001'),'abandoned session has abandoned_at set');
select test.assert_true((select lifecycle_status='active' from public.checkout_sessions where id='d2000000-0000-4000-8000-000000000002'),'contact-only session is not recoverable and stays active');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select test.assert_true((select public.checkout_session_status(repeat('1',64))->>'lifecycle_status')='abandoned','abandoned checkout still returns through its valid credential');
select public.update_checkout_contact(test.tok('ab1'),'Pending Guest','01700000011',null,'step2-client-0005');
create temp table recovered_order as select public.place_checkout_order(test.tok('ab1'),'{"division":"Dhaka","district":"Dhaka","area":"Mirpur","address_line":"House 7, Road 3"}','cod',null,'step2-client-0005',null) as r;
reset role;
select test.assert_true((select (r->>'order_id') is not null from recovered_order) and (select phone='01700000011' from public.orders where id=((select r from recovered_order)->>'order_id')::uuid),'abandoned checkout: contact corrected, then ordered');
select test.assert_true((select lifecycle_status='completed' and recovery_status='recovered' and recovered_at is not null and abandoned_at is not null from public.checkout_sessions where id='d2000000-0000-4000-8000-000000000001'),'abandoned -> order -> recovered, abandoned_at preserved');
select test.assert_true((select previous_recovery_status='pending' and change_source='automatic' and changed_by is null from public.abandoned_recovery_log where checkout_session_id='d2000000-0000-4000-8000-000000000001' and new_recovery_status='recovered'),'pending -> recovered logged automatically');

-- ------------------------------------------------------------------ forged and expired credentials
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select test.denied('select public.place_checkout_order(''ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'',''{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}'',''cod'',null,''step2-client-0006'',null)','22023','forged token rejected');
select test.denied('select public.place_checkout_order(''d2000000-0000-4000-8000-000000000009'',''{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}'',''cod'',null,''step2-client-0006'',null)','22023','session UUID is not a credential');
select test.denied('select public.place_checkout_order(null,''{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}'',''cod'',null,''step2-client-0006'',null)','22023','missing token rejected');
select test.denied('select public.place_checkout_order(''' || test.tok('expired') || ''',''{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}'',''cod'',null,''step2-client-0006'',null)','22023','expired token rejected');
select test.denied('select public.set_checkout_items(''' || test.tok('expired') || ''',''[]'',''step2-client-0006'')','22023','expired token cannot edit items');
reset role;
select test.denied($q$select public.admin_set_order_status(gen_random_uuid(),now(),'confirmed')$q$,'42501','unauthenticated admin order change refused');

-- ------------------------------------------------------------------ order immutability and history
select test.denied($q$update public.orders set total_minor=1, subtotal_minor=1, delivery_charge_minor=0$q$,'22023','order totals are immutable');
select test.denied($q$update public.orders set phone='01700000000'$q$,'22023','order contact is immutable');
select test.denied($q$update public.orders set order_number=order_number+1$q$,'22023','order number is immutable');
select test.denied($q$delete from public.orders$q$,'42501','orders cannot be deleted');
select test.denied($q$update public.order_items set unit_price_minor=1, line_total_minor=quantity$q$,'42501','order items cannot be edited');
select test.denied($q$delete from public.order_items$q$,'42501','order items cannot be deleted');
select test.assert_true((select bool_and(o.total_minor=o.subtotal_minor-o.discount_minor+o.delivery_charge_minor and o.subtotal_minor=(select sum(line_total_minor) from public.order_items i where i.order_id=o.id)) from public.orders o),'every order total equals its items plus delivery');

select 'ALL CHECKS EXECUTED; rolling back' as result;
rollback;
