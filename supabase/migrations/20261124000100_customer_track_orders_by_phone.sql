begin;
-- Guest order tracking: list ALL orders for one phone, newest first.
--
-- PURPOSE: the /track-order page only ever showed one order, and only
-- when the customer typed its number. The order-number field was
-- required, so a customer who only knew their phone could track
-- nothing. This migration adds the single database read the
-- phone-only list needs. It changes no table, no policy, and no
-- existing function.
--
-- WHY THIS FUNCTION EXISTS: the customer client reads orders through
-- RLS `orders_own_read` (authenticated users see only their own
-- user_id rows), and guests have no session at all, so no client-side
-- query can ever return a guest order. The function runs SECURITY
-- DEFINER and checks the phone itself: a phone alone is not
-- guessable the way a 5-digit order number is, but the list is still
-- gated to the server role and rate-limited per phone (below), so it
-- cannot be used to enumerate orders.
--
-- SECRET-HANDLING DESIGN (same rules as migration 20261119000500):
--  * The function refuses every caller except service_role, checked
--    with auth.role(). Grants go to service_role ONLY; anon and
--    authenticated are revoked, so no browser or signed-in customer
--    can call it through PostgREST. Only the app server calls it, with
--    the server-only credential, from the getOrdersByPhone server
--    action (see lib/customer/tracking.ts).
--  * The phone is normalised inside the function with the existing
--    private.normalize_bd_phone (spaces/dashes stripped, +88/88
--    prefix removed), then must match the strict stored form
--    ^01[3-9][0-9]{8}$ — the same CHECK the orders table enforces.
--    A phone that does not normalise to that form yields an empty
--    list, exactly like a phone with no orders: the caller can never
--    tell which part was wrong.
--  * Each entry carries ONLY the columns the customer order read
--    already selects (CUSTOMER_ORDER_COLUMNS /
--    CUSTOMER_ORDER_ITEM_COLUMNS in lib/customer/orders.ts). The
--    order note is never returned (it can hold payment details),
--    user_id and checkout_session_id are never returned, and the SKU
--    column is never returned. Courier columns are never returned:
--    shipment records live in the staff-only order_shipments table.
--  * A miss returns an empty list, never an error: the page shows
--    the same "No orders found" state for an unknown phone and a
--    phone with no orders alike.
--  * RATE LIMIT: reuses the checkout rate ledger
--    (private.consume_checkout_rate) with the existing 'track'
--    action and the SAME per-phone key the single-order lookup uses
--    ('phone:<number>', 30 lookups / 1 hour), so list + single
--    lookups share one budget per phone. On limit,
--    consume_checkout_rate raises CK005; the app's tracking path
--    treats any RPC failure as "no orders found", so a rate-limited
--    lookup shows that state rather than a distinct message.
--  * CAP: at most 50 orders (CUSTOMER_ORDER_LIMIT), newest first.
--    Unbounded history reads are a cost/DoS vector.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run, after a schema-drift check.

-- All orders for one phone, newest first, for guest tracking. Service-role only.
create function public.customer_track_orders_by_phone(p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_phone text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Guest order tracking is not allowed' using errcode = '42501';
  end if;
  v_phone := private.normalize_bd_phone(p_phone);
  if v_phone !~ '^01[3-9][0-9]{8}$' then
    return '[]'::jsonb;
  end if;
  perform private.consume_checkout_rate('track', 'phone:' || v_phone, interval '1 hour', 30);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'order', jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'customer_name', o.customer_name,
        'phone', o.phone,
        'email', o.email,
        'division', o.division,
        'district', o.district,
        'area', o.area,
        'address_line', o.address_line,
        'payment_method', o.payment_method,
        'payment_status', o.payment_status,
        'status', o.status,
        'subtotal_minor', o.subtotal_minor,
        'delivery_charge_minor', o.delivery_charge_minor,
        'discount_minor', o.discount_minor,
        'total_minor', o.total_minor,
        'placed_at', o.placed_at
      ),
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id,
          'order_id', i.order_id,
          'product_id', i.product_id,
          'variant_id', i.variant_id,
          'product_name', i.product_name,
          'size', i.size,
          'color', i.color,
          'unit_price_minor', i.unit_price_minor,
          'quantity', i.quantity,
          'line_total_minor', i.line_total_minor,
          'created_at', i.created_at
        ) order by i.created_at, i.id), '[]'::jsonb)
        from public.order_items i where i.order_id = o.id
      )
    ) order by o.placed_at desc, o.id desc)
    from public.orders o where o.phone = v_phone
    limit 50
  ), '[]'::jsonb);
end $$;
revoke all on function public.customer_track_orders_by_phone(text) from public, anon, authenticated;
grant execute on function public.customer_track_orders_by_phone(text) to service_role;

commit;
