#!/usr/bin/env bash
# Concurrency test for public.place_checkout_order.
# DISPOSABLE LOCAL DATABASE ONLY: it commits fixtures and orders that cannot be deleted.
# Usage: PGHOST=/path/to/local/socket-dir PGUSER=postgres bash scripts/test-checkout-order-concurrency.sh
# Requires bootstrap.sql and all repository migrations to be applied first.
set -euo pipefail
case "${PGHOST:-}" in /*) ;; *) echo "Refusing to run: PGHOST must be a local unix socket directory." >&2; exit 2;; esac
export PGUSER="${PGUSER:-postgres}"
q() { psql -X -q -tA -v ON_ERROR_STOP=1 -c "$1"; }
as_anon() { psql -X -q -tA -v ON_ERROR_STOP=1 -c "set role anon" -c "$1"; }
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }
work=$(mktemp -d)
ADDR='{"division":"Dhaka","district":"Dhaka","area":"Mirpur","address_line":"House 7, Road 3"}'

# An earlier regression test exhausts this non-transactional sequence; reset it (disposable DB).
q "select setval('private.customer_order_number_sequence', 10000, false)" >/dev/null
q "insert into public.categories(id,name,slug,published) values('c3000000-0000-4000-8000-000000000001','Concurrency','concurrency-test',true);
insert into public.products(id,category_id,name,slug,description,status) values
 ('b3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','Stocked','conc-stocked','x','published'),
 ('b3000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001','Last Unit','conc-last-unit','x','published'),
 ('b3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000001','Second','conc-second','x','published');
insert into public.product_variants(id,product_id,sku,size,color,price_minor,active) values
 ('e3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','CONC-1','M','Black',50000,true),
 ('e3000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000002','CONC-2','M','Black',50000,true),
 ('e3000000-0000-4000-8000-000000000003','b3000000-0000-4000-8000-000000000003','CONC-3','M','Black',50000,true);
insert into public.inventory(variant_id,on_hand) values
 ('e3000000-0000-4000-8000-000000000001',5),('e3000000-0000-4000-8000-000000000002',1),('e3000000-0000-4000-8000-000000000003',50);"

new_session() { # $1 = phone, $2 = items json; prints the raw token
 local t; t=$(as_anon "select public.start_checkout_session('Concurrent Guest','$1',null)->>'token'")
 as_anon "select public.set_checkout_items('$t','$2')" >/dev/null
 echo "$t"
}
place() { as_anon "select public.place_checkout_order('$1','$ADDR','cod',null)"; }

# --- A: eight simultaneous submissions of the SAME checkout -------------------------------
tok=$(new_session 01700000101 '[{"variant_id":"e3000000-0000-4000-8000-000000000001","quantity":1}]')
for i in 1 2 3 4 5 6 7 8; do place "$tok" >"$work/a$i" 2>"$work/a$i.err" & done; wait
for i in 1 2 3 4 5 6 7 8; do [ -s "$work/a$i" ] || { cat "$work/a$i.err" >&2; fail "A: caller $i did not receive an order"; }; done
ids=$(cat "$work"/a[1-8] | sed -E 's/.*"order_id": "([^"]+)".*/\1/' | sort -u | wc -l)
created=$(cat "$work"/a[1-8] | grep -c '"already_placed": false' || true)
[ "$ids" = 1 ] || fail "A: callers saw $ids different orders"
[ "$created" = 1 ] || fail "A: $created callers created an order (expected exactly 1)"
pass "A: 8 simultaneous submissions resolved to one order identity; exactly 1 created it, 7 observed it"
h="encode(sha256(convert_to('$tok','UTF8')),'hex')"
[ "$(q "select count(*) from public.orders o join public.checkout_sessions s on s.order_id=o.id where s.token_hash=$h")" = 1 ] || fail "A: checkout not linked to exactly one order"
[ "$(q "select count(*) from public.orders where phone='01700000101'")" = 1 ] || fail "A: more than one order row"
[ "$(q "select count(*) from public.order_items i join public.orders o on o.id=i.order_id where o.phone='01700000101'")" = 1 ] || fail "A: more than one set of order items"
[ "$(q "select on_hand from public.inventory where variant_id='e3000000-0000-4000-8000-000000000001'")" = 4 ] || fail "A: stock not decremented exactly once"
[ "$(q "select count(*) from public.inventory_movements where variant_id='e3000000-0000-4000-8000-000000000001'")" = 1 ] || fail "A: more than one stock movement"
pass "A: one order row, one item set, stock 5 -> 4 once, one ledger movement, one checkout link"

# --- B: the second caller really waits on the row lock ------------------------------------
tok=$(new_session 01700000102 '[{"variant_id":"e3000000-0000-4000-8000-000000000003","quantity":1}]')
psql -X -q -tA -v ON_ERROR_STOP=1 -c "set role anon" -c "begin" -c "select public.place_checkout_order('$tok','$ADDR','cod',null)" -c "select pg_sleep(3)" -c "commit" >"$work/b1" 2>&1 &
sleep 1
start=$(date +%s%N); second=$(place "$tok"); waited_ms=$(( ($(date +%s%N) - start) / 1000000 )); wait
first_id=$(grep order_id "$work/b1" | sed -E 's/.*"order_id": "([^"]+)".*/\1/')
second_id=$(echo "$second" | sed -E 's/.*"order_id": "([^"]+)".*/\1/')
[ -n "$first_id" ] && [ "$first_id" = "$second_id" ] || fail "B: second caller got a different order"
echo "$second" | grep -q '"already_placed": true' || fail "B: second caller did not observe the existing order"
[ "$waited_ms" -ge 1200 ] || fail "B: second caller did not block on the session lock (${waited_ms}ms)"
pass "B: second submission blocked ${waited_ms}ms on the FOR UPDATE lock, then returned the first caller's order"

# --- C: two DIFFERENT checkouts race for the last unit ------------------------------------
t1=$(new_session 01700000103 '[{"variant_id":"e3000000-0000-4000-8000-000000000002","quantity":1}]')
t2=$(new_session 01700000104 '[{"variant_id":"e3000000-0000-4000-8000-000000000002","quantity":1}]')
place "$t1" >"$work/c1" 2>"$work/c1.err" & place "$t2" >"$work/c2" 2>"$work/c2.err" & wait || true
won=$(cat "$work/c1" "$work/c2" | grep -c order_id || true)
lost=$(cat "$work/c1.err" "$work/c2.err" | grep -c "Not enough stock" || true)
[ "$won" = 1 ] && [ "$lost" = 1 ] || fail "C: expected one winner and one stock rejection (won=$won lost=$lost)"
[ "$(q "select on_hand from public.inventory where variant_id='e3000000-0000-4000-8000-000000000002'")" = 0 ] || fail "C: last unit stock is not 0"
[ "$(q "select count(*) from public.order_items where variant_id='e3000000-0000-4000-8000-000000000002'")" = 1 ] || fail "C: last unit sold more than once"
[ "$(q "select count(*) from public.inventory where on_hand<0")" = 0 ] || fail "C: negative stock"
pass "C: two checkouts raced for stock 1: one order, one rejection, stock 0, never negative"

# --- D: opposite item orders do not deadlock ----------------------------------------------
d1=$(new_session 01700000105 '[{"variant_id":"e3000000-0000-4000-8000-000000000001","quantity":1},{"variant_id":"e3000000-0000-4000-8000-000000000003","quantity":1}]')
d2=$(new_session 01700000106 '[{"variant_id":"e3000000-0000-4000-8000-000000000003","quantity":1},{"variant_id":"e3000000-0000-4000-8000-000000000001","quantity":1}]')
place "$d1" >"$work/d1" 2>"$work/d1.err" & place "$d2" >"$work/d2" 2>"$work/d2.err" & wait
grep -q order_id "$work/d1" && grep -q order_id "$work/d2" || { cat "$work"/d?.err >&2; fail "D: an order failed (possible deadlock)"; }
pass "D: two checkouts with the same two products in opposite order both succeeded (no deadlock)"

[ "$(q "select count(*) from public.orders o where o.total_minor <> o.subtotal_minor - o.discount_minor + o.delivery_charge_minor or o.order_number is null")" = 0 ] || fail "order without number or with inconsistent total"
[ "$(q "select count(*) - count(distinct order_number) from public.orders")" = 0 ] || fail "duplicate order numbers"
pass "all committed orders have unique order numbers and consistent totals"
echo "CONCURRENCY TESTS PASSED"
