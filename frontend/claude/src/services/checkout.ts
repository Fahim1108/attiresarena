import "server-only";
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { CHECKOUT_COOKIE, type CheckoutOrdersConfiguration, checkoutCookieOptions, checkoutOrdersConfiguration } from "@/lib/checkout/config";
import { createCheckoutService, validateCoupon, type CheckoutRpc, type CouponValidationResult, type PlacedOrder, type RpcResult } from "@/lib/checkout/service";
import { customerClient } from "@/lib/customer/supabase";
import { publicSupabaseConfiguration } from "@/lib/supabase-public";
import type { ActionResult } from "@/types";

const notConnected = { ok: false as const, reason: "not_connected" as const, message: "This service is not connected. No data was saved." };

/**
 * Signed-in-customer credential for checkout RPCs: the publishable key
 * as `apikey` plus the customer's own access token as the Bearer
 * credential. The database grants the checkout RPCs to `authenticated`
 * and attributes the session to auth.uid() (migration
 * 20261113000300), so orders placed under this credential appear in
 * the customer's My Orders. Never a new key, never the service key.
 */
export interface CustomerCheckoutCredential {
  apikey: string;
  accessToken: string;
  /** Signed-in customer id, for coupon checks that count per-customer usage. */
  userId: string;
}

/**
 * Resolve the checkout credential. Returns null when no customer
 * session exists (guest path, service-role transport, exactly as
 * before) and "unusable" when a session validated but no access token
 * could be read — the caller must then fail honestly and NEVER fall
 * back to the service role, which would unlink the order.
 */
async function customerCheckoutCredential(): Promise<CustomerCheckoutCredential | null | "unusable"> {
  const config = publicSupabaseConfiguration();
  if (!config) return null;
  const client = await customerClient(true);
  if (!client) return null;
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || user.is_anonymous) return null;
  const {
    data: { session },
  } = await client.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) return "unusable";
  return { apikey: config.key, accessToken, userId: user.id };
}

/**
 * Calls the checkout RPCs with the trusted server credential, or with
 * the signed-in customer's JWT when a customer credential is given.
 * The browser never sees either credential, and the database grants
 * these RPCs to the trusted server and signed-in customers only.
 *
 * Guest calls are byte-identical to before: same headers, same
 * argument shapes, same cookie jar, same gates. A 401 from PostgREST
 * under a customer credential reports through onCustomerAuthFailure
 * so the caller can fail honestly ("sign-in expired") instead of
 * silently falling back to the service role.
 */
export function rpcFor(
  config: CheckoutOrdersConfiguration,
  customer?: CustomerCheckoutCredential,
  onCustomerAuthFailure?: () => void,
): CheckoutRpc {
  return async <T,>(name: string, args: Record<string, unknown>): Promise<RpcResult<T>> => {
    try {
      const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: customer
          ? {
              apikey: customer.apikey,
              Authorization: `Bearer ${customer.accessToken}`,
              "Content-Type": "application/json",
            }
          : {
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
      if (customer && response.status === 401) onCustomerAuthFailure?.();
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
  const credential = await customerCheckoutCredential();
  if (credential === "unusable") return "unusable";
  const store = await cookies();
  let cleared = false;
  let customerAuthFailed = false;
  const checkout = createCheckoutService(
    rpcFor(config, credential ?? undefined, () => {
      customerAuthFailed = true;
    }),
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
  return { checkout, didCustomerAuthFail: () => customerAuthFailed };
}

function expiredSessionFailure(): { ok: false; reason: "error"; message: string } {
  return { ok: false, reason: "error", message: "Your sign-in expired. Please sign in again, then place your order." };
}

export async function saveCheckoutProgress(input: unknown): Promise<ActionResult<{ saved: true }>> {
  const resolved = await service();
  if (!resolved) return notConnected;
  if (resolved === "unusable") return expiredSessionFailure();
  const result = await resolved.checkout.saveProgress(input);
  if (!result.ok && resolved.didCustomerAuthFail()) return expiredSessionFailure();
  return result;
}

export async function placeCheckoutOrder(input: unknown): Promise<ActionResult<PlacedOrder>> {
  const resolved = await service();
  if (!resolved) return notConnected;
  if (resolved === "unusable") return expiredSessionFailure();
  const result = await resolved.checkout.placeOrder(input);
  if (!result.ok && resolved.didCustomerAuthFail()) return expiredSessionFailure();
  return result;
}

export type CheckedCoupon = Extract<CouponValidationResult, { ok: true }>;

/**
 * Check a coupon against a cart subtotal. Guests are checked under the
 * trusted server credential (the migration grants `validate_coupon` to
 * service_role for this read-only check); signed-in customers are checked
 * under their own JWT so per-customer and first-order rules count their
 * account. The phone, when given, must already be a normalized Bangladeshi
 * mobile number (or null): the RPC compares it verbatim against past
 * redemptions. This never records a redemption — only placing the order
 * does that.
 *
 * Identity note: the check uses the CURRENT session's user id, while
 * place time uses the checkout session's user id (set when the session
 * started). A customer who signs in after starting checkout can therefore
 * see a discount the place-time check refuses (CK009). The place-time
 * check is authoritative; the display is corrected on the next
 * re-validation once the session is re-created.
 */
export async function validateCheckoutCoupon(input: { code: string; phone: string | null; subtotalMinor: number }): Promise<ActionResult<CheckedCoupon>> {
  const config = checkoutOrdersConfiguration();
  if (!config) return notConnected;
  const credential = await customerCheckoutCredential();
  if (credential === "unusable") return expiredSessionFailure();
  let customerAuthFailed = false;
  const result = await validateCoupon(rpcFor(config, credential ?? undefined, () => {
    customerAuthFailed = true;
  }), {
    code: input.code,
    userId: credential?.userId ?? null,
    phone: input.phone,
    subtotalMinor: input.subtotalMinor,
  });
  if (!result.ok) {
    if (customerAuthFailed) return expiredSessionFailure();
    return { ok: false, reason: "error", message: "The coupon could not be checked. Please try again." };
  }
  return { ok: true, data: result };
}
