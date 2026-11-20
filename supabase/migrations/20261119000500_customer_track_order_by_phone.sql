begin;
-- Guest order tracking: look one order up by order number + phone.
--
-- PURPOSE: the /track-order page was disabled in the app (Track button
-- hardcoded off, "currently unavailable" notice) because the only
-- lookup read the signed-in customer's own orders. Guests place most
-- orders, so they could never track one. This migration adds the
-- single database read the guest lookup needs. It changes no table,
-- no policy, and no existing function.
--
-- WHY THIS FUNCTION EXISTS: the customer client reads orders through
-- RLS `orders_own_read` (authenticated users see only their own
-- user_id rows), and guests have no session at all, so no client-side
-- query can ever return a guest order. The function runs SECURITY
-- DEFINER and checks the phone itself: the order number alone is
-- guessable (5 digits), the phone is the second factor, and both
-- must match exactly before anything is returned.
--
-- SECRET-HANDLING DESIGN (same rules as migration 20261119000100):
--  * The function refuses every caller except service_role, checked
--    with auth.role(). Grants go to service_role ONLY; anon and
--    authenticated are revoked, so no browser or signed-in customer
--    can call it through PostgREST. Only the app server calls it, with
--    the server-only credential, from the getOrderByNumber server
--    action (see lib/customer/tracking.ts).
--  * The phone is normalised inside the function with the existing
--    private.normalize_bd_phone (spaces/dashes stripped, +88/88
--    prefix removed), then must match the strict stored form
--    ^01[3-9][0-9]{8}$ — the same CHECK the orders table enforces.
--    A phone that does not normalise to that form, or an order
--    number outside 10000-99999, yields NULL, exactly like an
--    unknown order: the caller can never tell which part was wrong.
--  * The returned payload contains ONLY the columns the customer
--    order read already selects (CUSTOMER_ORDER_COLUMNS /
--    CUSTOMER_ORDER_ITEM_COLUMNS in lib/customer/orders.ts). The
--    order note is never returned (it can hold payment details),
--    user_id and checkout_session_id are never returned, and the SKU
--    column is never returned. Courier columns are never returned:
--    shipment records live in the staff-only order_shipments table.
--  * A miss returns NULL, never an error: the page shows the same
--    "Order not found" state for an unknown number, a wrong phone,
--    and a missing order alike.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run, after a schema-drift check.

-- One order by number + phone, for guest tracking. Service-role only.
create function public.customer_track_order_by_phone(p_order_number integer, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_phone text;
  o public.orders;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Guest order tracking is not allowed' using errcode = '42501';
  end if;
  if p_order_number is null or p_order_number < 10000 or p_order_number > 99999 then
    return null;
  end if;
  v_phone := private.normalize_bd_phone(p_phone);
  if v_phone !~ '^01[3-9][0-9]{8}$' then
    return null;
  end if;
  select * into o from public.orders
    where order_number = p_order_number and phone = v_phone;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
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
  );
end $$;
revoke all on function public.customer_track_order_by_phone(integer, text) from public, anon, authenticated;
grant execute on function public.customer_track_order_by_phone(integer, text) to service_role;

commit;
