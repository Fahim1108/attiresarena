#!/usr/bin/env bash
# Concurrency tests for public.place_checkout_order and the checkout rate limits.
# DISPOSABLE LOCAL DATABASE ONLY: it COMMITS fixtures and orders that cannot be removed.
# Run once on a fresh database that already has bootstrap.sql and every repository migration:
#   PGHOST=/path/to/local/socket-dir PGUSER=postgres bash scripts/test-checkout-order-concurrency.sh
set -euo pipefail
case "${PGHOST:-}" in /*) ;; *) echo "Refusing to run: PGHOST must be a local unix socket directory." >&2; exit 2;; esac
export PGUSER="${PGUSER:-postgres}"
q() { psql -X -q -tA -v ON_ERROR_STOP=1 -c "$1"; }
# Trusted server identity: the service_role JWT claim, with a client key, as the Next.js server sends it.
svc() { psql -X -q -tA -v ON_ERROR_STOP=1 -c "set role service_role" -c "do \$\$ begin perform set_config('request.jwt.claims','{\"role\":\"service_role\"}',false); end \$\$" -c "$1"; }
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }
work=$(mktemp -d)
ADDR='{"division":"Dhaka","district":"Dhaka","area":"Mirpur","address_line":"House 7, Road 3"}'

if [ "$(q "select count(*) from public.categories where slug = 'concurrency-test'")" != 0 ]; then
  fail "fixtures already exist; run this script on a fresh database only"
fi

q "update private.checkout_settings set orders_enabled = true, sessions_per_client_per_hour = 100000,
   writes_per_client_per_minute = 100000, orders_per_client_per_hour = 100000, orders_per_phone_per_day = 100000, max_units_per_order = 10"
q "insert into public.categories(id,name,slug,published) values ('c3000000-0000-4000-8000-000000000001','Concurrency','concurrency-test',true)"
for n in 1 2 3 4 5 6 7; do
  pid=$(printf 'b3000000-0000-4000-8000-%012d' $n); vid=$(printf 'e3000000-0000-4000-8000-%012d' $n); hash=$(printf '%02x' $n); hash=$(printf "%s" "$hash" | head -c 2)
  q "insert into public.products(id,category_id,name,slug,description,status) values ('$pid','c3000000-0000-4000-8000-000000000001','Conc $n','conc-$n','x','draft')"
  q "insert into public.product_variants(id,product_id,sku,size,color,price_minor,active) values ('$vid','$pid','CONC-$n','M','Black',0,true)"
  q "insert into public.inventory(variant_id,on_hand) values ('$vid',1)"
  q "insert into public.thrift_intake(source_id,product_id,image_path,image_sha256,price_minor,stock_quantity,actual_size,actual_color,size_verified,details_verified)
     values ('AA-SHIRT-9$(printf %02d $n)','$pid','/inventory/thrift-shirts/AA-SHIRT-9$(printf %02d $n)-front.jpg',repeat('$hash',32),$((50000 + n * 1000)),1,'M','Black',true,true)"
  q "update public.products set status='published' where id='$pid'"
done
V() { printf 'e3000000-0000-4000-8000-%012d' "$1"; }
P() { printf 'b3000000-0000-4000-8000-%012d' "$1"; }
q "update private.checkout_settings set orders_per_phone_per_day = 100000"

new_session() { # $1 = phone, $2 = client key, $3 = variant uuid; prints the raw token
  local t; t=$(svc "select public.start_checkout_session('Concurrent Guest','$1',null,'$2')->>'token'" | tail -1)
  svc "select public.set_checkout_items('$t','[{\"variant_id\":\"$3\",\"quantity\":1}]','$2')" >/dev/null
  echo "$t"
}
place() { svc "select public.place_checkout_order('$1','$ADDR','cod',null,'$2','$3')"; }
item_of() { echo "[{\"variant_id\":\"$1\",\"quantity\":1}]"; }

# --- A: eight simultaneous submissions of the SAME checkout -------------------------------
tok=$(new_session 01700000101 conc-client-a "$(V 1)")
for i in 1 2 3 4 5 6 7 8; do place "$tok" conc-client-a "$(item_of "$(V 1)")" >"$work/a$i" 2>"$work/a$i.err" & done; wait
for i in 1 2 3 4 5 6 7 8; do grep -q order_id "$work/a$i" || { cat "$work/a$i.err" >&2; fail "A: caller $i did not receive an order"; }; done
ids=$(cat "$work"/a[1-8] | grep -o '"order_id": *"[^"]*"' | sort -u | wc -l)
created=$(cat "$work"/a[1-8] | grep -c '"already_placed": *false' || true)
[ "$ids" = 1 ] || fail "A: callers saw $ids different orders"
[ "$created" = 1 ] || fail "A: $created callers created an order (expected exactly 1)"
pass "A: 8 simultaneous submissions resolved to one order; exactly 1 created it, 7 observed it"
[ "$(q "select count(*) from public.orders where phone='01700000101'")" = 1 ] || fail "A: more than one order row"
[ "$(q "select count(*) from public.order_items i join public.orders o on o.id=i.order_id where o.phone='01700000101'")" = 1 ] || fail "A: more than one set of order items"
[ "$(q "select on_hand from public.inventory where variant_id='$(V 1)'")" = 0 ] || fail "A: stock not decremented exactly once"
[ "$(q "select count(*) from public.inventory_movements where variant_id='$(V 1)'")" = 1 ] || fail "A: more than one stock movement"
[ "$(q "select count(*) from public.checkout_sessions s join public.orders o on o.id=s.order_id where s.token_hash=encode(sha256(convert_to('$tok','UTF8')),'hex')")" = 1 ] || fail "A: checkout not linked to exactly one order"
pass "A: one order row, one item set, stock 1 -> 0 once, one ledger movement, one checkout link"

# --- B: the second caller waits on the session lock, then sees the first caller's order -------
tok=$(new_session 01700000102 conc-client-b "$(V 2)")
psql -X -q -tA -v ON_ERROR_STOP=1 -c "set role service_role" -c "do \$\$ begin perform set_config('request.jwt.claims','{\"role\":\"service_role\"}',false); end \$\$" -c "begin" -c "select public.place_checkout_order('$tok','$ADDR','cod',null,'conc-client-b','$(item_of "$(V 2)")')" -c "select pg_sleep(3)" -c "commit" >"$work/b1" 2>&1 &
sleep 1
start=$(date +%s%N); second=$(place "$tok" conc-client-b "$(item_of "$(V 2)")"); waited_ms=$(( ($(date +%s%N) - start) / 1000000 )); wait
first_id=$(grep -o '"order_id": *"[^"]*"' "$work/b1" | head -1 | sed -E 's/.*"([0-9a-f-]{36})".*/\1/')
second_id=$(echo "$second" | grep -o '"order_id": *"[^"]*"' | head -1 | sed -E 's/.*"([0-9a-f-]{36})".*/\1/')
[ -n "$first_id" ] && [ "$first_id" = "$second_id" ] || fail "B: second caller got a different order"
echo "$second" | grep -q '"already_placed": *true' || fail "B: second caller did not observe the existing order"
[ "$waited_ms" -ge 1200 ] || fail "B: second caller did not block on the session lock (${waited_ms}ms)"
pass "B: second submission blocked ${waited_ms}ms on the session lock, then returned the first caller's order"

# --- C: DELAYED retries after the order exists, all concurrent ----------------------------
q "set session_replication_role = replica; update public.orders set placed_at = now() - interval '2 hours' where phone='01700000102'; set session_replication_role = origin" >/dev/null 2>&1 || \
  q "update public.orders set placed_at = now() - interval '2 hours' where phone='01700000102'" >/dev/null
for i in 1 2 3 4; do place "$tok" conc-client-b "$(item_of "$(V 2)")" >"$work/c$i" 2>&1 & done; wait
for i in 1 2 3 4; do grep -q "\"order_id\": *\"$first_id\"" "$work/c$i" || { cat "$work/c$i" >&2; fail "C: delayed retry $i did not return the original order"; }; done
[ "$(q "select count(*) from public.orders where phone='01700000102'")" = 1 ] || fail "C: delayed retries created an extra order"
pass "C: four concurrent retries two hours later all returned the original order; no extra order"

# --- D: two DIFFERENT checkouts race for the last unit of one garment ---------------------
t1=$(new_session 01700000103 conc-client-d1 "$(V 3)")
t2=$(new_session 01700000104 conc-client-d2 "$(V 3)")
place "$t1" conc-client-d1 "$(item_of "$(V 3)")" >"$work/d1" 2>"$work/d1.err" & place "$t2" conc-client-d2 "$(item_of "$(V 3)")" >"$work/d2" 2>"$work/d2.err" & wait || true
won=$(cat "$work/d1" "$work/d2" | grep -c order_id || true)
lost=$(cat "$work/d1.err" "$work/d2.err" | grep -cE "not available|Not enough stock" || true)
[ "$won" = 1 ] && [ "$lost" = 1 ] || fail "D: expected one winner and one rejection (won=$won lost=$lost)"
[ "$(q "select on_hand from public.inventory where variant_id='$(V 3)'")" = 0 ] || fail "D: last unit stock is not 0"
[ "$(q "select count(*) from public.order_items where variant_id='$(V 3)'")" = 1 ] || fail "D: last unit sold more than once"
[ "$(q "select count(*) from public.inventory where on_hand<0")" = 0 ] || fail "D: negative stock"
pass "D: two checkouts raced for the last unit: one order, one rejection, stock 0, never negative"

# --- E: rate limit holds under concurrency -------------------------------------------------
q "update private.checkout_settings set sessions_per_client_per_hour = 3"
for i in 1 2 3 4 5 6 7 8; do svc "select public.start_checkout_session('Flood $i','0170000050$i',null,'conc-flood')->>'token'" >"$work/e$i" 2>&1 & done; wait
made=$(cat "$work"/e[1-8] | grep -cE '^[0-9a-f]{64}$' || true)
refused=$(cat "$work"/e[1-8] | grep -c "Too many checkout requests" || true)
[ "$made" = 3 ] && [ "$refused" = 5 ] || fail "E: expected exactly 3 sessions and 5 refusals (made=$made refused=$refused)"
q "update private.checkout_settings set sessions_per_client_per_hour = 100000"
pass "E: 8 simultaneous session creations from one client: exactly 3 allowed, 5 refused"

# --- F: per-phone daily cap holds under concurrency (different checkouts, same mobile) ------
q "update private.checkout_settings set orders_per_phone_per_day = 1"
f1=$(new_session 01700000105 conc-client-f1 "$(V 4)")
f2=$(new_session 01799900105 conc-client-f2 "$(V 5)")
q "update public.checkout_sessions set phone='01700000105' where token_hash=encode(sha256(convert_to('$f2','UTF8')),'hex')"
place "$f1" conc-client-f1 "$(item_of "$(V 4)")" >"$work/f1" 2>"$work/f1.err" & place "$f2" conc-client-f2 "$(item_of "$(V 5)")" >"$work/f2" 2>"$work/f2.err" & wait || true
won=$(cat "$work/f1" "$work/f2" | grep -c order_id || true)
capped=$(cat "$work/f1.err" "$work/f2.err" | grep -c "Too many orders for this mobile number" || true)
[ "$won" = 1 ] && [ "$capped" = 1 ] || fail "F: expected one order and one phone-cap refusal (won=$won capped=$capped)"
pass "F: two checkouts for one mobile number raced: one order, one daily-cap refusal"

[ "$(q "select count(*) - count(distinct order_number) from public.orders")" = 0 ] || fail "duplicate order numbers"
[ "$(q "select count(*) from public.orders o where o.total_minor <> o.subtotal_minor - o.discount_minor + o.delivery_charge_minor")" = 0 ] || fail "inconsistent totals"
pass "all committed orders have unique order numbers and consistent totals"
echo "CONCURRENCY TESTS PASSED"
