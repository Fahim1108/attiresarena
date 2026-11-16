/**
 * Exact-match allowlist for post-auth destinations. Only these paths may
 * ever come out of a `next` parameter — absolute URLs, protocol-relative
 * URLs, backslashes, and query/fragment smuggling are all rejected by
 * strict string equality. Default: /account.
 */
export const CUSTOMER_CALLBACK_DESTINATIONS = [
  "/account",
  "/account/orders",
  "/account/addresses",
  "/account/reset-password",
  "/checkout",
  "/cart",
  "/shop",
  "/",
] as const;

/** The allowlisted destination, or undefined when the value is not allowlisted. */
export function allowlistedCustomerDestination(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string") return undefined;
  return (
    CUSTOMER_CALLBACK_DESTINATIONS as readonly string[]
  ).includes(value)
    ? value
    : undefined;
}

/** The allowlisted destination, defaulting to /account. Used by /auth/callback. */
export function customerCallbackDestination(
  value: string | null | undefined,
): string {
  return allowlistedCustomerDestination(value) ?? "/account";
}
