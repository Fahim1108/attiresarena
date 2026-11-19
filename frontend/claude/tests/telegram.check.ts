import { describe, expect, it } from "vitest";
import {
  buildOrderNoticeMessage,
  buildTelegramTestMessage,
  maskChatId,
  sendTelegramMessage,
  telegramSendMessageUrl,
  telegramStatusSchema,
  validateTelegramConfig,
} from "../src/lib/admin/telegram";

/* Fake credentials are test fixtures only; they are never real secrets. */
const FAKE_TOKEN = "123456789:AAFakeFakeFakeFakeFakeFakeFakeFake12";
const FAKE_CHAT_ID = "987654321";

describe("telegram config validation", () => {
  it("accepts a well-formed token and chat id, trimming whitespace", () => {
    expect(
      validateTelegramConfig({ botToken: `  ${FAKE_TOKEN}  `, chatId: ` ${FAKE_CHAT_ID} ` }),
    ).toEqual({ ok: true, value: { botToken: FAKE_TOKEN, chatId: FAKE_CHAT_ID } });
  });

  it("accepts negative group chat ids", () => {
    expect(
      validateTelegramConfig({ botToken: FAKE_TOKEN, chatId: "-1001234567890" }).ok,
    ).toBe(true);
  });

  it("rejects malformed tokens", () => {
    expect(validateTelegramConfig({ botToken: "", chatId: FAKE_CHAT_ID }).ok).toBe(false);
    expect(validateTelegramConfig({ botToken: "no-colon-here", chatId: FAKE_CHAT_ID }).ok).toBe(
      false,
    );
    expect(validateTelegramConfig({ botToken: "123:short", chatId: FAKE_CHAT_ID }).ok).toBe(false);
    expect(
      validateTelegramConfig({ botToken: "123456789:bad chars!", chatId: FAKE_CHAT_ID }).ok,
    ).toBe(false);
    expect(validateTelegramConfig({ botToken: null, chatId: FAKE_CHAT_ID }).ok).toBe(false);
  });

  it("rejects malformed chat ids", () => {
    expect(validateTelegramConfig({ botToken: FAKE_TOKEN, chatId: "" }).ok).toBe(false);
    expect(validateTelegramConfig({ botToken: FAKE_TOKEN, chatId: "@channelname" }).ok).toBe(
      false,
    );
    expect(validateTelegramConfig({ botToken: FAKE_TOKEN, chatId: "123" }).ok).toBe(false);
    expect(validateTelegramConfig({ botToken: FAKE_TOKEN, chatId: "12.5" }).ok).toBe(false);
  });

  it("never echoes the token in a validation error", () => {
    const result = validateTelegramConfig({ botToken: "bad", chatId: FAKE_CHAT_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("bad");
  });
});

describe("telegram secret masking", () => {
  it("masks a chat id to its last 4 digits", () => {
    expect(maskChatId("987654321")).toBe("•••4321");
    expect(maskChatId("-1001234567890")).toBe("•••7890");
    expect(maskChatId("123")).toBe("•••");
    expect(maskChatId("987654321")).not.toContain("98765");
  });

  it("the status schema has no field that can carry the bot token", () => {
    const parsed = telegramStatusSchema.safeParse({
      configured: true,
      enabled: true,
      chat_id_masked: "***4321",
      updated_at: "2026-11-15T04:00:00.000Z",
      bot_token: FAKE_TOKEN,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data).sort()).toEqual([
        "chat_id_masked",
        "configured",
        "enabled",
        "updated_at",
      ]);
      expect(JSON.stringify(parsed.data)).not.toContain(FAKE_TOKEN);
    }
  });

  it("rejects malformed status payloads", () => {
    expect(telegramStatusSchema.safeParse(null).success).toBe(false);
    expect(
      telegramStatusSchema.safeParse({
        configured: true,
        enabled: true,
        chat_id_masked: "***4321",
        updated_at: "not a date",
      }).success,
    ).toBe(false);
  });
});

describe("telegram message building", () => {
  it("builds a fixed test message with no credential or customer data", () => {
    const message = buildTelegramTestMessage();
    expect(message).toContain("Attires Arena test notification");
    expect(message).not.toContain(FAKE_TOKEN);
    expect(message).not.toContain(FAKE_CHAT_ID);
  });

  it("builds an order notice in the owner's format, with an AA- number", () => {
    const message = buildOrderNoticeMessage({
      orderNumber: 10001,
      customerName: "Ayesha Rahman",
      customerPhone: "01712345678",
      customerEmail: "ayesha@example.com",
      addressLines: ["House 3, Block B, Tongi", "Tongi, Gazipur, Dhaka"],
      items: [
        { name: "Casual shirt", size: "M", color: "Standard", quantity: 1, lineTotalMinor: 45000 },
      ],
      subtotalMinor: 45000,
      deliveryMinor: 8000,
      discountMinor: 0,
      totalMinor: 53000,
      paymentMethod: "cod",
      paymentStatus: "unpaid",
    });
    expect(message).toContain("🛒 🛒 New Order! — AttiresArena");
    expect(message).toContain("🆔 Order #: AA-10001");
    expect(message).toContain("• Phone: 01712345678");
    expect(message).toContain("• Total: ৳530");
    expect(message).toContain("• Method: COD • Unpaid");
    expect(message).not.toContain("#10001");
  });

  it("builds the Bot API send URL for the given token", () => {
    expect(telegramSendMessageUrl(FAKE_TOKEN)).toBe(
      `https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`,
    );
  });
});

describe("telegram sending (stubbed network)", () => {
  it("sends plain-text JSON and reports success", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    const result = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT_ID,
      text: "hello",
      fetchImpl,
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(telegramSendMessageUrl(FAKE_TOKEN));
    expect(calls[0]!.body).toEqual({
      chat_id: FAKE_CHAT_ID,
      text: "hello",
      disable_web_page_preview: true,
    });
    expect(JSON.stringify(calls[0]!.body)).not.toContain(FAKE_TOKEN);
  });

  it("reports a generic failure when Telegram rejects the message, without the token", async () => {
    const fetchImpl = (async () => ({
      ok: false,
      json: async () => ({ ok: false, description: "chat not found" }),
    })) as unknown as typeof fetch;
    const result = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT_ID,
      text: "hello",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(FAKE_TOKEN);
      expect(result.error).toContain("Telegram");
    }
  });

  it("reports a generic failure when the network throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT_ID,
      text: "hello",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("network down");
  });

  it("times out instead of hanging", async () => {
    const fetchImpl = ((_: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as unknown as typeof fetch;
    const result = await sendTelegramMessage({
      botToken: FAKE_TOKEN,
      chatId: FAKE_CHAT_ID,
      text: "hello",
      fetchImpl,
      timeoutMs: 5,
    });
    expect(result).toEqual({ ok: false, error: "Telegram did not respond in time. Try again." });
  });
});
