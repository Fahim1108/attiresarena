import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, actionOk, actionError, toActionError, type AdminActionResult, type StaffSession } from "./authorization";
import { areaRoles } from "./constants";
import { formatMoneyShort, formatOrderNumber } from "./format";

/* ------------------------------------------------------------------ */
/* Telegram bot integration (owner item 14).                           */
/*                                                                     */
/* The bot token is a SECRET: it is stored only in private.telegram_   */
/* config (migration 20261115001200), it is never displayed back,      */
/* never returned by the status read, never logged, and never included */
/* in any action result. There are two send paths, both server-side:   */
/* the explicit test action below (staff-initiated, staff secret RPC)  */
/* and the automatic new-order notice (notifyOrderPlaced, service-role */
/* secret RPC from migration 20261119000100 — checkout has no staff    */
/* session, so the server reads the secret as service_role). A failed  */
/* notification never breaks checkout: notifyOrderPlaced returns      */
/* false and logs a generic line instead of throwing.                  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Pure helpers (covered by tests/telegram.check.ts)                   */
/* ------------------------------------------------------------------ */

/**
 * Telegram bot token shape: a numeric bot id, a colon, then the secret
 * part. Mirrors the CHECK enforced by admin_save_telegram_config exactly;
 * if the SQL changes, this pattern and its tests must change with it.
 */
export const TELEGRAM_TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;
export const TELEGRAM_CHAT_ID_PATTERN = /^-?\d{5,20}$/;
const MAX_TOKEN_LENGTH = 200;

export interface TelegramConfigInput {
  botToken: string;
  chatId: string;
}

export type TelegramConfigValidation =
  | { ok: true; value: TelegramConfigInput }
  | { ok: false; error: string };

/** Validate + trim a submitted config. Never returns the token on failure. */
export function validateTelegramConfig(input: {
  botToken: unknown;
  chatId: unknown;
}): TelegramConfigValidation {
  const botToken = typeof input.botToken === "string" ? input.botToken.trim() : "";
  const chatId = typeof input.chatId === "string" ? input.chatId.trim() : "";
  if (botToken === "" || chatId === "") {
    return { ok: false, error: "Enter both the bot token and the chat ID." };
  }
  if (botToken.length > MAX_TOKEN_LENGTH || !TELEGRAM_TOKEN_PATTERN.test(botToken)) {
    return {
      ok: false,
      error: "Enter a valid Telegram bot token, for example 123456789:ABC… (digits, a colon, then the secret part).",
    };
  }
  if (!TELEGRAM_CHAT_ID_PATTERN.test(chatId)) {
    return {
      ok: false,
      error: "Enter a valid numeric Telegram chat ID, for example 123456789. Group chats use a negative ID.",
    };
  }
  return { ok: true, value: { botToken, chatId } };
}

/** Mask a chat id for display: only the last 4 digits are ever shown. */
export function maskChatId(chatId: string): string {
  if (chatId.length <= 4) return "•••";
  return `•••${chatId.slice(-4)}`;
}

/**
 * The status shape is deliberately token-free: there is no field that could
 * carry the bot token, so no read path can leak it by accident. The masked
 * chat id comes from the database RPC (masked in SQL); maskChatId is the
 * client-of-the-RPC mirror used only by tests and fallbacks.
 */
export const telegramStatusSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  chat_id_masked: z.string().nullable(),
  updated_at: z.iso.datetime({ offset: true }).nullable(),
});

export type TelegramStatus = z.infer<typeof telegramStatusSchema>;

const telegramSecretSchema = z.object({
  bot_token: z.string().min(1),
  chat_id: z.string().min(1),
});

/** Fixed test message. Carries no order, customer, or credential data. */
export function buildTelegramTestMessage(): string {
  return "Attires Arena test notification. Telegram alerts are connected — new orders appear in Notifications, and this message confirms the bot can reach this chat.";
}

/** One line of the order notice: the stored item name, size, color and line total. */
export interface OrderNoticeItem {
  name: string;
  size: string;
  color: string;
  quantity: number;
  lineTotalMinor: number;
}

/**
 * Everything the new-order notice carries, in the owner's own format
 * (from his other store's bot): brand + total + customer, order number,
 * customer lines, delivery address, items, payment. Amounts are minor
 * units; money renders as whole taka, as in his example. Lines with no
 * value (email, discount) are omitted, never printed empty.
 */
export interface OrderNotice {
  orderNumber: number | string | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  /** Address lines in print order: street line, then "area, district, division". */
  addressLines: string[];
  items: OrderNoticeItem[];
  subtotalMinor: number;
  deliveryMinor: number;
  discountMinor: number;
  totalMinor: number;
  /** Database payment_method ('cod' — the only method the store offers). */
  paymentMethod: string;
  /** Database payment_status ('unpaid' | 'paid' | 'refunded'). */
  paymentStatus: string;
}

function paymentStatusLabel(status: string): string {
  if (status === "paid") return "Paid";
  if (status === "refunded") return "Refunded";
  return "Unpaid";
}

/**
 * Message text for a single order notice, in the owner's format. Plain
 * text only (no parse mode, so no markup injection). The phone and email
 * go to the owner's own Telegram chat only — his bot, his saved chat id —
 * never to the customer or any third party.
 */
export function buildOrderNoticeMessage(notice: OrderNotice): string {
  const lines: string[] = [];
  lines.push("🛒 🛒 New Order! — AttiresArena");
  lines.push(`${formatMoneyShort(notice.totalMinor)} from ${notice.customerName}`);
  lines.push("");
  lines.push(`🆔 Order #: ${formatOrderNumber(notice.orderNumber)}`);
  lines.push("");
  lines.push("👤 Customer");
  lines.push(`• Name: ${notice.customerName}`);
  if (notice.customerPhone) lines.push(`• Phone: ${notice.customerPhone}`);
  if (notice.customerEmail) lines.push(`• Email: ${notice.customerEmail}`);
  lines.push("");
  lines.push("📍 Delivery Address");
  for (const line of notice.addressLines) {
    if (line.trim() !== "") lines.push(`• ${line}`);
  }
  lines.push("");
  lines.push(`🛍 Products (${notice.items.length})`);
  for (const item of notice.items) {
    lines.push(
      `• ${item.name} [${item.size} / ${item.color}] × ${item.quantity} — ${formatMoneyShort(item.lineTotalMinor)}`,
    );
  }
  lines.push("");
  lines.push("💰 Payment");
  lines.push(`• Subtotal: ${formatMoneyShort(notice.subtotalMinor)}`);
  if (notice.discountMinor > 0) {
    lines.push(`• Discount: −${formatMoneyShort(notice.discountMinor)}`);
  }
  lines.push(`• Delivery: ${formatMoneyShort(notice.deliveryMinor)}`);
  lines.push(`• Total: ${formatMoneyShort(notice.totalMinor)}`);
  lines.push(
    `• Method: ${notice.paymentMethod.toUpperCase()} • ${paymentStatusLabel(notice.paymentStatus)}`,
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Automatic new-order notice (service-role read paths).               */
/*                                                                     */
/* The checkout has no staff session, so these reads go through the    */
/* service-role RPCs from migration 20261119000100 — never through the  */
/* staff secret RPC, which require_admin would refuse for a guest.     */
/* The rpc shape is the checkout transport's result type, written out  */
/* here so this module does not import the checkout service.           */
/* ------------------------------------------------------------------ */

/** Minimal RPC shape, structurally identical to the checkout transport. */
export type TelegramRpc = <T>(
  name: string,
  args: Record<string, unknown>,
) => Promise<{ ok: true; data: T } | { ok: false; code: string }>;

const orderNotificationItemSchema = z.object({
  product_name: z.string(),
  size: z.string(),
  color: z.string(),
  quantity: z.number().int(),
  unit_price_minor: z.number().int(),
  line_total_minor: z.number().int(),
});

const orderNotificationSchema = z.object({
  id: z.string().uuid(),
  order_number: z.number().int(),
  customer_name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  division: z.string(),
  district: z.string(),
  area: z.string(),
  address_line: z.string(),
  subtotal_minor: z.number().int(),
  delivery_charge_minor: z.number().int(),
  discount_minor: z.number().int(),
  total_minor: z.number().int(),
  payment_method: z.string(),
  payment_status: z.string(),
  items: z.array(orderNotificationItemSchema),
});

export type OrderNotificationData = z.infer<typeof orderNotificationSchema>;

/** Map the stored order payload onto the notice. Address prints as the street line, then "area, district, division". */
export function toOrderNotice(data: OrderNotificationData): OrderNotice {
  return {
    orderNumber: data.order_number,
    customerName: data.customer_name,
    customerPhone: data.phone,
    customerEmail: data.email,
    addressLines: [data.address_line, `${data.area}, ${data.district}, ${data.division}`],
    items: data.items.map((item) => ({
      name: item.product_name,
      size: item.size,
      color: item.color,
      quantity: item.quantity,
      lineTotalMinor: item.line_total_minor,
    })),
    subtotalMinor: data.subtotal_minor,
    deliveryMinor: data.delivery_charge_minor,
    discountMinor: data.discount_minor,
    totalMinor: data.total_minor,
    paymentMethod: data.payment_method,
    paymentStatus: data.payment_status,
  };
}

const NOTIFY_DIAGNOSTIC_PREFIX = "[telegram-order-notice]";

/**
 * Send the new-order Telegram notice for an order that was just placed.
 * Returns true only when Telegram accepted the message. NEVER throws and
 * NEVER breaks checkout: every failure path (unconfigured, disabled,
 * malformed payload, network, Telegram rejection) returns false after one
 * generic log line. The log carries the order number only — never the
 * message text, the phone, or the token.
 */
export async function notifyOrderPlaced(input: {
  rpc: TelegramRpc;
  orderNumber: number | string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<boolean> {
  try {
    const orderNumber =
      typeof input.orderNumber === "string"
        ? Number.parseInt(input.orderNumber, 10)
        : input.orderNumber;
    const orderResult = await input.rpc<OrderNotificationData>(
      "admin_get_order_notification_for_server",
      { p_order_number: orderNumber },
    );
    if (!orderResult.ok) {
      console.error(`${NOTIFY_DIAGNOSTIC_PREFIX} order read failed for ${input.orderNumber}`);
      return false;
    }
    const parsed = orderNotificationSchema.safeParse(orderResult.data);
    if (!parsed.success) {
      console.error(`${NOTIFY_DIAGNOSTIC_PREFIX} order payload malformed for ${input.orderNumber}`);
      return false;
    }
    const secretResult = await input.rpc<{ bot_token: string; chat_id: string }>(
      "admin_get_telegram_secret_for_server",
      { p_order_id: parsed.data.id },
    );
    if (!secretResult.ok) {
      console.error(`${NOTIFY_DIAGNOSTIC_PREFIX} telegram not configured or disabled`);
      return false;
    }
    const secret = telegramSecretSchema.safeParse(secretResult.data);
    if (!secret.success) {
      console.error(`${NOTIFY_DIAGNOSTIC_PREFIX} telegram secret malformed`);
      return false;
    }
    const sent = await sendTelegramMessage({
      botToken: secret.data.bot_token,
      chatId: secret.data.chat_id,
      text: buildOrderNoticeMessage(toOrderNotice(parsed.data)),
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
    });
    if (!sent.ok) {
      console.error(`${NOTIFY_DIAGNOSTIC_PREFIX} send failed for ${input.orderNumber}`);
      return false;
    }
    return true;
  } catch {
    console.error(`${NOTIFY_DIAGNOSTIC_PREFIX} failed for ${input.orderNumber}`);
    return false;
  }
}

export function telegramSendMessageUrl(botToken: string): string {
  return `https://api.telegram.org/bot${botToken}/sendMessage`;
}

export type TelegramSendResult = { ok: true } | { ok: false; error: string };

const TELEGRAM_TIMEOUT_MS = 10_000;

/**
 * Send one plain-text message through the Telegram Bot API. The token only
 * ever appears in the request URL (the Bot API's own design); it is never
 * put in the body, never logged, and never included in a returned error.
 * `fetchImpl` exists so tests can stub the network without touching the
 * global fetch.
 */
export async function sendTelegramMessage(input: {
  botToken: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<TelegramSendResult> {
  const send = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? TELEGRAM_TIMEOUT_MS);
  try {
    const response = await send(telegramSendMessageUrl(input.botToken), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    const parsed = z.object({ ok: z.boolean() }).safeParse(payload);
    if (!response.ok || !parsed.success || !parsed.data.ok) {
      return {
        ok: false,
        error: "Telegram did not accept the message. Check the bot token and chat ID, and that the bot has messaged this chat before, then try again.",
      };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Telegram did not respond in time. Try again." };
    }
    return { ok: false, error: "The test message could not be sent. Check the connection and try again." };
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/*                                                                     */
/* Status returns null when unavailable (migration unapplied / RPC     */
/* missing / malformed), so the page degrades honestly instead of      */
/* throwing into the error boundary.                                   */
/* ------------------------------------------------------------------ */

export async function readTelegramStatus(): Promise<TelegramStatus | null> {
  const session = await requireStaff(areaRoles("settings"));
  const result = await session.client.rpc("admin_get_telegram_status");
  if (result.error) return null;
  const parsed = telegramStatusSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

type StaffClient = StaffSession["client"];

/**
 * Fetch the stored secret for the server-side test send ONLY. The caller
 * must have already verified the configuration exists and is enabled via
 * readTelegramStatus. Returns null on any failure; the token never leaves
 * this module except inside sendTelegramMessage's request URL.
 */
async function fetchTelegramSecret(
  client: StaffClient,
): Promise<{ botToken: string; chatId: string } | null> {
  const result = await client.rpc("admin_get_telegram_secret");
  if (result.error) return null;
  const parsed = telegramSecretSchema.safeParse(result.data);
  if (!parsed.success) return null;
  return { botToken: parsed.data.bot_token, chatId: parsed.data.chat_id };
}

/* ------------------------------------------------------------------ */
/* Server Actions (writes go through RPCs only; settings.manage area)  */
/* ------------------------------------------------------------------ */

export async function saveTelegramConfig(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const validated = validateTelegramConfig({
    botToken: formData.get("bot_token"),
    chatId: formData.get("chat_id"),
  });
  if (!validated.ok) return actionError(validated.error);
  const session = await requireStaff(areaRoles("settings"));
  const result = await session.client.rpc("admin_save_telegram_config", {
    p_bot_token: validated.value.botToken,
    p_chat_id: validated.value.chatId,
    p_enabled: formData.get("enabled") === "on",
  });
  if (result.error) {
    return actionError(
      toActionError(result.error, "Telegram settings could not be saved. Check your access and try again."),
    );
  }
  revalidatePath("/admin/system/notifications");
  return actionOk(
    "Telegram settings saved. The bot token is stored as a secret and is never shown again. Send a test message to confirm delivery.",
  );
}

export async function sendTelegramTest(
  _prev: AdminActionResult | null,
  _formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  // Sending happens ONLY when configured and enabled; both facts come from
  // the masked status read, never from client input.
  const statusResult = await session.client.rpc("admin_get_telegram_status");
  const status = statusResult.error
    ? null
    : telegramStatusSchema.safeParse(statusResult.data).data ?? null;
  if (!status || !status.configured) {
    return actionError("Telegram is not configured. Save the bot token and chat ID first.");
  }
  if (!status.enabled) {
    return actionError("Telegram alerts are disabled. Enable them in the settings above, then try again.");
  }
  const secret = await fetchTelegramSecret(session.client);
  if (!secret) {
    return actionError("Telegram settings could not be read. Save them again and try once more.");
  }
  const sent = await sendTelegramMessage({
    botToken: secret.botToken,
    chatId: secret.chatId,
    text: buildTelegramTestMessage(),
  });
  if (!sent.ok) return actionError(sent.error);
  return actionOk("Test message sent. Check the Telegram chat to confirm it arrived.");
}

export async function deleteTelegramConfig(
  _prev: AdminActionResult | null,
  _formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const session = await requireStaff(areaRoles("settings"));
  const result = await session.client.rpc("admin_delete_telegram_config");
  if (result.error) {
    return actionError(
      toActionError(result.error, "Telegram settings could not be removed. Try again."),
    );
  }
  revalidatePath("/admin/system/notifications");
  return actionOk("Telegram settings removed. No Telegram messages will be sent.");
}
