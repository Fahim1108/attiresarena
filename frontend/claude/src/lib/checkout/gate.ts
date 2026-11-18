/**
 * Whether the Place Order control is enabled. The explicitly configured checkout flag enables it.
 * Without the flag, the existing behaviour is kept: enabled only when the payment configuration
 * reports itself available, which it does not in this build.
 * This is presentation only. The server and the database enforce the real gate.
 * NOTE: if payment configuration ever becomes available, this control would enable without the
 * ordering gate — the server would still refuse, but the UI would mislead. Revisit this
 * disjunction before any payment-collection work.
 */
export function canPlaceOrder(orderingEnabled: boolean, paymentConfigurationAvailable: boolean): boolean {
  return orderingEnabled || paymentConfigurationAvailable;
}
