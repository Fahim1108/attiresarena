import "server-only";
import { cookies } from "next/headers";
import { CHECKOUT_COOKIE, DUPLICATE_SUBMISSION_WINDOW_MS, checkoutCookieOptions, checkoutOrdersConfiguration } from "@/lib/checkout/config";
import { createCheckoutService, type CheckoutRpc, type PlacedOrder, type RpcResult } from "@/lib/checkout/service";
import type { ActionResult } from "@/types";

const notConnected = { ok: false as const, reason: "not_connected" as const, message: "This service is not connected. No data was saved." };

/** Public (anon) credentials only. Authorisation is the checkout token, checked in the database. */
function rpcFor(config: { url: string; key: string }): CheckoutRpc {
  return async <T,>(name: string, args: Record<string, unknown>): Promise<RpcResult<T>> => {
    try {
      const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: config.key, ...(config.key.startsWith("eyJ") ? { Authorization: `Bearer ${config.key}` } : {}), "Content-Type": "application/json" },
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
    { duplicateWindowMs: DUPLICATE_SUBMISSION_WINDOW_MS },
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
