import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import { readFile } from "node:fs/promises";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSmtpTestMessage,
  isValidTestRecipient,
  sendSmtpTestMail,
  smtpStatusSchema,
  validateSmtpSettings,
  type SmtpSecret,
} from "../src/lib/admin/smtp";

/* Fake credentials are test fixtures only; they are never real secrets. */
const FAKE_SECRET: SmtpSecret = {
  host: "smtp.example.invalid",
  port: 465,
  secure: true,
  username: "mailbox@example.invalid",
  password: "placeholder-password-for-tests",
  from_address: "hello@example.invalid",
};

const VALID_FORM = {
  host: "smtp.example.invalid",
  port: "465",
  secure: "on",
  username: "mailbox@example.invalid",
  password: "placeholder-password-for-tests",
  fromAddress: "hello@example.invalid",
  enabled: "on",
};

describe("smtp settings validation", () => {
  it("accepts well-formed settings, trimming text and coercing the port", () => {
    expect(
      validateSmtpSettings({ ...VALID_FORM, host: "  smtp.example.invalid  " }),
    ).toEqual({
      ok: true,
      value: {
        host: "smtp.example.invalid",
        port: 465,
        secure: true,
        username: "mailbox@example.invalid",
        password: "placeholder-password-for-tests",
        fromAddress: "hello@example.invalid",
        enabled: true,
      },
    });
  });

  it("accepts numeric ports and boolean flags", () => {
    const result = validateSmtpSettings({
      ...VALID_FORM,
      port: 587,
      secure: false,
      enabled: true,
    });
    expect(result).toMatchObject({ ok: true, value: { port: 587, secure: false, enabled: true } });
  });

  it("rejects malformed hosts, ports, usernames and sender addresses", () => {
    expect(validateSmtpSettings({ ...VALID_FORM, host: "" }).ok).toBe(false);
    expect(validateSmtpSettings({ ...VALID_FORM, host: "smtp exam ple" }).ok).toBe(false);
    expect(validateSmtpSettings({ ...VALID_FORM, host: "h".repeat(256) }).ok).toBe(false);
    expect(validateSmtpSettings({ ...VALID_FORM, port: "0" }).ok).toBe(false);
    expect(validateSmtpSettings({ ...VALID_FORM, port: "65536" }).ok).toBe(false);
    expect(validateSmtpSettings({ ...VALID_FORM, port: "abc" }).ok).toBe(false);
    expect(validateSmtpSettings({ ...VALID_FORM, port: "46.5" }).ok).toBe(false);
    expect(validateSmtpSettings({ ...VALID_FORM, username: "" }).ok).toBe(false);
    expect(validateSmtpSettings({ ...VALID_FORM, fromAddress: "not-an-email" }).ok).toBe(false);
    expect(validateSmtpSettings({ ...VALID_FORM, fromAddress: "a@b" }).ok).toBe(false);
  });

  it("rejects a missing or over-long password without echoing it", () => {
    expect(validateSmtpSettings({ ...VALID_FORM, password: "" }).ok).toBe(false);
    const longPassword = `distinctive-${"p".repeat(500)}`;
    const result = validateSmtpSettings({ ...VALID_FORM, password: longPassword });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain(longPassword);
    const bad = validateSmtpSettings({ ...VALID_FORM, password: "", host: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).not.toContain(FAKE_SECRET.password);
  });
});

describe("smtp status shape", () => {
  it("has no field that can carry the password or username", () => {
    const parsed = smtpStatusSchema.safeParse({
      configured: true,
      enabled: true,
      host: "smtp.example.invalid",
      port: 465,
      secure: true,
      from_address: "hello@example.invalid",
      updated_at: "2026-11-16T07:00:00.000Z",
      password: FAKE_SECRET.password,
      username: FAKE_SECRET.username,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data).sort()).toEqual([
        "configured",
        "enabled",
        "from_address",
        "host",
        "port",
        "secure",
        "updated_at",
      ]);
      expect(JSON.stringify(parsed.data)).not.toContain(FAKE_SECRET.password);
      expect(JSON.stringify(parsed.data)).not.toContain(FAKE_SECRET.username);
    }
  });

  it("rejects malformed status payloads", () => {
    expect(smtpStatusSchema.safeParse(null).success).toBe(false);
    expect(
      smtpStatusSchema.safeParse({
        configured: true,
        enabled: true,
        host: "smtp.example.invalid",
        port: "465",
        secure: true,
        from_address: "hello@example.invalid",
        updated_at: "2026-11-16T07:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("smtp test message", () => {
  it("builds a fixed test message with no credential or customer data", () => {
    const message = buildSmtpTestMessage("owner@example.invalid", "hello@example.invalid");
    expect(message.from).toBe("hello@example.invalid");
    expect(message.to).toBe("owner@example.invalid");
    expect(message.subject).toBe("Attires Arena test email");
    expect(message.text).toContain("test email");
    expect(message.text).not.toContain(FAKE_SECRET.password);
    expect(message.text).not.toContain(FAKE_SECRET.username);
  });

  it("validates test recipients strictly", () => {
    expect(isValidTestRecipient("owner@example.invalid")).toBe(true);
    expect(isValidTestRecipient("  owner@example.invalid  ")).toBe(true);
    expect(isValidTestRecipient("not-an-email")).toBe(false);
    expect(isValidTestRecipient("")).toBe(false);
    expect(isValidTestRecipient(null)).toBe(false);
  });
});

describe("smtp test sending (stub transports only — no real mail)", () => {
  it("sends through nodemailer's jsonTransport stub and reports success", async () => {
    const seen: { secret: SmtpSecret; message: unknown }[] = [];
    const result = await sendSmtpTestMail({
      secret: FAKE_SECRET,
      to: "owner@example.invalid",
      transportFactory: (secret) => {
        const transport = nodemailer.createTransport({ jsonTransport: true });
        return {
          sendMail: async (message: { from: string; to: string; subject: string; text: string }) => {
            seen.push({ secret, message });
            return transport.sendMail(message);
          },
          close: () => transport.close(),
        };
      },
    });
    expect(result).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.secret).toEqual(FAKE_SECRET);
    expect(seen[0]!.message).toMatchObject({
      from: "hello@example.invalid",
      to: "owner@example.invalid",
      subject: "Attires Arena test email",
    });
  });

  it("sends through nodemailer's streamTransport stub", async () => {
    const result = await sendSmtpTestMail({
      secret: FAKE_SECRET,
      to: "owner@example.invalid",
      transportFactory: () => {
        const transport = nodemailer.createTransport({
          streamTransport: true,
          newline: "unix",
          buffer: true,
        });
        return {
          sendMail: (message: { from: string; to: string; subject: string; text: string }) =>
            transport.sendMail(message),
          close: () => transport.close(),
        };
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it("reports a generic failure when sending throws, without secrets or provider detail", async () => {
    const result = await sendSmtpTestMail({
      secret: FAKE_SECRET,
      to: "owner@example.invalid",
      transportFactory: () => ({
        sendMail: async () => {
          throw new Error("535 Authentication failed for mailbox@example.invalid");
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("could not be sent");
      expect(result.error).not.toContain("535");
      expect(result.error).not.toContain(FAKE_SECRET.username);
      expect(result.error).not.toContain(FAKE_SECRET.password);
    }
  });

  it("closes the transport even when sending fails", async () => {
    let closed = false;
    const result = await sendSmtpTestMail({
      secret: FAKE_SECRET,
      to: "owner@example.invalid",
      transportFactory: () => ({
        sendMail: async () => {
          throw new Error("boom");
        },
        close: () => {
          closed = true;
        },
      }),
    });
    expect(result.ok).toBe(false);
    expect(closed).toBe(true);
  });
});

describe("smtp migration 20261116000400", () => {
  it("stores credentials in a private table with RPC-only access, mirroring Telegram", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const sql = await readFile(
      join(root, "supabase", "migrations", "20261116000400_admin_smtp_config.sql"),
      "utf8",
    );
    expect(sql).toContain("create table private.smtp_config");
    expect(sql).toContain("revoke all on private.smtp_config from public, anon, authenticated");
    expect(sql).toContain("create function public.admin_save_smtp_config");
    expect(sql).toContain("create function public.admin_get_smtp_status()");
    expect(sql).toContain("create function public.admin_get_smtp_secret()");
    expect(sql).toContain("create function public.admin_delete_smtp_config()");
    expect(sql).toContain("perform private.require_admin('settings.manage')");
    expect(sql).toContain("'smtp.config_saved'");
    expect(sql).toContain("'smtp.secret_retrieved'");
    expect(sql).not.toContain("insert into public.store_settings");
    // The header mentions admin_set_setting only to say it is untouched;
    // the migration must never call or redefine it.
    expect(sql).not.toContain("admin_set_setting(");
    expect(sql).toContain("REMOVABLE MODULE");
    expect(/^begin;/m.test(sql)).toBe(true);
    expect(/^commit;/m.test(sql)).toBe(true);
  });
});

describe("smtp transport timeouts (S3)", () => {
  it("caps the greeting wait and socket inactivity, not just the connection", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const smtpLib = readFileSync(join(root, "src/lib/admin/smtp.ts"), "utf8");
    expect(smtpLib).toContain("connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS");
    expect(smtpLib).toContain("greetingTimeout: SMTP_CONNECTION_TIMEOUT_MS");
    expect(smtpLib).toContain("socketTimeout: SMTP_CONNECTION_TIMEOUT_MS");
  });
});

describe("smtp password hint (S1)", () => {
  it("tells staff the password is required on every save (full replacement)", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const form = readFileSync(
      join(root, "src/components/admin/smtp/SmtpSettingsForm.tsx"),
      "utf8",
    );
    expect(form).toContain("Enter the password every time you save");
    expect(form).toContain("saving replaces");
    expect(form).not.toContain("leave nothing here");
    expect(form).not.toContain("unless you are replacing it");
  });
});

describe("smtp removal steps (S2)", () => {
  it("lists every removal step in the migration header and the module header", async () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const sql = await readFile(
      join(repoRoot, "supabase", "migrations", "20261116000400_admin_smtp_config.sql"),
      "utf8",
    );
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const smtpLib = readFileSync(join(root, "src/lib/admin/smtp.ts"), "utf8");
    for (const doc of [sql, smtpLib]) {
      expect(doc).toContain("tests/smtp.check.ts");
      expect(doc).toContain("nodemailer");
      expect(doc).toContain("@types/nodemailer");
      expect(doc).toContain("Mail");
      // Drop order: functions before the table (or CASCADE).
      expect(doc).toMatch(/functions first, then the/);
      expect(doc).toContain("CASCADE");
    }
  });
});

describe("smtp module removability (file organization)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");

  function walk(dir: string, files: string[] = []): string[] {
    for (const entry of readdirSync(join(root, dir))) {
      const rel = `${dir}/${entry}`;
      const stat = statSync(join(root, rel));
      if (stat.isDirectory()) walk(rel, files);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(rel);
    }
    return files;
  }

  it("is imported only by its own page, its own form, and its tests", () => {
    const importers: string[] = [];
    for (const file of walk("src")) {
      const source = readFileSync(join(root, file), "utf8");
      if (/(from\s+["']@\/lib\/admin\/smtp["']|from\s+["']\.\.?\/.*smtp["'])/.test(source)) {
        importers.push(file);
      }
    }
    expect(importers.sort()).toEqual(
      [
        "src/app/admin/(workspace)/system/smtp/page.tsx",
        "src/components/admin/smtp/SmtpSettingsForm.tsx",
      ].sort(),
    );
  });

  it("has exactly one nav-link touchpoint in shared files", () => {
    const shell = readFileSync(join(root, "src/components/admin/access/AdminShell.tsx"), "utf8");
    expect(shell.match(/\/admin\/system\/smtp/g)).toHaveLength(1);
    expect(shell).toContain('label: "Email (SMTP)"');
  });

  it("extends no shared settings file and wires no trigger into orders/checkout", () => {
    for (const file of [
      "src/lib/admin/settings.ts",
      "src/lib/admin/settings-shared.ts",
      "src/lib/admin/orders.ts",
      "src/lib/checkout/service.ts",
    ]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).not.toMatch(/smtp/i);
    }
    const smtpLib = readFileSync(join(root, "src/lib/admin/smtp.ts"), "utf8");
    expect(smtpLib).not.toContain("marketing_secrets");
    expect(smtpLib).not.toMatch(/sendSms|SmsSecret/);
  });

  it("keeps all nodemailer usage inside the SMTP module", () => {
    const users: string[] = [];
    for (const file of walk("src")) {
      const source = readFileSync(join(root, file), "utf8");
      if (source.includes("nodemailer")) users.push(file);
    }
    expect(users).toEqual(["src/lib/admin/smtp.ts"]);
  });
});
