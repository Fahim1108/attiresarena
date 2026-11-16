import "server-only";

import { revalidatePath } from "next/cache";
import nodemailer from "nodemailer";
import { z } from "zod";
import { requireStaff, actionOk, actionError, toActionError, type AdminActionResult, type StaffSession } from "./authorization";
import { areaRoles } from "./constants";

/* ------------------------------------------------------------------ */
/* SMTP settings + test-send ONLY — a DISTINCT REMOVABLE MODULE.       */
/*                                                                     */
/* KEEP-OR-DROP IS UNDECIDED by the owner. Removal, in full: (1) delete
   this file + FE/src/components/admin/smtp/ + the /admin/system/smtp
   page + the test file FE/tests/smtp.check.ts; (2) remove the ONE nav
   link in AdminShell.tsx AND its now-unused `Mail` icon import
   (otherwise lint fails on the unused import); (3) remove the
   `nodemailer` + `@types/nodemailer` dependencies from
   FE/package.json and regenerate the lockfile; (4) drop the database
   objects in THIS ORDER — the four functions first, then the
   private.smtp_config table (the functions reference the table, so
   dropping the table first fails unless CASCADE is used). No other
   module imports this file; no shared settings file is extended
   (non-secret prefs live in the private table too, so admin_set_setting
   is untouched). */
/*                                                                     */
/* NO TRIGGER WIRING: nothing sends email on checkout, order changes,  */
/* or any other event. The ONLY send path is the explicit test action  */
/* below, server-side only, to an owner-entered address. NO SMS        */
/* anywhere in this module (the owner cancelled SMS).                  */
/*                                                                     */
/* The SMTP password is a SECRET: stored only in private.smtp_config   */
/* (migration 20261116000400), never displayed back, never returned    */
/* by the status read, never logged, never included in any action      */
/* result. See the migration header for the residual-risk disclosure.  */
/*                                                                     */
/* DEPENDENCY JUSTIFICATION: nodemailer is the standard Node SMTP      */
/* library; hand-rolled SMTP over raw sockets would be riskier (TLS,   */
/* AUTH, dot-stuffing, retries). ALL nodemailer usage stays inside     */
/* this file. Tests use nodemailer's stub transports (stream/json)     */
/* via transport-factory injection — no real mail, ever.               */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Pure helpers (covered by tests/smtp.check.ts)                       */
/* ------------------------------------------------------------------ */

export const SMTP_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_HOST_LENGTH = 255;
const MAX_USERNAME_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 500;

export interface SmtpSettingsInput {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  enabled: boolean;
}

export type SmtpSettingsValidation =
  | { ok: true; value: SmtpSettingsInput }
  | { ok: false; error: string };

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "on" || value === "true") return true;
  if (value === "off" || value === "false" || value === null || value === undefined) return false;
  return null;
}

/**
 * Validate + normalize submitted settings. Mirrors the CHECKs enforced
 * by admin_save_smtp_config exactly; if the SQL changes, this function
 * and its tests must change with it. The password is never trimmed
 * (spaces can be meaningful) and is never returned on failure.
 */
export function validateSmtpSettings(input: {
  host: unknown;
  port: unknown;
  secure: unknown;
  username: unknown;
  password: unknown;
  fromAddress: unknown;
  enabled: unknown;
}): SmtpSettingsValidation {
  const host = typeof input.host === "string" ? input.host.trim() : "";
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const fromAddress = typeof input.fromAddress === "string" ? input.fromAddress.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const portRaw = typeof input.port === "string" ? input.port.trim() : input.port;
  const port = typeof portRaw === "number" ? portRaw : Number(portRaw);
  const secure = toBoolean(input.secure);
  const enabled = toBoolean(input.enabled);

  if (host === "" || host.length > MAX_HOST_LENGTH || /\s/.test(host)) {
    return { ok: false, error: "Enter a valid SMTP host, for example smtp.example.com." };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "Enter a valid SMTP port between 1 and 65535." };
  }
  if (secure === null || enabled === null) {
    return { ok: false, error: "SMTP settings are invalid. Reload and try again." };
  }
  if (username === "" || username.length > MAX_USERNAME_LENGTH) {
    return { ok: false, error: "Enter a valid SMTP username." };
  }
  if (password.length < 1 || password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: "Enter the SMTP password." };
  }
  if (!SMTP_EMAIL_PATTERN.test(fromAddress) || fromAddress.length > MAX_USERNAME_LENGTH) {
    return { ok: false, error: "Enter a valid sender email address." };
  }
  return {
    ok: true,
    value: { host, port, secure, username, password, fromAddress, enabled },
  };
}

/**
 * The status shape is deliberately credential-free: there is no field
 * that could carry the password or username, so no read path can leak
 * them by accident.
 */
export const smtpStatusSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  secure: z.boolean(),
  from_address: z.string().nullable(),
  updated_at: z.iso.datetime({ offset: true }).nullable(),
});

export type SmtpStatus = z.infer<typeof smtpStatusSchema>;

const smtpSecretSchema = z.object({
  host: z.string().min(1),
  port: z.number().int(),
  secure: z.boolean(),
  username: z.string().min(1),
  password: z.string().min(1),
  from_address: z.string().min(1),
});

export type SmtpSecret = z.infer<typeof smtpSecretSchema>;

/** Fixed test message. Carries no order, customer, or credential data. */
export function buildSmtpTestMessage(to: string, fromAddress: string) {
  return {
    from: fromAddress,
    to,
    subject: "Attires Arena test email",
    text: "This is a test email from Attires Arena. Your SMTP settings are connected — this message confirms the mail server can deliver. No order or customer data is included.",
  };
}

export function isValidTestRecipient(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SMTP_EMAIL_PATTERN.test(value.trim()) &&
    value.trim().length <= MAX_USERNAME_LENGTH
  );
}

/* ------------------------------------------------------------------ */
/* Sending (transport-factory injection so tests use stub transports)  */
/* ------------------------------------------------------------------ */

export interface SmtpTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<unknown>;
  close?: () => void | Promise<void>;
}

export type SmtpTransportFactory = (secret: SmtpSecret) => SmtpTransport;

const SMTP_CONNECTION_TIMEOUT_MS = 10_000;

function defaultTransportFactory(secret: SmtpSecret): SmtpTransport {
  return nodemailer.createTransport({
    host: secret.host,
    port: secret.port,
    secure: secret.secure,
    auth: { user: secret.username, pass: secret.password },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    // A server that accepts the TCP connection but never greets or
    // never answers must not hang the test action until the platform
    // timeout: cap the greeting wait and socket inactivity too.
    greetingTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    socketTimeout: SMTP_CONNECTION_TIMEOUT_MS,
  });
}

export type SmtpSendResult = { ok: true } | { ok: false; error: string };

/**
 * Send ONE test email with the stored credentials. Errors are generic
 * and never include credentials, the recipient address, or provider
 * internals. `transportFactory` exists so tests can substitute
 * nodemailer's stub transports (stream/json) without touching the
 * network; production always uses the default SMTP factory.
 */
export async function sendSmtpTestMail(input: {
  secret: SmtpSecret;
  to: string;
  transportFactory?: SmtpTransportFactory;
}): Promise<SmtpSendResult> {
  const factory = input.transportFactory ?? defaultTransportFactory;
  const transport = factory(input.secret);
  try {
    await transport.sendMail(buildSmtpTestMessage(input.to.trim(), input.secret.from_address));
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        "The test email could not be sent. Check the SMTP host, port, security setting and credentials, then try again.",
    };
  } finally {
    try {
      await transport.close?.();
    } catch {
      // Closing a failed transport must never mask the send result.
    }
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/*                                                                     */
/* Status returns null when unavailable (migration unapplied / RPC     */
/* missing / malformed), so the page degrades honestly instead of      */
/* throwing into the error boundary.                                   */
/* ------------------------------------------------------------------ */

export async function readSmtpStatus(): Promise<SmtpStatus | null> {
  const session = await requireStaff(areaRoles("settings"));
  const result = await session.client.rpc("admin_get_smtp_status");
  if (result.error) return null;
  const parsed = smtpStatusSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

type StaffClient = StaffSession["client"];

/**
 * Fetch the stored credentials for the server-side test send ONLY. The
 * caller must have already verified the configuration exists and is
 * enabled via readSmtpStatus. Returns null on any failure; the
 * credentials never leave this module except inside the SMTP transport.
 */
async function fetchSmtpSecret(client: StaffClient): Promise<SmtpSecret | null> {
  const result = await client.rpc("admin_get_smtp_secret");
  if (result.error) return null;
  const parsed = smtpSecretSchema.safeParse(result.data);
  if (!parsed.success) return null;
  return parsed.data;
}

/* ------------------------------------------------------------------ */
/* Server Actions (writes go through RPCs only; settings.manage area)  */
/* ------------------------------------------------------------------ */

export async function saveSmtpConfig(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const validated = validateSmtpSettings({
    host: formData.get("host"),
    port: formData.get("port"),
    secure: formData.get("secure"),
    username: formData.get("username"),
    password: formData.get("password"),
    fromAddress: formData.get("from_address"),
    enabled: formData.get("enabled"),
  });
  if (!validated.ok) return actionError(validated.error);
  const session = await requireStaff(areaRoles("settings"));
  const result = await session.client.rpc("admin_save_smtp_config", {
    p_host: validated.value.host,
    p_port: validated.value.port,
    p_secure: validated.value.secure,
    p_username: validated.value.username,
    p_password: validated.value.password,
    p_from_address: validated.value.fromAddress,
    p_enabled: validated.value.enabled,
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "SMTP settings could not be saved. Check your access and try again."),
    );
  }
  revalidatePath("/admin/system/smtp");
  return actionOk(
    "SMTP settings saved. The password is stored as a secret and is never shown again. Send a test email to confirm delivery.",
  );
}

export async function sendSmtpTest(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const to = formData.get("test_email");
  if (!isValidTestRecipient(to)) {
    return actionError("Enter a valid email address to send the test email to.");
  }
  const session = await requireStaff(areaRoles("settings"));
  // Sending happens ONLY when configured and enabled; both facts come
  // from the masked status read, never from client input.
  const statusResult = await session.client.rpc("admin_get_smtp_status");
  const status = statusResult.error
    ? null
    : smtpStatusSchema.safeParse(statusResult.data).data ?? null;
  if (!status || !status.configured) {
    return actionError("SMTP is not configured. Save the SMTP settings first.");
  }
  if (!status.enabled) {
    return actionError("SMTP is disabled. Enable it in the settings above, then try again.");
  }
  const secret = await fetchSmtpSecret(session.client);
  if (!secret) {
    return actionError("SMTP settings could not be read. Save them again and try once more.");
  }
  const sent = await sendSmtpTestMail({ secret, to: to.trim() });
  if (!sent.ok) return actionError(sent.error);
  return actionOk("Test email sent. Check the inbox to confirm it arrived.");
}

export async function deleteSmtpConfig(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  // The confirmation dialog posts confirm=1; anything else is refused so
  // the settings can never be removed from a stray submission.
  if (formData.get("confirm") !== "1") {
    return actionError("Confirm the removal in the dialog before removing the settings.");
  }
  const session = await requireStaff(areaRoles("settings"));
  const result = await session.client.rpc("admin_delete_smtp_config");
  if (result.error) {
    return actionError(
      toActionError(result.error, "SMTP settings could not be removed. Try again."),
    );
  }
  revalidatePath("/admin/system/smtp");
  return actionOk("SMTP settings removed. No email will be sent from this panel.");
}
