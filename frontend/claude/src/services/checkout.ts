import "server-only";
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { CHECKOUT_COOKIE, type CheckoutOrdersConfiguration, checkoutCookieOptions, checkoutOrdersConfiguration } from "@/lib/checkout/config";
import { createCheckoutService, type CheckoutRpc, type PlacedOrder, type RpcResult } from "@/lib/checkout/service";
import type { ActionResult } from "@/types";

const notConnected = { ok: false as const, reason: "not_connected" as const, message: "This service is not connected. No data was saved." };

/**
 * Calls the checkout RPCs with the trusted server credential. The browser never sees it, and the
 * database grants these RPCs to the trusted server and signed-in customers only.
 */
function rpcFor(config: CheckoutOrdersConfiguration): CheckoutRpc {
  return async <T,>(name: string, args: Record<string, unknown>): Promise<RpcResult<T>> => {
    try {
      const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: config.serviceKey,
          ...(config.serviceKey.startsWith("eyJ") ? { Authorization: `Bearer ${config.serviceKey}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) return { ok: true, data: body as T };
      const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : "unknown";
      return { ok: false, code };
    } catch {
      return { ok: false, code: "network" };
    }
  };
}

/**
 * Best-effort client identity for rate limiting: a hash of the connecting address, never the
 * address itself. Platform-set headers are preferred over client-supplied forwarding headers.
 * Requests without an address share one bucket, which is strict rather than permissive.
 */
async function clientKeyFromRequest(): Promise<string> {
  const h = await headers();
  const platform = h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  const real = h.get("x-real-ip")?.trim();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = platform || real || forwarded || "unknown";
  return createHash("sha256").update(`aa-checkout-client:${address}`).digest("hex");
}

async function service() {
  const config = checkoutOrdersConfiguration();
  if (!config) return null;
  const store = await cookies();
  let cleared = false;
  return createCheckoutService(
    rpcFor(config),
    {
      get: () => (cleared ? undefined : store.get(CHECKOUT_COOKIE)?.value),
      set: (token, expires) => {
        cleared = false;
        store.set(CHECKOUT_COOKIE, token, checkoutCookieOptions(expires));
      },
      clear: () => {
        cleared = true;
        store.set(CHECKOUT_COOKIE, "", { ...checkoutCookieOptions(), maxAge: 0 });
      },
    },
    { clientKey: await clientKeyFromRequest() },
  );
}

export async function saveCheckoutProgress(input: unknown): Promise<ActionResult<{ saved: true }>> {
  const checkout = await service();
  return checkout ? checkout.saveProgress(input) : notConnected;
}

export async function placeCheckoutOrder(input: unknown): Promise<ActionResult<PlacedOrder>> {
  const checkout = await service();
  return checkout ? checkout.placeOrder(input) : notConnected;
}
