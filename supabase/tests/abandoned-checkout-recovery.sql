-- LOCAL TEST ONLY for supabase/migrations/20261113000100 (foundation), adjusted for
-- 20261113000300 (access model: service_role for the trusted server, no anon execute).
-- Run after bootstrap.sql and every repository migration. Rolls back everything.
\set ON_ERROR_STOP on
begin;
create schema test;
grant usage on schema test to anon, authenticated;
do $$ begin if not exists(select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $$;
grant usage on schema test to service_role;
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
grant execute on all functions in schema test to anon, authenticated, service_role;

-- Ordering on, and rate limits high enough that this suite is not throttled.
update private.checkout_settings set orders_enabled = true, sessions_per_client_per_hour = 100000,
 writes_per_client_per_minute = 100000, orders_per_client_per_hour = 100000, orders_per_phone_per_day = 100000;

-- ---------------------------------------------------------------- fixtures (superuser)
insert into auth.users(id,email,is_anonymous) values
 ('a1000000-0000-4000-8000-000000000001','owner@example.test',false),
 ('a1000000-0000-4000-8000-000000000002','analyst@example.test',false),
 ('a1000000-0000-4000-8000-000000000003','customer@example.test',false);
insert into public.user_roles(user_id,role) values
 ('a1000000-0000-4000-8000-000000000001','owner'),('a1000000-0000-4000-8000-000000000002','analyst');
insert into public.categories(id,name,slug,published) values ('c1000000-0000-4000-8000-000000000001','Shirts','shirts',true);
insert into public.products(id,category_id,name,slug,description,status) values
 ('b1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Oxford','oxford-shirt','Cotton.','published');
insert into public.product_variants(id,product_id,sku,size,color,price_minor,sale_price_minor,active) values
 ('e1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','OX-M-WHT','M','White',150000,120000,true);
insert into public.checkout_sessions(id,token_hash,customer_name,phone,lifecycle_status,started_at,last_activity_at,expires_at) values
 ('d1000000-0000-4000-8000-000000000001',repeat('1',64),'Stale Guest','01711111111','active',now()-interval '3 hours',now()-interval '3 hours',now()+interval '7 days'),
 ('d1000000-0000-4000-8000-000000000002',repeat('2',64),'Recent Guest','01722222222','active',now()-interval '10 minutes',now()-interval '10 minutes',now()+interval '7 days'),
 ('d1000000-0000-4000-8000-000000000003',repeat('3',64),'Done Guest','01733333333','active',now()-interval '5 hours',now()-interval '5 hours',now()+interval '7 days');
-- Orders reference their session, so the completed session is made complete after its order exists.
insert into public.orders(id,order_number,checkout_session_id,customer_name,phone,division,district,area,address_line,payment_method,subtotal_minor,delivery_charge_minor,total_minor) values
 ('f1000000-0000-4000-8000-000000000001',10001,'d1000000-0000-4000-8000-000000000001','Stale Guest','01711111111','Dhaka','Dhaka','Test','House 1, Road 2','cod',100,0,100),
 ('f1000000-0000-4000-8000-000000000002',10002,'d1000000-0000-4000-8000-000000000003','Done Guest','01733333333','Dhaka','Dhaka','Test','House 1, Road 2','cod',100,0,100),
 ('f1000000-0000-4000-8000-000000000003',10003,'d1000000-0000-4000-8000-000000000002','Recent Guest','01722222222','Dhaka','Dhaka','Test','House 1, Road 2','cod',100,0,100);
update public.checkout_sessions set lifecycle_status='completed', order_id='f1000000-0000-4000-8000-000000000002' where id='d1000000-0000-4000-8000-000000000003';
insert into public.checkout_items(checkout_session_id,product_id,variant_id,quantity,regular_price_minor,unit_price_minor,price_snapshot_at)
 values('d1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',1,150000,120000,now());

-- ---------------------------------------------------------------- schema and privilege facts
select test.assert_true((select bool_and(relrowsecurity) from pg_class where relname in ('checkout_sessions','checkout_items','abandoned_recovery_log')),'RLS enabled on all three tables');
select test.assert_true((select count(*)=3 from pg_policies where tablename in ('checkout_sessions','checkout_items','abandoned_recovery_log') and roles @> '{authenticated}'),'exactly one staff read policy per table');
select test.assert_true(not exists(select 1 from pg_policies where tablename in ('checkout_sessions','checkout_items','abandoned_recovery_log') and ('anon'=any(roles) or 'service_role'=any(roles))),'no policy for anon or service_role');
select test.assert_true(not has_table_privilege('anon','public.checkout_sessions','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated','public.checkout_sessions','INSERT,UPDATE,DELETE'),'no direct guest or customer table CRUD on checkout_sessions');
select test.assert_true(not has_table_privilege('anon','public.checkout_items','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon','public.abandoned_recovery_log','SELECT,INSERT,UPDATE,DELETE'),'anon has no privilege on items or recovery log');
select test.assert_true(not has_column_privilege('authenticated','public.checkout_sessions','token_hash','SELECT') and has_column_privilege('authenticated','public.checkout_sessions','customer_name','SELECT'),'token_hash is not readable by any API role; other columns are');
select test.assert_true(not has_function_privilege('anon','public.start_checkout_session(text,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.place_checkout_order(text,jsonb,text,text,text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.checkout_session_status(text)','EXECUTE'),'anon cannot execute any checkout RPC');
select test.assert_true(has_function_privilege('service_role','public.start_checkout_session(text,text,text,text)','EXECUTE') and has_function_privilege('service_role','public.place_checkout_order(text,jsonb,text,text,text,jsonb)','EXECUTE'),'trusted server role can execute checkout RPCs');
select test.assert_true(has_function_privilege('authenticated','public.place_checkout_order(text,jsonb,text,text,text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.admin_set_checkout_recovery_status(uuid,timestamptz,text,text)','EXECUTE') and has_function_privilege('authenticated','public.admin_set_checkout_recovery_status(uuid,timestamptz,text,text)','EXECUTE'),'customers can place orders; admin RPC is authenticated-only');
select test.assert_true(not has_function_privilege('anon','private.mark_abandoned_checkout_sessions(interval)','EXECUTE') and not has_function_privilege('authenticated','private.mark_abandoned_checkout_sessions(interval)','EXECUTE') and not has_function_privilege('service_role','private.mark_abandoned_checkout_sessions(interval)','EXECUTE'),'abandonment function is not executable through any API role');
select test.assert_true(not has_function_privilege('anon','private.complete_checkout_session(uuid,uuid)','EXECUTE') and not has_function_privilege('authenticated','private.complete_checkout_session(uuid,uuid)','EXECUTE'),'purchase linkage function not executable by API roles');
select test.assert_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef and p.proname in ('start_checkout_session','checkout_session_status','place_checkout_order','set_checkout_items','update_checkout_contact','admin_set_checkout_recovery_status','mark_abandoned_checkout_sessions','complete_checkout_session','locked_checkout_session','checkout_token_hash','guard_checkout_session_update','guard_checkout_item','reject_recovery_log_change') and (p.proconfig is null or array_to_string(p.proconfig,',') not like '%search_path=%')),'every SECURITY DEFINER function has a fixed search_path');
select test.assert_true((select count(*)=2 from public.role_permissions where permission='checkout.recover'),'checkout.recover granted only to owner and order_manager');

-- ---------------------------------------------------------------- anonymous callers are refused everywhere
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select test.denied($q$select count(*) from public.checkout_sessions$q$,'42501','anon cannot read checkout_sessions directly');
select test.denied($q$select count(*) from public.checkout_items$q$,'42501','anon cannot read checkout_items directly');
select test.denied($q$select count(*) from public.abandoned_recovery_log$q$,'42501','anon cannot read recovery log directly');
select test.denied($q$insert into public.checkout_sessions(token_hash,customer_name,phone,expires_at) values(repeat('9',64),'Mallory','01700000000',now()+interval '1 day')$q$,'42501','anon cannot insert a session directly');
select test.denied($q$update public.checkout_sessions set recovery_status='recovered'$q$,'42501','anon cannot update a session directly');
select test.denied($q$delete from public.checkout_sessions$q$,'42501','anon cannot delete a session directly');
select test.denied($q$select public.start_checkout_session('Mallory','01700000000',null,'anon-client-0001')$q$,'42501','anon cannot start a checkout session (no RPC access)');
select test.denied($q$select public.checkout_session_status(repeat('1',64))$q$,'42501','anon cannot read checkout status (no RPC access)');
select test.denied($q$select public.admin_set_checkout_recovery_status('d1000000-0000-4000-8000-000000000001',now(),'contacted','anon attempt note')$q$,'42501','anon cannot call the admin recovery RPC');

-- ---------------------------------------------------------------- trusted server: guest flow
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select test.denied($q$select public.start_checkout_session('Nasrin Akter','01712345678',null,null)$q$,'22023','server call without a client identity is refused');
select test.denied($q$select public.start_checkout_session('Bad Phone','0123',null,'step1-client-0001')$q$,'22023','invalid Bangladeshi phone refused');
select test.denied($q$select public.start_checkout_session('   ','01712345678',null,'step1-client-0001')$q$,'22023','blank name refused');
select test.denied($q$select public.start_checkout_session('Ok Name','01712345678','not-an-email','step1-client-0001')$q$,'22023','malformed email refused');
select (public.start_checkout_session('Nasrin Akter','01712345678','  Guest@Example.TEST ','step1-client-0001')->>'token') as tok \gset
select test.assert_true(length(:'tok')=64 and :'tok' ~ '^[0-9a-f]{64}$','start returns a 64-hex raw token once');
select test.assert_true(public.checkout_session_status(:'tok')->>'lifecycle_status'='active','status readable with the token while active');
select test.denied($q$select public.checkout_session_status('d1000000-0000-4000-8000-000000000002')$q$,'22023','session UUID alone is not a credential');
select test.denied($q$select public.checkout_session_status('0000000000000000000000000000000000000000000000000000000000000000')$q$,'22023','unknown token refused');
select test.denied($q$select count(*) from public.checkout_sessions$q$,'42501','service role has no direct table access');

-- ---------------------------------------------------------------- stored state (superuser)
reset role;
select test.assert_true((select count(*)=1 from public.checkout_sessions where token_hash=encode(sha256(convert_to(:'tok','UTF8')),'hex') and token_hash<>:'tok'),'only the SHA-256 of the token is stored');
select test.assert_true((select email='guest@example.test' and customer_name='Nasrin Akter' and user_id is null from public.checkout_sessions where token_hash=encode(sha256(convert_to(:'tok','UTF8')),'hex')),'email normalised, name trimmed, guest has no user link');
select test.denied($q$insert into public.checkout_items(checkout_session_id,product_id,variant_id,quantity,regular_price_minor,unit_price_minor,price_snapshot_at) values('d1000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',1,1,5,now())$q$,'23514','a unit price above the regular price is rejected');

-- ---------------------------------------------------------------- abandonment (idempotent, preserves last activity)
create temp table snap as select id,last_activity_at from public.checkout_sessions;
select test.denied($q$select private.mark_abandoned_checkout_sessions(interval '10 seconds')$q$,'22023','threshold below one minute refused');
select test.assert_true(private.mark_abandoned_checkout_sessions(interval '2 hours')=1,'first run abandons exactly the stale session that holds an item');
select test.assert_true(private.mark_abandoned_checkout_sessions(interval '2 hours')=0,'second run is idempotent');
select test.assert_true((select lifecycle_status='abandoned' and abandoned_at is not null from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000001'),'stale session is abandoned with abandoned_at set');
select test.assert_true((select s.last_activity_at is not distinct from snap.last_activity_at from public.checkout_sessions s join snap using(id) where s.id='d1000000-0000-4000-8000-000000000001'),'last_activity_at preserved by abandonment');
select test.assert_true((select lifecycle_status='active' from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000002'),'recent active session untouched');
select test.assert_true((select lifecycle_status='completed' and abandoned_at is null from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000003'),'completed session ignored by abandonment');

-- ---------------------------------------------------------------- lifecycle transition guards
select test.denied($q$update public.checkout_sessions set lifecycle_status='active' where id='d1000000-0000-4000-8000-000000000001'$q$,'22023','abandoned cannot return to active');
select test.denied($q$update public.checkout_sessions set lifecycle_status='abandoned', abandoned_at=now() where id='d1000000-0000-4000-8000-000000000003'$q$,'22023','completed cannot become abandoned');
select test.denied($q$update public.checkout_sessions set lifecycle_status='completed' where id='d1000000-0000-4000-8000-000000000002'$q$,'23514','active to completed without an order link refused');
select test.denied($q$update public.checkout_sessions set abandoned_at=now() where id='d1000000-0000-4000-8000-000000000001'$q$,'22023','abandoned_at cannot be rewritten');
select test.denied($q$update public.checkout_sessions set recovery_status='recovered' where id='d1000000-0000-4000-8000-000000000001'$q$,'23514','pending cannot jump to recovered without a purchase');
select test.denied($q$update public.checkout_sessions set token_hash=repeat('8',64) where id='d1000000-0000-4000-8000-000000000001'$q$,'22023','token hash is immutable');

-- ---------------------------------------------------------------- staff recovery workflow (owner with MFA)
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select test.assert_true((select count(*)=1 from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000001'),'owner can read checkout sessions');
select test.denied($q$select token_hash from public.checkout_sessions$q$,'42501','staff cannot read token hash column');
select test.denied($q$select public.admin_set_checkout_recovery_status('d1000000-0000-4000-8000-000000000002',(select updated_at from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000002'),'contacted','Not yet abandoned')$q$,'22023','active session has no recovery state');
select test.denied($q$select public.admin_set_checkout_recovery_status('d1000000-0000-4000-8000-000000000001','2000-01-01','contacted','Stale version')$q$,'PT409','stale version refused');
select test.denied($q$select public.admin_set_checkout_recovery_status('d1000000-0000-4000-8000-000000000001',(select updated_at from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000001'),'recovered','Attempted manual recovery')$q$,'22023','manual recovered is refused');
select test.denied($q$select public.admin_set_checkout_recovery_status('d1000000-0000-4000-8000-000000000001',(select updated_at from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000001'),'contacted','no')$q$,'22023','note shorter than 3 characters refused');
select updated_at::text as ua1 from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000001' \gset
select public.admin_set_checkout_recovery_status('d1000000-0000-4000-8000-000000000001',:'ua1'::timestamptz,'contacted','Called guest, asked to confirm order');
select test.assert_true((select recovery_status='contacted' and contacted_at is not null from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000001'),'pending to contacted by owner sets contacted_at');
select updated_at::text as ua2 from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000001' \gset
select public.admin_set_checkout_recovery_status('d1000000-0000-4000-8000-000000000001',:'ua2'::timestamptz,'lost','Guest said not interested');
select test.denied($q$select public.admin_set_checkout_recovery_status('d1000000-0000-4000-8000-000000000001',(select updated_at from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000001'),'contacted','Trying to revive')$q$,'22023','lost cannot return to contacted');
select test.assert_true((select count(*)=2 and bool_and(change_source='manual' and changed_by='a1000000-0000-4000-8000-000000000001') from public.abandoned_recovery_log where checkout_session_id='d1000000-0000-4000-8000-000000000001'),'manual changes logged with admin user and source');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select test.denied($q$select public.admin_set_checkout_recovery_status('d1000000-0000-4000-8000-000000000001',now(),'contacted','Analyst attempt note')$q$,'42501','analyst without checkout.recover denied');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select test.denied($q$select public.admin_set_checkout_recovery_status('d1000000-0000-4000-8000-000000000001',now(),'contacted','Owner without MFA')$q$,'42501','owner without MFA denied');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select test.assert_true((select count(*)=0 from public.checkout_sessions),'customer with no staff role sees no checkout sessions');

-- ---------------------------------------------------------------- purchase linkage
reset role;
select test.denied($q$select private.complete_checkout_session('d1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000009')$q$,'22023','unknown order refused');
select test.denied($q$select private.complete_checkout_session('d1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002')$q$,'22023','an order that belongs to another session is refused');
select private.complete_checkout_session('d1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001');
select test.assert_true((select lifecycle_status='completed' and recovery_status='recovered' and order_id='f1000000-0000-4000-8000-000000000001' and recovered_at is not null and abandoned_at is not null from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000001'),'lost to recovered via linked purchase; abandoned_at preserved');
select test.assert_true((select count(*)=1 and bool_and(change_source='automatic' and changed_by is null and new_recovery_status='recovered' and previous_recovery_status='lost') from public.abandoned_recovery_log where checkout_session_id='d1000000-0000-4000-8000-000000000001' and new_recovery_status='recovered'),'automatic lost to recovered entry logged with no admin user');
select test.assert_true(private.complete_checkout_session('d1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001') is not null,'repeating the same purchase link is idempotent');
select test.denied($q$select private.complete_checkout_session('d1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000003')$q$,'22023','a completed session cannot take a different order');
select private.complete_checkout_session('d1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000003');
select test.assert_true((select lifecycle_status='completed' and recovery_status='pending' and abandoned_at is null from public.checkout_sessions where id='d1000000-0000-4000-8000-000000000002'),'active to completed keeps recovery pending and writes no recovery log');
select test.assert_true((select count(*)=0 from public.abandoned_recovery_log where checkout_session_id='d1000000-0000-4000-8000-000000000002'),'no recovery log for a non-abandoned purchase');

-- ---------------------------------------------------------------- append-only recovery history
select test.denied($q$update public.abandoned_recovery_log set note='rewritten'$q$,'42501','recovery log cannot be updated');
select test.denied($q$delete from public.abandoned_recovery_log$q$,'42501','recovery log cannot be deleted');

select 'ALL CHECKS EXECUTED; rolling back' as result;
rollback;
