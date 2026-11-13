-- LOCAL TEST ONLY for supabase/migrations/20261113000200_order_domain_atomic_checkout.sql.
-- Run on a disposable database after bootstrap.sql and ALL repository migrations. Rolls back.
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
create table test.tokens(k text primary key, t text not null);
create table test.results(k text primary key, r jsonb not null);
create function test.res(key text) returns jsonb language sql stable as $$select r from test.results where k = key$$;
create function test.tok(key text) returns text language sql stable as $$select t from test.tokens where k = key$$;
create function test.h(raw text) returns text language sql immutable as $$select encode(sha256(convert_to(raw,'UTF8')),'hex')$$;
grant all on test.tokens, test.results to anon, authenticated;
grant execute on all functions in schema test to anon, authenticated;

-- ------------------------------------------------------------------ fixtures (superuser)
-- Disposable database only: an earlier regression test exhausts this non-transactional sequence.
select setval('private.customer_order_number_sequence', 10000, false);
insert into auth.users(id,email,is_anonymous) values
 ('a2000000-0000-4000-8000-000000000001','owner@example.test',false),
 ('a2000000-0000-4000-8000-000000000002','analyst@example.test',false),
 ('a2000000-0000-4000-8000-000000000003','customer@example.test',false),
 ('a2000000-0000-4000-8000-000000000004','other@example.test',false);
insert into public.user_roles(user_id,role) values
 ('a2000000-0000-4000-8000-000000000001','owner'),('a2000000-0000-4000-8000-000000000002','analyst');
insert into public.categories(id,name,slug,published) values ('c2000000-0000-4000-8000-000000000001','Shirts','shirts',true);
insert into public.products(id,category_id,name,slug,description,status) values
 ('b2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Oxford Shirt','oxford-shirt','Cotton.','published'),
 ('b2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','Polo Shirt','polo-shirt','Pique.','published'),
 ('b2000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000001','Draft Shirt','draft-shirt','Hidden.','draft'),
 ('b2000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000001','Thrift Shirt','aa-shirt-902','One garment.','draft'),
 ('b2000000-0000-4000-8000-000000000005','c2000000-0000-4000-8000-000000000001','Basic Tee','basic-tee','Jersey.','published');
insert into public.product_variants(id,product_id,sku,size,color,price_minor,sale_price_minor,active) values
 ('e2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','OX-M-WHT','M','White',150000,120000,true),
 ('e2000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','PO-M-NVY','M','Navy',90000,null,true),
 ('e2000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000003','DR-M-BLU','M','Blue',100000,null,true),
 ('e2000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000004','AA-SHIRT-902','L','Blue',0,null,true),
 ('e2000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000005','TEE-M-BLK','M','Black',50000,null,true);
insert into public.inventory(variant_id,on_hand) values
 ('e2000000-0000-4000-8000-000000000001',5),('e2000000-0000-4000-8000-000000000002',1),
 ('e2000000-0000-4000-8000-000000000003',5),('e2000000-0000-4000-8000-000000000004',1),
 ('e2000000-0000-4000-8000-000000000005',10);
insert into public.thrift_intake(source_id,product_id,image_path,image_sha256,price_minor,stock_quantity,actual_size,actual_color,size_verified,details_verified)
 values('AA-SHIRT-902','b2000000-0000-4000-8000-000000000004','/inventory/thrift-shirts/AA-SHIRT-902-front.jpg',repeat('b',64),70000,1,'L','Blue',true,true);
update public.products set status='published' where id='b2000000-0000-4000-8000-000000000004';

-- Directly inserted sessions with known tokens, for time-dependent cases.
insert into test.tokens values ('expired',repeat('e',64)),('ab1',repeat('1',64)),('ab2',repeat('2',64)),('ab3',repeat('3',64)),
 ('recent',repeat('4',64)),('noitems',repeat('5',64));
insert into public.checkout_sessions(id,token_hash,customer_name,phone,started_at,last_activity_at,expires_at) values
 ('d2000000-0000-4000-8000-000000000009',test.h(repeat('e',64)),'Expired Guest','01700000009',now()-interval '8 days',now()-interval '8 days',now()-interval '1 day'),
 ('d2000000-0000-4000-8000-000000000001',test.h(repeat('1',64)),'Pending Guest','01700000001',now()-interval '45 minutes',now()-interval '45 minutes',now()+interval '6 days'),
 ('d2000000-0000-4000-8000-000000000002',test.h(repeat('2',64)),'Contacted Guest','01700000002',now()-interval '45 minutes',now()-interval '45 minutes',now()+interval '6 days'),
 ('d2000000-0000-4000-8000-000000000003',test.h(repeat('3',64)),'Lost Guest','01700000003',now()-interval '45 minutes',now()-interval '45 minutes',now()+interval '6 days'),
 ('d2000000-0000-4000-8000-000000000004',test.h(repeat('4',64)),'Recent Guest','01700000004',now()-interval '20 minutes',now()-interval '20 minutes',now()+interval '6 days'),
 ('d2000000-0000-4000-8000-000000000005',test.h(repeat('5',64)),'Browsing Guest','01700000005',now()-interval '45 minutes',now()-interval '45 minutes',now()+interval '6 days');
insert into public.checkout_items(checkout_session_id,product_id,variant_id,quantity,regular_price_minor,unit_price_minor,price_snapshot_at)
 select s.id,'b2000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000005',1,50000,50000,now()
 from public.checkout_sessions s where s.id in ('d2000000-0000-4000-8000-000000000009','d2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000004');

-- ------------------------------------------------------------------ schema / security facts
select test.assert_true((select abandon_after = interval '30 minutes' and session_ttl = interval '7 days' from private.checkout_settings),'settings: 30 minute abandonment, 7 day credential');
select test.assert_true((select bool_and(relrowsecurity) from pg_class where oid in ('public.orders'::regclass,'public.order_items'::regclass,'private.checkout_settings'::regclass)),'RLS enabled on orders, order_items, settings');
select test.assert_true(not has_table_privilege('anon','public.orders','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon','public.order_items','SELECT,INSERT,UPDATE,DELETE'),'anon has no table privilege on orders or order_items');
select test.assert_true(not has_table_privilege('authenticated','public.orders','INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated','public.order_items','INSERT,UPDATE,DELETE'),'authenticated cannot write orders or order_items directly');
select test.assert_true(not has_table_privilege('anon','private.checkout_settings','SELECT') and not has_table_privilege('authenticated','private.checkout_settings','SELECT,UPDATE'),'settings not readable or writable by API roles');
select test.assert_true(has_function_privilege('anon','public.place_checkout_order(text,jsonb,text,text)','EXECUTE') and has_function_privilege('anon','public.set_checkout_items(text,jsonb)','EXECUTE') and has_function_privilege('anon','public.update_checkout_contact(text,text,text,text)','EXECUTE'),'guest token functions executable by anon');
select test.assert_true(not has_function_privilege('anon','public.admin_set_order_status(uuid,timestamptz,text)','EXECUTE') and not has_function_privilege('anon','private.orderable_variant(uuid)','EXECUTE') and not has_function_privilege('authenticated','private.orderable_variant(uuid)','EXECUTE') and not has_function_privilege('authenticated','private.mark_abandoned_checkout_sessions(interval)','EXECUTE'),'admin and internal functions not executable by guests');
select test.assert_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef and p.proname in ('place_checkout_order','set_checkout_items','update_checkout_contact','start_checkout_session','add_checkout_item','admin_set_order_status','orderable_variant','mark_abandoned_checkout_sessions') and (p.proconfig is null or array_to_string(p.proconfig,',') not like '%search_path=%')),'every SECURITY DEFINER function has a fixed search_path');
select test.assert_true((select count(*)=2 from pg_constraint where conname in ('checkout_sessions_order_id_fkey','customer_order_numbers_order_id_fkey') and contype='f'),'checkout session and order number ledger now reference orders');

-- ------------------------------------------------------------------ guest order (active -> completed)
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
insert into test.tokens select 'g1', public.start_checkout_session('  Nasrin Akter ','+880 1712-345678','Guest@Example.TEST')->>'token';
select test.denied($q$select public.place_checkout_order(test.tok('g1'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null)$q$,'CK003','empty checkout rejected');
select test.denied($q$select public.set_checkout_items(test.tok('g1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":0}]')$q$,'22023','quantity 0 rejected');
select test.denied($q$select public.set_checkout_items(test.tok('g1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":100}]')$q$,'22023','quantity 100 rejected');
select test.denied($q$select public.set_checkout_items(test.tok('g1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":"2; drop"}]')$q$,'22023','non-numeric quantity rejected');
select test.denied($q$select public.set_checkout_items(test.tok('g1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":-1}]')$q$,'22023','negative quantity rejected');
select test.denied($q$select public.set_checkout_items(test.tok('g1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1},{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1}]')$q$,'22023','duplicate line rejected');
select test.denied($q$select public.set_checkout_items(test.tok('g1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000003","quantity":1}]')$q$,'CK001','unpublished product cannot be added');
select test.denied($q$select public.set_checkout_items(test.tok('g1'),'[{"variant_id":"e2000000-0000-4000-8000-00000000ffff","quantity":1}]')$q$,'CK001','unknown variant cannot be added');
select test.denied($q$select public.set_checkout_items(test.tok('g1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000004","quantity":2}]')$q$,'CK001','thrift garment quantity above 1 rejected');
-- Manipulated client price/total fields are simply never read.
select test.assert_true((public.set_checkout_items(test.tok('g1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1,"unit_price_minor":1,"price":1,"line_total_minor":1}]')->>'subtotal_minor')::bigint=120000,'manipulated client price ignored when items are saved');
select test.denied($q$select public.place_checkout_order(test.tok('g1'),'{"division":"Atlantis","district":"Dhaka","area":"X","address_line":"House 1, Road 2"}','cod',null)$q$,'22023','unknown division rejected');
select test.denied($q$select public.place_checkout_order(test.tok('g1'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"short"}','cod',null)$q$,'22023','incomplete address rejected');
select test.denied($q$select public.place_checkout_order(test.tok('g1'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','online',null)$q$,'22023','payment method other than COD rejected');
insert into test.results select 'r1', public.place_checkout_order(test.tok('g1'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2","total_minor":1,"subtotal_minor":1,"delivery_charge_minor":0,"discount_minor":999999}','cod','Call before delivery');
select test.assert_true((select (r->>'total_minor')::bigint=128000 and (r->>'subtotal_minor')::bigint=120000 and (r->>'delivery_charge_minor')::bigint=8000 and (r->>'already_placed')::boolean=false and (r->>'order_number')::int between 10000 and 99999 from test.results where k='r1'),'guest order: authoritative sale price, inside-Dhaka delivery, manipulated totals ignored');
-- The deferred order-number check fires at COMMIT as the guest role; force it now, as anon.
set constraints all immediate;
set constraints all deferred;
select test.assert_true(true,'deferred order-number check passes when fired as the guest role');
-- Duplicate submission.
insert into test.results select 'r1b', public.place_checkout_order(test.tok('g1'),'{"division":"Sylhet","district":"Sylhet","area":"Other","address_line":"A different address"}','cod',null);
select test.assert_true(test.res('r1b')->>'order_id'=test.res('r1')->>'order_id' and (test.res('r1b')->>'already_placed')::boolean and (test.res('r1b')->>'total_minor')::bigint=128000,'duplicate submission returns the same order unchanged');
select test.assert_true(test.res('r1b')->'items'='[{"quantity": 1, "variant_id": "e2000000-0000-4000-8000-000000000001"}]'::jsonb and (test.res('r1b')->>'placed_at')::timestamptz=(test.res('r1')->>'placed_at')::timestamptz,'duplicate result carries the original items and placement time');
select test.denied($q$select public.set_checkout_items(test.tok('g1'),'[]')$q$,'22023','items frozen after the order exists');
select test.denied($q$select public.update_checkout_contact(test.tok('g1'),'Someone Else','01799999999',null)$q$,'22023','contact frozen after the order exists');
select test.denied($q$select count(*) from public.orders$q$,'42501','anon cannot read orders directly');
select test.denied($q$select count(*) from public.order_items$q$,'42501','anon cannot read order items directly');
select test.denied($q$update public.inventory set on_hand=999$q$,'42501','anon cannot touch inventory');
reset role;
select test.assert_true((select count(*)=1 from public.orders),'exactly one order after duplicate submission');
select test.assert_true((select customer_name='Nasrin Akter' and phone='01712345678' and email='guest@example.test' and user_id is null and status='pending' and payment_status='unpaid' and payment_method='cod' and discount_minor=0 and district='Dhaka' and note='Call before delivery' from public.orders),'order stores normalised phone, contact, address, pending/unpaid/COD');
select test.assert_true((select count(*)=1 and bool_and(product_name='Oxford Shirt' and sku='OX-M-WHT' and size='M' and color='White' and unit_price_minor=120000 and quantity=1 and line_total_minor=120000) from public.order_items),'one order item with full snapshot');
select test.assert_true((select on_hand=4 from public.inventory where variant_id='e2000000-0000-4000-8000-000000000001'),'stock decremented exactly once (5 -> 4) despite duplicate submission');
select test.assert_true((select count(*)=1 and bool_and(delta=-1 and on_hand_after=4 and actor_id is null and reason like 'Order %') from public.inventory_movements where variant_id='e2000000-0000-4000-8000-000000000001'),'one inventory ledger row for the order');
select test.assert_true((select s.lifecycle_status='completed' and s.recovery_status='pending' and s.abandoned_at is null and s.recovered_at is null and s.order_id=o.id from public.checkout_sessions s, public.orders o where s.token_hash=test.h(test.tok('g1'))),'active checkout -> completed, linked, recovery stays pending');
select test.assert_true((select count(*)=0 from public.abandoned_recovery_log),'no recovery log for a normal order');
select test.assert_true((select count(*)=1 from private.customer_order_numbers n join public.orders o on o.id=n.order_id and o.order_number=n.customer_number),'order number recorded in the existing private ledger');
update public.products set name='Renamed Oxford' where id='b2000000-0000-4000-8000-000000000001';
select test.assert_true((select product_name='Oxford Shirt' from public.order_items),'historical order item keeps the name it was sold under');

-- ------------------------------------------------------------------ free delivery, stock 1 -> 0
set local role anon;
insert into test.tokens select 'g2', public.start_checkout_session('Rahim Uddin','01811111111',null)->>'token';
select public.set_checkout_items(test.tok('g2'),'[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":2},{"variant_id":"e2000000-0000-4000-8000-000000000002","quantity":1}]');
insert into test.results select 'r2', public.place_checkout_order(test.tok('g2'),'{"division":"Chattogram","district":"Chattogram","area":"Pahartali","address_line":"House 9, Lane 4"}','cod',null);
select test.assert_true((select (r->>'subtotal_minor')::bigint=330000 and (r->>'delivery_charge_minor')::bigint=0 and (r->>'total_minor')::bigint=330000 from test.results where k='r2'),'two-line order: regular price where no sale, free delivery above threshold');
reset role;
select test.assert_true((select on_hand=0 and available=0 from public.inventory where variant_id='e2000000-0000-4000-8000-000000000002'),'stock 1 -> 0');
select test.assert_true((select on_hand=2 from public.inventory where variant_id='e2000000-0000-4000-8000-000000000001'),'multi-quantity decrement (4 -> 2)');

-- ------------------------------------------------------------------ insufficient stock, rollback, never negative
set local role anon;
insert into test.tokens select 'g3', public.start_checkout_session('Karim Mia','01911111111',null)->>'token';
select public.set_checkout_items(test.tok('g3'),'[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1},{"variant_id":"e2000000-0000-4000-8000-000000000002","quantity":1}]');
select test.denied($q$select public.place_checkout_order(test.tok('g3'),'{"division":"Dhaka","district":"Gazipur","area":"Tongi","address_line":"House 3, Block B"}','cod',null)$q$,'CK002','order with one sold-out item rejected');
reset role;
select test.assert_true((select count(*)=2 from public.orders) and (select count(*)=3 from public.order_items),'failed order left no order and no order items');
select test.assert_true((select on_hand=2 from public.inventory where variant_id='e2000000-0000-4000-8000-000000000001') and (select on_hand=0 from public.inventory where variant_id='e2000000-0000-4000-8000-000000000002'),'whole order rolled back: the in-stock line was not decremented');
select test.assert_true((select lifecycle_status='active' and order_id is null from public.checkout_sessions where token_hash=test.h(test.tok('g3'))),'checkout stays active after a rejected order');
set local role anon;
select public.set_checkout_items(test.tok('g3'),'[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":3}]');
select test.denied($q$select public.place_checkout_order(test.tok('g3'),'{"division":"Dhaka","district":"Gazipur","area":"Tongi","address_line":"House 3, Block B"}','cod',null)$q$,'CK002','quantity above available stock rejected');
reset role;
select test.assert_true((select on_hand=2 from public.inventory where variant_id='e2000000-0000-4000-8000-000000000001') and not exists(select 1 from public.inventory where on_hand<0),'stock never negative');

-- ------------------------------------------------------------------ authoritative CURRENT price and availability
set local role anon;
select public.set_checkout_items(test.tok('g3'),'[{"variant_id":"e2000000-0000-4000-8000-000000000001","quantity":1}]');
reset role;
update public.product_variants set sale_price_minor=100000 where id='e2000000-0000-4000-8000-000000000001';
update public.products set status='draft' where id='b2000000-0000-4000-8000-000000000001';
set local role anon;
select test.denied($q$select public.place_checkout_order(test.tok('g3'),'{"division":"Dhaka","district":"Gazipur","area":"Tongi","address_line":"House 3, Block B"}','cod',null)$q$,'CK001','product unpublished after being added: order rejected');
reset role;
update public.products set status='published' where id='b2000000-0000-4000-8000-000000000001';
set local role anon;
insert into test.results select 'r3', public.place_checkout_order(test.tok('g3'),'{"division":"Dhaka","district":"Gazipur","area":"Tongi","address_line":"House 3, Block B"}','cod',null);
select test.assert_true((select (r->>'subtotal_minor')::bigint=100000 and (r->>'delivery_charge_minor')::bigint=13000 and (r->>'total_minor')::bigint=113000 from test.results where k='r3'),'price changed after add: order uses the current price; outside-Dhaka delivery');

-- ------------------------------------------------------------------ thrift garment (priced by intake, single unit)
insert into test.tokens select 'g4', public.start_checkout_session('Salma Khatun','01611111111',null)->>'token';
select public.set_checkout_items(test.tok('g4'),'[{"variant_id":"e2000000-0000-4000-8000-000000000004","quantity":1}]');
insert into test.results select 'r4', public.place_checkout_order(test.tok('g4'),'{"division":"Sylhet","district":"Sylhet","area":"Zindabazar","address_line":"House 5, Road 1"}','cod',null);
select test.assert_true((select (r->>'subtotal_minor')::bigint=70000 and (r->>'total_minor')::bigint=83000 from test.results where k='r4'),'thrift garment priced from intake record, not the zero variant price');
insert into test.tokens select 'g5', public.start_checkout_session('Late Buyer','01511111111',null)->>'token';
select test.denied($q$select public.set_checkout_items(test.tok('g5'),'[{"variant_id":"e2000000-0000-4000-8000-000000000004","quantity":1}]')$q$,'CK001','sold thrift garment can no longer be added');
select test.assert_true((select (g->>'in_stock')::boolean=false from jsonb_array_elements(public.published_thrift_catalogue()) g where g->>'slug'='aa-shirt-902'),'storefront catalogue now reports the sold garment as out of stock');
reset role;
select test.assert_true((select on_hand=0 from public.inventory where variant_id='e2000000-0000-4000-8000-000000000004') and (select stock_quantity=0 and size_verified and details_verified from public.thrift_intake where source_id='AA-SHIRT-902') and (select status='published' from public.products where id='b2000000-0000-4000-8000-000000000004'),'thrift stock 1 -> 0 in inventory and intake; verification and publication untouched');

-- ------------------------------------------------------------------ forged / expired credentials
set local role anon;
select test.denied($q$select public.place_checkout_order(repeat('f',64),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null)$q$,'22023','forged token rejected');
select test.denied($q$select public.place_checkout_order('d2000000-0000-4000-8000-000000000001','{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null)$q$,'22023','session UUID is not a credential');
select test.denied($q$select public.place_checkout_order(null,'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null)$q$,'22023','missing token rejected');
select test.denied($q$select public.place_checkout_order(test.tok('expired'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null)$q$,'22023','expired token rejected');
select test.denied($q$select public.set_checkout_items(test.tok('expired'),'[]')$q$,'22023','expired token cannot edit items');
select test.denied($q$select public.admin_set_order_status(gen_random_uuid(),now(),'confirmed')$q$,'42501','anon cannot call the admin order RPC');

-- ------------------------------------------------------------------ abandonment (30 minutes, qualified sessions only)
reset role;
create temp table snap as select id,last_activity_at from public.checkout_sessions;
select test.assert_true(private.mark_abandoned_checkout_sessions()=4,'default threshold abandons the four qualified sessions inactive for 45 minutes or more');
select test.assert_true(private.mark_abandoned_checkout_sessions()=0,'abandonment is idempotent');
select test.assert_true((select bool_and(lifecycle_status='abandoned' and abandoned_at is not null) from public.checkout_sessions where id in ('d2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003')),'45-minute-idle checkouts with contact and items are abandoned');
select test.assert_true((select lifecycle_status='active' from public.checkout_sessions where id='d2000000-0000-4000-8000-000000000004'),'20-minute-idle checkout is not abandoned');
select test.assert_true((select lifecycle_status='active' from public.checkout_sessions where id='d2000000-0000-4000-8000-000000000005'),'session with no items (no purchase intent) is not abandoned');
select test.assert_true((select bool_and(s.last_activity_at=snap.last_activity_at) from public.checkout_sessions s join snap using(id)),'abandonment never changes last_activity_at');
select test.assert_true((select bool_and(lifecycle_status='completed' and abandoned_at is null) from public.checkout_sessions where order_id is not null),'completed sessions are never abandoned');

-- contacted / lost via the Step 1 staff workflow
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select public.admin_set_checkout_recovery_status('d2000000-0000-4000-8000-000000000002',(select updated_at from public.checkout_sessions where id='d2000000-0000-4000-8000-000000000002'),'contacted','Called the guest');
select public.admin_set_checkout_recovery_status('d2000000-0000-4000-8000-000000000003',(select updated_at from public.checkout_sessions where id='d2000000-0000-4000-8000-000000000003'),'lost','No answer after three calls');

-- returning guests complete their abandoned checkouts
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select public.update_checkout_contact(test.tok('ab1'),'Pending Guest','01700000011',null);
select public.set_checkout_items(test.tok('ab1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000005","quantity":2}]');
insert into test.results select 'ra1', public.place_checkout_order(test.tok('ab1'),'{"division":"Dhaka","district":"Dhaka","area":"Mirpur","address_line":"House 7, Road 3"}','cod',null);
insert into test.results select 'ra2', public.place_checkout_order(test.tok('ab2'),'{"division":"Dhaka","district":"Dhaka","area":"Mirpur","address_line":"House 7, Road 3"}','cod',null);
insert into test.results select 'ra3', public.place_checkout_order(test.tok('ab3'),'{"division":"Dhaka","district":"Dhaka","area":"Mirpur","address_line":"House 7, Road 3"}','cod',null);
reset role;
select test.assert_true((select (r->>'total_minor')::bigint=108000 from test.results where k='ra1') and (select phone='01700000011' from public.orders where id=(select (r->>'order_id')::uuid from test.results where k='ra1')),'abandoned checkout: contact corrected and items updated before ordering');
select test.assert_true((select bool_and(lifecycle_status='completed' and recovery_status='recovered' and recovered_at is not null and abandoned_at is not null and order_id is not null) from public.checkout_sessions where id in ('d2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003')),'abandoned -> order -> recovered, abandoned_at preserved');
select test.assert_true((select previous_recovery_status='pending' and change_source='automatic' and changed_by is null from public.abandoned_recovery_log where checkout_session_id='d2000000-0000-4000-8000-000000000001' and new_recovery_status='recovered'),'pending -> recovered logged automatically');
select test.assert_true((select previous_recovery_status='contacted' and change_source='automatic' from public.abandoned_recovery_log where checkout_session_id='d2000000-0000-4000-8000-000000000002' and new_recovery_status='recovered'),'contacted -> purchase -> recovered logged');
select test.assert_true((select previous_recovery_status='lost' and change_source='automatic' from public.abandoned_recovery_log where checkout_session_id='d2000000-0000-4000-8000-000000000003' and new_recovery_status='recovered'),'lost -> purchase -> recovered logged');
select test.assert_true((select count(*)=3 from public.abandoned_recovery_log where new_recovery_status='recovered'),'exactly one recovered entry per recovered checkout');
select test.assert_true((select on_hand=6 from public.inventory where variant_id='e2000000-0000-4000-8000-000000000005'),'recovered orders decremented stock once each (10 -> 6)');

-- ------------------------------------------------------------------ authenticated customer order
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
insert into test.tokens select 'c1', public.start_checkout_session('Signed In Customer','01311111111','customer@example.test')->>'token';
select public.set_checkout_items(test.tok('c1'),'[{"variant_id":"e2000000-0000-4000-8000-000000000005","quantity":1}]');
insert into test.results select 'rc', public.place_checkout_order(test.tok('c1'),'{"division":"Khulna","district":"Khulna","area":"Sonadanga","address_line":"House 2, Road 8"}','cod',null);
select test.assert_true((select count(*)=1 and bool_and(user_id='a2000000-0000-4000-8000-000000000003' and total_minor=63000) from public.orders),'authenticated order linked to the user; customer sees only their own order');
select test.assert_true((select count(*)=1 from public.order_items),'customer sees only their own order items');
select test.denied($q$update public.orders set status='delivered'$q$,'42501','customer cannot change an order');
select test.denied($q$select public.admin_set_order_status((select id from public.orders limit 1),now(),'confirmed')$q$,'42501','customer cannot call the admin order RPC');
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select test.assert_true((select count(*)=0 from public.orders) and (select count(*)=0 from public.order_items),'another customer sees no orders');

-- ------------------------------------------------------------------ staff
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select test.assert_true((select count(*)=8 from public.orders),'analyst with orders.read and MFA sees all eight orders');
select test.denied($q$select public.admin_set_order_status((select (r->>'order_id')::uuid from test.results where k='r1'),(select updated_at from public.orders where id=(select (r->>'order_id')::uuid from test.results where k='r1')),'confirmed')$q$,'42501','analyst cannot change order status');
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select test.denied($q$select public.admin_set_order_status((select (r->>'order_id')::uuid from test.results where k='r1'),now(),'confirmed')$q$,'42501','owner without MFA cannot change order status');
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select test.denied($q$select public.admin_set_order_status((select (r->>'order_id')::uuid from test.results where k='r1'),'2000-01-01','confirmed')$q$,'PT409','stale order version refused');
select test.denied($q$select public.admin_set_order_status((select (r->>'order_id')::uuid from test.results where k='r1'),(select updated_at from public.orders where id=(select (r->>'order_id')::uuid from test.results where k='r1')),'shipped')$q$,'22023','pending cannot jump to shipped');
select test.denied($q$select public.admin_set_order_status((select (r->>'order_id')::uuid from test.results where k='r1'),(select updated_at from public.orders where id=(select (r->>'order_id')::uuid from test.results where k='r1')),'cancelled')$q$,'0A000','cancellation refused until a restock rule exists');
select public.admin_set_order_status((select (r->>'order_id')::uuid from test.results where k='r1'),(select updated_at from public.orders where id=(select (r->>'order_id')::uuid from test.results where k='r1')),'confirmed');
reset role;
select test.assert_true((select status='confirmed' from public.orders where id=(select (r->>'order_id')::uuid from test.results where k='r1')) and (select count(*)=1 from public.admin_audit_logs where action='order.status_changed'),'owner with MFA: pending -> confirmed, audited');

-- ------------------------------------------------------------------ immutability
select test.denied($q$update public.orders set total_minor=1, subtotal_minor=1, delivery_charge_minor=0$q$,'22023','order totals are immutable');
select test.denied($q$update public.orders set phone='01700000000'$q$,'22023','order contact is immutable');
select test.denied($q$update public.orders set order_number=order_number+1$q$,'22023','order number is immutable');
select test.denied($q$delete from public.orders$q$,'42501','orders cannot be deleted');
select test.denied($q$update public.order_items set unit_price_minor=1, line_total_minor=quantity$q$,'42501','order items cannot be edited');
select test.denied($q$delete from public.order_items$q$,'42501','order items cannot be deleted');
select test.denied($q$insert into public.orders(customer_name,phone,division,district,area,address_line,payment_method,subtotal_minor,delivery_charge_minor,total_minor) values('X','01700000000','Dhaka','Dhaka','A','House 1, Road 2','cod',100,0,100); set constraints all immediate$q$,'23502','an order without an order number cannot be committed');
select test.denied($q$insert into public.orders(order_number,customer_name,phone,division,district,area,address_line,payment_method,subtotal_minor,delivery_charge_minor,total_minor) values(99999,'X','01700000000','Dhaka','Dhaka','A','House 1, Road 2','cod',100,50,100)$q$,'23514','inconsistent total rejected by constraint');
select test.assert_true((select count(*)=8 from public.orders) and (select count(distinct order_number)=8 from public.orders),'eight orders, eight distinct order numbers');
select test.assert_true((select bool_and(o.total_minor=o.subtotal_minor-o.discount_minor+o.delivery_charge_minor and o.subtotal_minor=(select sum(line_total_minor) from public.order_items i where i.order_id=o.id)) from public.orders o),'every order total equals its items plus delivery');

select 'ALL CHECKS EXECUTED; rolling back' as result;
rollback;
