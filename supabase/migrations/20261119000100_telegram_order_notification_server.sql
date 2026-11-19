begin;
-- Admin Panel: Telegram order notifications — server-side read paths.
--
-- PURPOSE: let the app send the owner a Telegram message the moment an
-- order is placed, in the format he gave (AttiresArena brand, AA- order
-- number, customer, delivery address, items, payment). The send itself
-- runs in the app (services/checkout.ts, after the response, via
-- notifyOrderPlaced in lib/admin/telegram.ts). This migration only adds
-- the two database reads that send needs.
--
-- WHY THESE FUNCTIONS EXIST: checkout runs WITHOUT a staff session —
-- guests place orders, and the checkout RPCs run under the service-role
-- key or the customer's own JWT. The existing secret RPC
-- (admin_get_telegram_secret, migration 01200) requires
-- require_admin('settings.manage') + MFA, which can never pass during a
-- guest checkout. So the server needs its own read paths, guarded by
-- caller role instead of by staff permission.
--
-- SECRET-HANDLING DESIGN (same rules as migration 01200):
--  * Both functions refuse every caller except service_role, checked
--    with auth.role() — the same idiom as private.checkout_caller_subject
--    in 20261113000300. Grants go to service_role ONLY; anon and
--    authenticated are revoked, so no browser or signed-in customer can
--    call either function through PostgREST, and the token can never be
--    read from the client.
--  * The token is returned only to the server, only inside
--    sendTelegramMessage's request URL, never logged, never included in
--    an action result, and never stored anywhere else.
--  * Every secret retrieval stays audit-logged (migration 01200's rule):
--    the actor is null because no staff member initiates a server read;
--    the order the notification serves is the audit target, and only the
--    masked chat id travels in the changes payload.
--  * The order payload contains the customer's name, phone, email and
--    address — it goes only to the owner's own Telegram chat (the chat id
--    he saved in the admin settings), never to the customer or any third
--    party. Nothing in this file sends a message; a failed read simply
--    means no notification is sent, and checkout is never affected.
--
-- Additive only. NEVER apply blind: apply only through an explicit,
-- owner-approved migration run, after a schema-drift check.

-- The stored bot token + chat id, for the server-side order notification
-- only. Refuses when unconfigured or disabled. p_order_id is the order
-- the notification serves; it becomes the audit target.
create function public.admin_get_telegram_secret_for_server(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg private.telegram_config;
begin
  if p_order_id is null then
    raise exception 'Order id is required' using errcode = '22023';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Telegram server read is not allowed' using errcode = '42501';
  end if;
  select * into cfg from private.telegram_config where id = true;
  if not found then
    raise exception 'Telegram is not configured' using errcode = '22023';
  end if;
  if not cfg.enabled then
    raise exception 'Telegram alerts are disabled' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (null, 'telegram.secret_retrieved', p_order_id,
    jsonb_build_object('chat_id_masked', '***' || right(cfg.chat_id, 4), 'via', 'server'));
  return jsonb_build_object('bot_token', cfg.bot_token, 'chat_id', cfg.chat_id);
end $$;
revoke all on function public.admin_get_telegram_secret_for_server(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_telegram_secret_for_server(uuid) to service_role;

-- One order, fully rendered for the notification message: customer,
-- delivery address, money, and every item with its stored name, size,
-- color and line total. The app never trusts browser-sent prices or
-- names for the notice; everything here comes from the placed order.
-- Raises when the order does not exist. Service-role only.
create function public.admin_get_order_notification_for_server(p_order_number integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Order notification read is not allowed' using errcode = '42501';
  end if;
  select * into o from public.orders where order_number = p_order_number;
  if not found then
    raise exception 'Order not found' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'customer_name', o.customer_name,
    'phone', o.phone,
    'email', o.email,
    'division', o.division,
    'district', o.district,
    'area', o.area,
    'address_line', o.address_line,
    'subtotal_minor', o.subtotal_minor,
    'delivery_charge_minor', o.delivery_charge_minor,
    'discount_minor', o.discount_minor,
    'total_minor', o.total_minor,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_name', i.product_name,
        'size', i.size,
        'color', i.color,
        'quantity', i.quantity,
        'unit_price_minor', i.unit_price_minor,
        'line_total_minor', i.line_total_minor
      ) order by i.product_name, i.size, i.color), '[]'::jsonb)
      from public.order_items i where i.order_id = o.id
    )
  );
end $$;
revoke all on function public.admin_get_order_notification_for_server(integer) from public, anon, authenticated;
grant execute on function public.admin_get_order_notification_for_server(integer) to service_role;

commit;
