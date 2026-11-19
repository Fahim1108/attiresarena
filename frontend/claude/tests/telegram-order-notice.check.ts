import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOrderNoticeMessage,
  notifyOrderPlaced,
  telegramSendMessageUrl,
  toOrderNotice,
  type TelegramRpc,
} from "../src/lib/admin/telegram";

/* Fake credentials are test fixtures only; they are never real secrets. */
const FAKE_TOKEN = "123456789:AAFakeFakeFakeFakeFakeFakeFakeFake12";
const FAKE_CHAT_ID = "987654321";

const ORDER_PAYLOAD = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  order_number: 10001,
  customer_name: "Ayesha Rahman",
  phone: "01712345678",
  email: "ayesha@example.com",
  division: "Dhaka",
  district: "Gazipur",
  area: "Tongi",
  address_line: "House 3, Block B, Tongi",
  subtotal_minor: 144800,
  delivery_charge_minor: 13000,
  discount_minor: 0,
  total_minor: 157800,
  payment_method: "cod",
  payment_status: "unpaid",
  items: [
    {
      product_name: "Casual shirt",
      size: "M",
      color: "Standard",
      quantity: 1,
      unit_price_minor: 45000,
      line_total_minor: 45000,
    },
    {
      product_name: "Test shirt 2",
      size: "L",
      color: "Navy",
      quantity: 2,
      unit_price_minor: 49900,
      line_total_minor: 99800,
    },
  ],
};

const GOLDEN_MESSAGE = [
  "🛒 🛒 New Order! — AttiresArena",
  "৳1,578 from Ayesha Rahman",
  "",
  "🆔 Order #: AA-10001",
  "",
  "👤 Customer",
  "• Name: Ayesha Rahman",
  "• Phone: 01712345678",
  "• Email: ayesha@example.com",
  "",
  "📍 Delivery Address",
  "• House 3, Block B, Tongi",
  "• Tongi, Gazipur, Dhaka",
  "",
  "🛍 Products (2)",
  "• Casual shirt [M / Standard] × 1 — ৳450",
  "• Test shirt 2 [L / Navy] × 2 — ৳998",
  "",
  "💰 Payment",
  "• Subtotal: ৳1,448",
  "• Delivery: ৳130",
  "• Total: ৳1,578",
  "• Method: COD • Unpaid",
].join("\n");

describe("order notice message format", () => {
  it("renders the owner's format exactly", () => {
    expect(buildOrderNoticeMessage(toOrderNotice(ORDER_PAYLOAD))).toBe(GOLDEN_MESSAGE);
  });

  it("omits the email line when the order has no email", () => {
    const message = buildOrderNoticeMessage(
      toOrderNotice({ ...ORDER_PAYLOAD, email: null }),
    );
    expect(message).not.toContain("• Email:");
    expect(message).toContain("• Phone: 01712345678");
  });

  it("shows a discount line only when the order has a discount", () => {
    const without = buildOrderNoticeMessage(toOrderNotice(ORDER_PAYLOAD));
    expect(without).not.toContain("Discount");
    const withDiscount = buildOrderNoticeMessage(
      toOrderNotice({ ...ORDER_PAYLOAD, discount_minor: 10000, total_minor: 147800 }),
    );
    expect(withDiscount).toContain("• Discount: −৳100");
    expect(withDiscount).toContain("• Total: ৳1,478");
  });

  it("renders a paid order's method line as Paid", () => {
    const message = buildOrderNoticeMessage(
      toOrderNotice({ ...ORDER_PAYLOAD, payment_status: "paid" }),
    );
    expect(message).toContain("• Method: COD • Paid");
  });
});

/** Stub for the two server RPCs the notice needs: the order payload and the bot secret. */
function stubRpc(overrides: {
  order?: unknown;
  secret?: unknown;
  fail?: string;
  throwOn?: string;
} = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = (async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (overrides.throwOn === name) throw new Error("boom");
    if (overrides.fail === name) return { ok: false, code: "22023" };
    if (name === "admin_get_order_notification_for_server") {
      return { ok: true, data: overrides.order ?? ORDER_PAYLOAD };
    }
    if (name === "admin_get_telegram_secret_for_server") {
      return {
        ok: true,
        data: overrides.secret ?? { bot_token: FAKE_TOKEN, chat_id: FAKE_CHAT_ID },
      };
    }
    return { ok: false, code: "unknown" };
  }) as unknown as TelegramRpc;
  return { rpc, calls };
}

function stubFetch(accept = true) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return { ok: accept, json: async () => ({ ok: accept }) };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("notifyOrderPlaced", () => {
  it("sends the exact notice text and returns true", async () => {
    const { rpc, calls } = stubRpc();
    const { fetchImpl, calls: sent } = stubFetch();
    const result = await notifyOrderPlaced({ rpc, orderNumber: "10001", fetchImpl });
    expect(result).toBe(true);
    expect(calls.map((c) => c.name)).toEqual([
      "admin_get_order_notification_for_server",
      "admin_get_telegram_secret_for_server",
    ]);
    expect(calls[0]!.args).toEqual({ p_order_number: 10001 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(telegramSendMessageUrl(FAKE_TOKEN));
    expect(sent[0]!.body).toEqual({
      chat_id: FAKE_CHAT_ID,
      text: GOLDEN_MESSAGE,
      disable_web_page_preview: true,
    });
    expect(JSON.stringify(sent[0]!.body)).not.toContain(FAKE_TOKEN);
  });

  it("sends nothing when Telegram is not configured", async () => {
    const { rpc } = stubRpc({ fail: "admin_get_telegram_secret_for_server" });
    const { fetchImpl, calls: sent } = stubFetch();
    expect(await notifyOrderPlaced({ rpc, orderNumber: 10001, fetchImpl })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing when the order cannot be read", async () => {
    const { rpc } = stubRpc({ fail: "admin_get_order_notification_for_server" });
    const { fetchImpl, calls: sent } = stubFetch();
    expect(await notifyOrderPlaced({ rpc, orderNumber: 10001, fetchImpl })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing when the order payload is malformed", async () => {
    const { rpc } = stubRpc({ order: { order_number: "not-a-number" } });
    const { fetchImpl, calls: sent } = stubFetch();
    expect(await notifyOrderPlaced({ rpc, orderNumber: 10001, fetchImpl })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("returns false, never throws, when Telegram rejects the message", async () => {
    const { rpc } = stubRpc();
    const { fetchImpl, calls: sent } = stubFetch(false);
    expect(await notifyOrderPlaced({ rpc, orderNumber: 10001, fetchImpl })).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("returns false, never throws, when an RPC throws", async () => {
    const { rpc } = stubRpc({ throwOn: "admin_get_order_notification_for_server" });
    const { fetchImpl, calls: sent } = stubFetch();
    expect(await notifyOrderPlaced({ rpc, orderNumber: 10001, fetchImpl })).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe("order notification migration (source pin)", () => {
  const migration = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "supabase",
      "migrations",
      "20261119000100_telegram_order_notification_server.sql",
    ),
    "utf8",
  );

  it("defines both server-only read paths", () => {
    expect(migration).toContain(
      "create function public.admin_get_telegram_secret_for_server(p_order_id uuid)",
    );
    expect(migration).toContain(
      "create function public.admin_get_order_notification_for_server(p_order_number integer)",
    );
  });

  it("guards both functions to the service role and grants nobody else", () => {
    expect(migration).toContain("auth.role(), '') <> 'service_role'");
    expect(migration).toContain(
      "grant execute on function public.admin_get_telegram_secret_for_server(uuid) to service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.admin_get_order_notification_for_server(integer) to service_role",
    );
    expect(migration).not.toContain("grant execute on function public.admin_get_telegram_secret_for_server(uuid) to authenticated");
    expect(migration).not.toContain("grant execute on function public.admin_get_order_notification_for_server(integer) to authenticated");
  });
});
