-- LOCAL TEST ONLY for supabase/migrations/20261113000300_checkout_security_reliability.sql.
-- Rate limits, ordering gate, location authority, phone and unit caps, and the trust model.
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
grant all on test.tokens to service_role, authenticated, anon;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- The existing order-number regression deliberately exhausts this NON-transactional sequence; reset it (disposable DB).
select setval('private.customer_order_number_sequence', 10000, false);
-- ------------------------------------------------------------------ production stays disabled by default
select test.assert_true((select orders_enabled=false from private.checkout_settings),'ordering is disabled in the database by default');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select test.denied($q$select public.start_checkout_session('Blocked Guest','01700000001',null,'sec-client-0001')$q$,'CK008','checkout cannot start while ordering is disabled');
reset role;
-- Settings are only writable by the owner of the database (never an API role).
select test.assert_true(not has_table_privilege('service_role','private.checkout_settings','UPDATE') and not has_table_privilege('authenticated','private.checkout_settings','UPDATE'),'API roles cannot change the ordering gate');

-- Enable ordering for the rest of the suite; rate limits high unless a test lowers them.
update private.checkout_settings set orders_enabled = true, sessions_per_client_per_hour = 100000,
 writes_per_client_per_minute = 100000, orders_per_client_per_hour = 100000, orders_per_phone_per_day = 100000, max_units_per_order = 10;

-- ------------------------------------------------------------------ fixtures
insert into public.categories(id,name,slug,published) values ('c4000000-0000-4000-8000-000000000001','Shirts','shirts-sec',true);
insert into auth.users(id,email,is_anonymous) values ('a4000000-0000-4000-8000-000000000001','sec-customer@example.test',false);
do $$
declare n int;
begin
 for n in 1..6 loop
  insert into public.products(id,category_id,name,slug,description,status) values
   ((format('b4000000-0000-4000-8000-%s', lpad(n::text,12,'0')))::uuid,'c4000000-0000-4000-8000-000000000001','Thrift '||n,'aa-shirt-'||(900+n),'x','draft');
  insert into public.product_variants(id,product_id,sku,size,color,price_minor,active) values
   ((format('e4000000-0000-4000-8000-%s', lpad(n::text,12,'0')))::uuid,(format('b4000000-0000-4000-8000-%s', lpad(n::text,12,'0')))::uuid,'AA-SHIRT-'||(900+n),'M','Black',0,true);
  insert into public.inventory(variant_id,on_hand) values (format('e4000000-0000-4000-8000-%s', lpad(n::text,12,'0'))::uuid,1);
  insert into public.thrift_intake(source_id,product_id,image_path,image_sha256,price_minor,stock_quantity,actual_size,actual_color,size_verified,details_verified)
   values ('AA-SHIRT-'||(900+n), (format('b4000000-0000-4000-8000-%s', lpad(n::text,12,'0')))::uuid,
     '/inventory/thrift-shirts/AA-SHIRT-'||(900+n)||'-front.jpg', lpad(to_hex(n),2,'0') || repeat(lpad(to_hex(n),2,'0'),31), 50000, 1, 'M','Black', true, true);
  update public.products set status='published' where id = format('b4000000-0000-4000-8000-%s', lpad(n::text,12,'0'))::uuid;
 end loop;
end $$;
-- Variant id for garment n is e4000000-...-00000000000n.

-- ------------------------------------------------------------------ rate limits (session creation, writes, placement, phone)
update private.checkout_settings set sessions_per_client_per_hour = 2;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into test.tokens select 'rl1', public.start_checkout_session('Limit One','01700000101',null,'sec-client-rl')->>'token';
insert into test.tokens select 'rl2', public.start_checkout_session('Limit Two','01700000102',null,'sec-client-rl')->>'token';
select test.denied($q$select public.start_checkout_session('Limit Three','01700000103',null,'sec-client-rl')$q$,'CK005','third session from the same client within the hour is refused');
select test.assert_true((public.start_checkout_session('Other Client','01700000104',null,'sec-client-other')->>'token') ~ '^[0-9a-f]{64}$','a different client is not affected by another client''s limit');
select test.assert_true(public.checkout_session_status(test.tok('rl1'))->>'lifecycle_status'='active','sessions within the limit still work after refusals');
reset role;
select test.assert_true((select count(*)=2 from private.checkout_rate_events where action='start' and subject='client:sec-client-rl'),'refused session creation is not recorded (the cap is exact)');
update private.checkout_settings set sessions_per_client_per_hour = 100000, writes_per_client_per_minute = 2;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.set_checkout_items(test.tok('rl1'),'[{"variant_id":"e4000000-0000-4000-8000-000000000001","quantity":1}]','sec-client-rl');
select public.set_checkout_items(test.tok('rl1'),'[{"variant_id":"e4000000-0000-4000-8000-000000000001","quantity":1}]','sec-client-rl');
select test.denied($q$select public.set_checkout_items(test.tok('rl1'),'[{"variant_id":"e4000000-0000-4000-8000-000000000001","quantity":1}]','sec-client-rl')$q$,'CK005','a flood of cart writes from one client is throttled');
reset role;
update private.checkout_settings set writes_per_client_per_minute = 100000, orders_per_client_per_hour = 1;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.set_checkout_items(test.tok('rl2'),'[{"variant_id":"e4000000-0000-4000-8000-000000000002","quantity":1}]','sec-client-rl');
create temp table ord1 as select (public.place_checkout_order(test.tok('rl1'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null,'sec-client-rl','[{"variant_id":"e4000000-0000-4000-8000-000000000001","quantity":1}]'))->>'order_id' as id;
select test.denied($q$select public.place_checkout_order(test.tok('rl2'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null,'sec-client-rl','[{"variant_id":"e4000000-0000-4000-8000-000000000002","quantity":1}]')$q$,'CK005','second new order from the same client within the hour is refused');
select test.assert_true((public.place_checkout_order(test.tok('rl1'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null,'sec-client-rl','[{"variant_id":"e4000000-0000-4000-8000-000000000001","quantity":1}]')->>'order_id')=(select id from ord1),'a retry of an existing order is never rate-limited');
reset role;
select test.assert_true((select on_hand=1 from public.inventory where variant_id='e4000000-0000-4000-8000-000000000002'),'refused order decremented nothing');
update private.checkout_settings set orders_per_client_per_hour = 100000, orders_per_phone_per_day = 1;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into test.tokens select 'ph2', public.start_checkout_session('Same Phone','+8801700000101',null,'sec-client-phone')->>'token';
select public.set_checkout_items(test.tok('ph2'),'[{"variant_id":"e4000000-0000-4000-8000-000000000003","quantity":1}]','sec-client-phone');
select test.denied($q$select public.place_checkout_order(test.tok('ph2'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null,'sec-client-phone',null)$q$,'CK006','a second order for the same mobile number within a day is refused, from a different client');
reset role;
select test.assert_true((select on_hand=1 from public.inventory where variant_id='e4000000-0000-4000-8000-000000000003'),'phone-limited order decremented nothing');
update private.checkout_settings set orders_per_phone_per_day = 100000;

-- ------------------------------------------------------------------ units cap
update private.checkout_settings set max_units_per_order = 1;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into test.tokens select 'un', public.start_checkout_session('Units Buyer','01700000201',null,'sec-client-units')->>'token';
select public.set_checkout_items(test.tok('un'),'[{"variant_id":"e4000000-0000-4000-8000-000000000004","quantity":1},{"variant_id":"e4000000-0000-4000-8000-000000000005","quantity":1}]','sec-client-units');
select test.denied($q$select public.place_checkout_order(test.tok('un'),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null,'sec-client-units',null)$q$,'CK010','order above the units cap is refused');
reset role;
update private.checkout_settings set max_units_per_order = 10;

-- ------------------------------------------------------------------ location authority
select test.assert_true((select count(*)=64 and count(distinct division)=8 from private.delivery_locations),'authoritative table holds 8 divisions and 64 districts');
select test.denied($q$insert into public.orders(customer_name,phone,division,district,area,address_line,payment_method,subtotal_minor,delivery_charge_minor,total_minor,checkout_session_id) values('Direct','01700000999','Sylhet','Dhaka','A','House 1, Road 2','cod',100,0,100,(select id from public.checkout_sessions limit 1))$q$,'23503','direct insert of an invalid division/district pair is rejected by the database');
select test.denied($q$insert into public.orders(customer_name,phone,division,district,area,address_line,payment_method,subtotal_minor,delivery_charge_minor,total_minor,checkout_session_id) values('Direct','01700000999','Dhaka','Atlantis','A','House 1, Road 2','cod',100,0,100,(select id from public.checkout_sessions limit 1))$q$,'23503','direct insert of an unknown district is rejected by the database');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into test.tokens select 'loc', public.start_checkout_session('Location Test','01700000301',null,'sec-client-loc')->>'token';
select public.set_checkout_items(test.tok('loc'),'[{"variant_id":"e4000000-0000-4000-8000-000000000006","quantity":1}]','sec-client-loc');
select test.denied($q$select public.place_checkout_order(test.tok('loc'),'{"division":"Sylhet","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null,'sec-client-loc',null)$q$,'CK007','district from another division is refused by the RPC');
select test.assert_true((public.place_checkout_order(test.tok('loc'),'{"division":"Chattogram","district":"Cox''s Bazar","area":"Cox''s Bazar Sadar","address_line":"House 1, Road 2"}','cod',null,'sec-client-loc','[{"variant_id":"e4000000-0000-4000-8000-000000000006","quantity":1}]')->>'order_id') is not null,'a valid division and district pair with an apostrophe is accepted');
reset role;

-- ------------------------------------------------------------------ trust model
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select test.denied($q$select public.start_checkout_session('Anon Caller','01700000401',null,'anon-client')$q$,'42501','anon cannot start a session');
select test.denied($q$select public.place_checkout_order(repeat('a',64),'{"division":"Dhaka","district":"Dhaka","area":"Dhanmondi","address_line":"House 1, Road 2"}','cod',null,'anon-client',null)$q$,'42501','anon cannot place an order even with a valid-looking token');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
insert into test.tokens select 'cust', public.start_checkout_session('Customer Ignores Key','01700000501',null,'client-key-is-ignored')->>'token';
reset role;
select test.assert_true((select count(*) from private.checkout_rate_events where subject='user:a4000000-0000-4000-8000-000000000001' and action='start')=1,'customers are rate-limited by user id; a supplied client key is ignored');
select test.assert_true((select user_id='a4000000-0000-4000-8000-000000000001' from public.checkout_sessions where token_hash=encode(sha256(convert_to(test.tok('cust'),'UTF8')),'hex')),'customer session is linked to the signed-in user');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select test.denied($q$select public.start_checkout_session('No Identity','01700000601',null,null)$q$,'22023','server call without a client identity is refused');
select test.denied($q$select public.start_checkout_session('Short Identity','01700000601',null,'abc')$q$,'22023','a too-short client identity is refused');
reset role;

-- ------------------------------------------------------------------ privileges after remediation
select test.assert_true(not has_function_privilege('anon','public.place_checkout_order(text,jsonb,text,text,text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.start_checkout_session(text,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.set_checkout_items(text,jsonb,text)','EXECUTE') and not has_function_privilege('anon','public.update_checkout_contact(text,text,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.checkout_session_status(text)','EXECUTE'),'no checkout RPC is executable by anon');
select test.assert_true(not has_function_privilege('authenticated','private.consume_checkout_rate(text,text,interval,integer)','EXECUTE') and not has_function_privilege('service_role','private.consume_checkout_rate(text,text,interval,integer)','EXECUTE'),'rate limiter is not callable by API roles');
select test.assert_true(not has_table_privilege('service_role','private.checkout_rate_events','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated','private.checkout_rate_events','SELECT,INSERT,UPDATE,DELETE'),'rate ledger is not readable or writable by API roles');
select test.assert_true(not has_table_privilege('service_role','public.orders','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('service_role','public.checkout_sessions','SELECT,INSERT,UPDATE,DELETE'),'trusted server has no direct table access to orders or sessions');
select test.assert_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef and (p.proconfig is null or array_to_string(p.proconfig,',') not like '%search_path=%') and p.proname in ('start_checkout_session','update_checkout_contact','set_checkout_items','place_checkout_order','checkout_caller_subject','consume_checkout_rate','require_orders_enabled','same_checkout_items','orderable_variant','complete_checkout_session')),'every rewritten SECURITY DEFINER function has a fixed search_path');

select 'ALL CHECKS EXECUTED; rolling back' as result;
rollback;
