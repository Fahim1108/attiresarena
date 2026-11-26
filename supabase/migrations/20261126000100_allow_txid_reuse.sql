begin;
-- ALLOW TxID REUSE (Fahim, 2026-11-26).
-- Request: the same Transaction ID must be usable for multiple orders.
-- Screenshot: checkout refused a second order with CK013 ("This
-- Transaction ID has already been used for another order") when the
-- customer entered 6962 (the last 4 digits of the sender number).
--
-- WHAT CHANGES:
--  * Drops the partial unique index payment_submissions_txid_key
--    (provider, transaction_id) WHERE status <> 'rejected', created by
--    20261121000300 (merged payment-submissions migration). That index
--    is the ONLY thing enforcing one-order-per-TxID: place_checkout_order
--    catches its unique_violation and raises CK013. With the index
--    gone, the same insert succeeds and the order is placed.
--  * Replaces it with a plain (non-unique) lookup index on the same
--    columns, so admin search by TxID stays fast and staff can still
--    find every order that shares one TxID.
--
-- WHAT DOES NOT CHANGE (deliberately):
--  * No frontend change. CK013 stays mapped in
--    frontend/claude/src/lib/checkout/service.ts: while the old DB
--    still raises it (code deployed before this migration is applied)
--    the customer still sees the clear message; after this migration
--    it simply never fires for TxID reuse. No test change needed.
--  * No change to place_checkout_order's body. Its unique_violation
--    handler becomes unreachable for TxID reuse; the idempotency_key
--    unique constraint is untouched, and the session-replay path still
--    returns the original order for a double-click / retry of the SAME
--    checkout. Only a genuinely new checkout with a reused TxID now
--    places a new order.
--  * No change to admin verification: each order still gets its own
--    payment_submissions row (own idempotency_key), and Verify/Reject
--    still works per submission.
--
-- RISK Fahim accepted by asking for this: one real bKash/Nagad payment
-- can now back several orders, so the TxID alone no longer proves a
-- new payment was made. Admin must check each order's TxID + sender
-- number against the bKash/Nagad statement before confirming it.
-- This reverses the 2026-11-22 rule ("each order needs a distinct new
-- TxID"). Do NOT re-apply 20261121000100 / 20261121000300 after this.
--
-- APPLY: staging first, then production, only through an explicit,
-- owner-approved migration run. One transaction; on any error nothing
-- is applied. Verify after apply: place two test orders with the same
-- TxID (different checkouts) — both must succeed; a retry of the same
-- checkout must still return the original order, not a duplicate.

drop index if exists public.payment_submissions_txid_key;

-- Plain lookup index (not unique): keeps TxID search fast without
-- blocking reuse.
create index if not exists payment_submissions_txid_lookup_idx
  on public.payment_submissions(provider, transaction_id);

commit;
