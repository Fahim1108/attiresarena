begin;
-- Admin Panel v2: Telegram bot integration settings (owner item 14).
--
-- Purpose: store ONE Telegram configuration (bot token + chat id) so the
-- owner can confirm delivery with a test message from /admin/system/notifications.
-- No automatic sending exists yet: nothing in this migration, or in the app,
-- sends a Telegram message when an order is placed. The only send path is the
-- explicit "Send test message" Server Action, which runs server-side only.
--
-- SECRET-HANDLING DESIGN (read before applying or reviewing):
--  * The table lives in the `private` schema, following the precedent of
--    private.checkout_settings / private.delivery_locations. PostgREST does
--    not expose the private schema, so the token column is NOT reachable by
--    any direct table read through the API. RLS is enabled, ALL grants are
--    revoked, and NO policy exists: only the SECURITY DEFINER RPCs below can
--    touch the row. RLS alone is not the guarantee here — schema placement +
--    revoked grants + no policies is.
--  * The status RPC (admin_get_telegram_status) returns ONLY: configured,
--    enabled, a masked chat id (last 4 digits), and updated_at. It can never
--    return the token, and the app never displays the token back: the settings
--    form fields are write-only, and saving always replaces the full config.
--  * The secret RPC (admin_get_telegram_secret) DOES return the token, to the
--    server-side test action only. It is the single read path for the token,
--    and it exists because the test message must be sent with the STORED
--    token (the owner must not have to re-paste the secret to test it).
--    RESIDUAL RISK, stated honestly: any holder of the 'settings.manage'
--    permission (owner only, per migration 001) who is MFA-verified (AAL2)
--    could call this RPC directly through PostgREST and retrieve the token.
--    Mitigations: require_admin enforces permission + AAL2; every retrieval
--    is audit-logged (action 'telegram.secret_retrieved', with the masked
--    chat id only — the token is NEVER written to the audit log); the app
--    never forwards the token to the browser, never logs it, and never
--    includes it in any action result. The token is also never stored in
--    store_settings, whose keys are publicly readable by design.
--  * The save/delete RPCs return void and never echo the token. Audit entries
--    for save/delete carry the masked chat id and the enabled flag only.
--
-- Dependencies / apply order: apply AFTER 20261115000100 (which grants
-- 'settings.manage' to the owner). The RPCs reference the permission name
-- only, so this file applies cleanly before 001 but denies access until the
-- 001 grants exist (same pattern as 20261115000500). Also requires
-- private.require_admin / private.has_permission and public.admin_audit_logs
-- (20261027000200) and private.touch_updated_at (foundation). No dependency
-- on the coupon/order migrations. NEVER apply blind: the live schema is
-- unverified, so this file is applied only by an explicit, owner-approved
-- migration run, like the other admin migrations.

create table private.telegram_config (
  id boolean primary key default true,
  bot_token text not null check (length(btrim(bot_token)) between 20 and 200),
  chat_id text not null check (chat_id ~ '^-?[0-9]{5,20}$'),
  enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (id)
);
comment on table private.telegram_config is
  'Single-row Telegram bot configuration (Admin Panel v2, owner item 14). The bot token is a secret: readable only through the admin_get_telegram_secret RPC (settings.manage + MFA, audit-logged), never through direct table reads, never displayed back in the UI, and never stored in store_settings.';
create trigger touch_updated_at before update on private.telegram_config
  for each row execute function private.touch_updated_at();
alter table private.telegram_config enable row level security;
revoke all on private.telegram_config from public, anon, authenticated;
-- No policies and no grants: the RPCs below are the only access path.

-- Save (create or replace) the Telegram configuration. Full replacement:
-- both the token and the chat id are always supplied together, so a partial
-- form can never wipe one half of the config. Returns void, never the token.
create function public.admin_save_telegram_config(p_bot_token text, p_chat_id text, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  clean_token text;
  clean_chat text;
begin
  perform private.require_admin('settings.manage');
  clean_token := btrim(coalesce(p_bot_token, ''));
  clean_chat := btrim(coalesce(p_chat_id, ''));
  if clean_token !~ '^[0-9]{5,}:[A-Za-z0-9_-]{20,}$' or length(clean_token) > 200 then
    raise exception 'Enter a valid Telegram bot token' using errcode = '22023';
  end if;
  if clean_chat !~ '^-?[0-9]{5,20}$' then
    raise exception 'Enter a valid numeric Telegram chat ID' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'Telegram alerts setting is invalid' using errcode = '22023';
  end if;
  insert into private.telegram_config(id, bot_token, chat_id, enabled, updated_by)
  values (true, clean_token, clean_chat, p_enabled, auth.uid())
  on conflict (id) do update set bot_token = excluded.bot_token,
    chat_id = excluded.chat_id, enabled = excluded.enabled,
    updated_by = excluded.updated_by;
  -- admin_audit_logs.target_id is a uuid, so the actor id is recorded there
  -- (same precedent as admin_set_setting) and the masked chat id travels in
  -- the changes payload. The token is never logged.
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'telegram.config_saved', auth.uid(),
    jsonb_build_object('chat_id_masked', '***' || right(clean_chat, 4), 'enabled', p_enabled));
end $$;
revoke all on function public.admin_save_telegram_config(text, text, boolean) from public, anon;
grant execute on function public.admin_save_telegram_config(text, text, boolean) to authenticated;

-- Masked status only. This function can never return the bot token.
create function public.admin_get_telegram_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg private.telegram_config;
begin
  perform private.require_admin('settings.manage');
  select * into cfg from private.telegram_config where id = true;
  if not found then
    return jsonb_build_object('configured', false, 'enabled', false,
      'chat_id_masked', null, 'updated_at', null);
  end if;
  return jsonb_build_object('configured', true, 'enabled', cfg.enabled,
    'chat_id_masked', '***' || right(cfg.chat_id, 4), 'updated_at', cfg.updated_at);
end $$;
revoke all on function public.admin_get_telegram_status() from public, anon;
grant execute on function public.admin_get_telegram_status() to authenticated;

-- The single read path for the stored token, for the server-side test action
-- only. Refuses when unconfigured or disabled. Every call is audit-logged
-- (masked chat id only). See the header comment for the residual risk.
create function public.admin_get_telegram_secret()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg private.telegram_config;
begin
  perform private.require_admin('settings.manage');
  select * into cfg from private.telegram_config where id = true;
  if not found then
    raise exception 'Telegram is not configured' using errcode = '22023';
  end if;
  if not cfg.enabled then
    raise exception 'Telegram alerts are disabled' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'telegram.secret_retrieved', auth.uid(),
    jsonb_build_object('chat_id_masked', '***' || right(cfg.chat_id, 4)));
  return jsonb_build_object('bot_token', cfg.bot_token, 'chat_id', cfg.chat_id);
end $$;
revoke all on function public.admin_get_telegram_secret() from public, anon;
grant execute on function public.admin_get_telegram_secret() to authenticated;

-- Remove the Telegram configuration entirely.
create function public.admin_delete_telegram_config()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin('settings.manage');
  delete from private.telegram_config where id = true;
  if not found then
    raise exception 'Telegram is not configured' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'telegram.config_deleted', auth.uid(), jsonb_build_object());
end $$;
revoke all on function public.admin_delete_telegram_config() from public, anon;
grant execute on function public.admin_delete_telegram_config() to authenticated;

commit;
