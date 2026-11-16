begin;
-- Admin Panel: SMTP settings as a DISTINCT REMOVABLE MODULE (orders +
-- courier build). KEEP-OR-DROP IS UNDECIDED by the owner.
--
-- SCOPE: generic SMTP settings form + test-send ONLY, following the
-- Telegram pattern (migration 20261115001200). NO trigger wiring to
-- checkout/orders exists: nothing in this migration, or in the app,
-- sends an email when an order is placed or changes. The only send path
-- is the explicit "Send test email" Server Action, which runs
-- server-side only, to an owner-entered address.
--
-- REMOVAL: if the owner drops SMTP, removal is, in full: (1) delete
-- the SMTP module files (FE/src/lib/admin/smtp.ts,
-- FE/src/components/admin/smtp/, FE/src/app/admin/(workspace)/system/
-- smtp/) and the test file FE/tests/smtp.check.ts; (2) remove the ONE
-- nav link in AdminShell.tsx AND its now-unused `Mail` icon import
-- (otherwise lint fails on the unused import); (3) remove the
-- `nodemailer` + `@types/nodemailer` dependencies from
-- FE/package.json and regenerate the lockfile; (4) drop the database
-- objects in THIS ORDER — the four functions first, then the table
-- (the functions reference private.smtp_config, so dropping the table
-- first fails unless CASCADE is used). No other module imports SMTP
-- code, and no shared settings file is extended by this module
-- (non-secret prefs live in the private table too, deliberately, so
-- admin_set_setting is untouched).
--
-- SECRET-HANDLING DESIGN (same as Telegram, migration 012 — read before
-- applying or reviewing):
--  * The table lives in the `private` schema. PostgREST does not expose
--    the private schema, so the password column is NOT reachable by any
--    direct table read through the API. RLS is enabled, ALL grants are
--    revoked, and NO policy exists: only the SECURITY DEFINER RPCs below
--    can touch the row. RLS alone is not the guarantee here — schema
--    placement + revoked grants + no policies is.
--  * The status RPC (admin_get_smtp_status) returns ONLY: configured,
--    enabled, host, port, secure, from_address, updated_at. It can never
--    return the password or the username, and the app never displays the
--    password back: the settings form password field is write-only, and
--    saving always replaces the full configuration.
--  * The secret RPC (admin_get_smtp_secret) DOES return the credentials,
--    to the server-side test action only. It exists because the test
--    email must be sent with the STORED credentials (the owner must not
--    have to re-paste the secret to test it). RESIDUAL RISK, stated
--    honestly: any holder of the 'settings.manage' permission (owner
--    only, per migration 001) who is MFA-verified (AAL2) could call this
--    RPC directly through PostgREST and retrieve the credentials.
--    Mitigations: require_admin enforces permission + AAL2; every
--    retrieval is audit-logged (action 'smtp.secret_retrieved', with the
--    host only — credentials are NEVER written to the audit log); the
--    app never forwards credentials to the browser, never logs them, and
--    never includes them in any action result. Credentials are also
--    never stored in store_settings, whose keys are publicly readable
--    by design.
--  * The save/delete RPCs return void and never echo credentials. Audit
--    entries for save carry host/port/secure/enabled/from only.
--
-- Dependencies / apply order: apply AFTER 20261115000100 (which grants
-- 'settings.manage' to the owner). The RPCs reference the permission
-- name only, so this file applies cleanly before 001 but denies access
-- until the 001 grants exist (same pattern as 20261115000500). Also
-- requires private.require_admin / private.has_permission and
-- public.admin_audit_logs (20261027000200) and private.touch_updated_at
-- (foundation). No dependency on the order/coupon migrations or on
-- unapplied migrations 014/015. NEVER apply blind: the live schema is
-- unverified, so this file is applied only by an explicit, owner-approved
-- migration run, like the other admin migrations.

create table private.smtp_config (
  id boolean primary key default true,
  host text not null check (length(btrim(host)) between 1 and 255 and host !~ '\s'),
  port integer not null check (port between 1 and 65535),
  secure boolean not null default true,
  username text not null check (length(btrim(username)) between 1 and 254),
  password text not null check (length(password) between 1 and 500),
  from_address text not null check (from_address ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(from_address) <= 254),
  enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (id)
);
comment on table private.smtp_config is
  'Single-row SMTP configuration (distinct removable module; keep-or-drop undecided). The password is a secret: readable only through the admin_get_smtp_secret RPC (settings.manage + MFA, audit-logged), never through direct table reads, never displayed back in the UI, and never stored in store_settings. No automatic sending exists; only the explicit test send uses these settings.';
create trigger touch_updated_at before update on private.smtp_config
  for each row execute function private.touch_updated_at();
alter table private.smtp_config enable row level security;
revoke all on private.smtp_config from public, anon, authenticated;
-- No policies and no grants: the RPCs below are the only access path.

-- Save (create or replace) the SMTP configuration. Full replacement: all
-- fields are always supplied together, so a partial form can never wipe
-- one half of the config. Returns void, never the credentials.
create function public.admin_save_smtp_config(p_host text, p_port integer, p_secure boolean, p_username text, p_password text, p_from_address text, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  clean_host text;
  clean_username text;
  clean_from text;
begin
  perform private.require_admin('settings.manage');
  clean_host := btrim(coalesce(p_host, ''));
  clean_username := btrim(coalesce(p_username, ''));
  clean_from := btrim(coalesce(p_from_address, ''));
  if clean_host = '' or length(clean_host) > 255 or clean_host ~ '\s' then
    raise exception 'Enter a valid SMTP host' using errcode = '22023';
  end if;
  if p_port is null or p_port < 1 or p_port > 65535 then
    raise exception 'Enter a valid SMTP port (1-65535)' using errcode = '22023';
  end if;
  if p_secure is null or p_enabled is null then
    raise exception 'SMTP settings are invalid' using errcode = '22023';
  end if;
  if clean_username = '' or length(clean_username) > 254 then
    raise exception 'Enter a valid SMTP username' using errcode = '22023';
  end if;
  if p_password is null or length(p_password) < 1 or length(p_password) > 500 then
    raise exception 'Enter the SMTP password' using errcode = '22023';
  end if;
  if clean_from !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(clean_from) > 254 then
    raise exception 'Enter a valid sender email address' using errcode = '22023';
  end if;
  insert into private.smtp_config(id, host, port, secure, username, password, from_address, enabled, updated_by)
  values (true, clean_host, p_port, p_secure, clean_username, p_password, clean_from, p_enabled, auth.uid())
  on conflict (id) do update set host = excluded.host,
    port = excluded.port, secure = excluded.secure, username = excluded.username,
    password = excluded.password, from_address = excluded.from_address,
    enabled = excluded.enabled, updated_by = excluded.updated_by;
  -- admin_audit_logs.target_id is a uuid, so the actor id is recorded there
  -- (same precedent as admin_set_setting) and the host travels in the
  -- changes payload. Credentials are never logged.
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'smtp.config_saved', auth.uid(),
    jsonb_build_object('host', clean_host, 'port', p_port, 'secure', p_secure, 'from_address', clean_from, 'enabled', p_enabled));
end $$;
revoke all on function public.admin_save_smtp_config(text, integer, boolean, text, text, text, boolean) from public, anon;
grant execute on function public.admin_save_smtp_config(text, integer, boolean, text, text, text, boolean) to authenticated;

-- Masked status only. This function can never return the password or username.
create function public.admin_get_smtp_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg private.smtp_config;
begin
  perform private.require_admin('settings.manage');
  select * into cfg from private.smtp_config where id = true;
  if not found then
    return jsonb_build_object('configured', false, 'enabled', false,
      'host', null, 'port', null, 'secure', false, 'from_address', null,
      'updated_at', null);
  end if;
  return jsonb_build_object('configured', true, 'enabled', cfg.enabled,
    'host', cfg.host, 'port', cfg.port, 'secure', cfg.secure,
    'from_address', cfg.from_address, 'updated_at', cfg.updated_at);
end $$;
revoke all on function public.admin_get_smtp_status() from public, anon;
grant execute on function public.admin_get_smtp_status() to authenticated;

-- The single read path for the stored credentials, for the server-side
-- test action only. Refuses when unconfigured or disabled. Every call is
-- audit-logged (host only). See the header comment for the residual risk.
create function public.admin_get_smtp_secret()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg private.smtp_config;
begin
  perform private.require_admin('settings.manage');
  select * into cfg from private.smtp_config where id = true;
  if not found then
    raise exception 'SMTP is not configured' using errcode = '22023';
  end if;
  if not cfg.enabled then
    raise exception 'SMTP is disabled' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'smtp.secret_retrieved', auth.uid(),
    jsonb_build_object('host', cfg.host));
  return jsonb_build_object('host', cfg.host, 'port', cfg.port, 'secure', cfg.secure,
    'username', cfg.username, 'password', cfg.password, 'from_address', cfg.from_address);
end $$;
revoke all on function public.admin_get_smtp_secret() from public, anon;
grant execute on function public.admin_get_smtp_secret() to authenticated;

-- Remove the SMTP configuration entirely.
create function public.admin_delete_smtp_config()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin('settings.manage');
  delete from private.smtp_config where id = true;
  if not found then
    raise exception 'SMTP is not configured' using errcode = '22023';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, changes)
  values (auth.uid(), 'smtp.config_deleted', auth.uid(), jsonb_build_object());
end $$;
revoke all on function public.admin_delete_smtp_config() from public, anon;
grant execute on function public.admin_delete_smtp_config() to authenticated;

commit;
