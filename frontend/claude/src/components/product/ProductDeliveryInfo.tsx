import { Clock, MapPin, Truck } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  DEFAULT_DELIVERY_SETTINGS,
  type DeliverySettings,
} from "@/lib/delivery-settings";

/**
 * Delivery Information card for product pages. Rendered on EVERY product
 * page — real products and design-review fixtures alike — so the delivery
 * charges are never hidden behind a product-type gate. (2026-11-21: the
 * card used to live inside the `!product.reviewOnly` block and was missing
 * from real shirt pages on the Preview.)
 *
 * The zones and charges come from the saved delivery settings
 * (admin-editable, migration 20261122000100), passed in by the product
 * page: "Inside" is the whole admin-selected district, and the amounts
 * follow whatever the admin saved. Nothing here is hardcoded; without a
 * prop the defaults (Inside Barishal ৳50, Outside ৳140) apply.
 */
export function ProductDeliveryInfo({
  className,
  delivery = DEFAULT_DELIVERY_SETTINGS,
}: {
  className?: string;
  delivery?: DeliverySettings;
}) {
  const insideLabel = `Inside ${delivery.insideDistrict}`;
  const outsideLabel = `Outside ${delivery.insideDistrict}`;
  return (
    <section
      aria-labelledby="delivery-heading"
      className={cn("rounded-card border border-line p-5 sm:p-6", className)}
    >
      <h2 id="delivery-heading" className="font-serif text-2xl text-ink">
        Delivery Information
      </h2>
      <ul className="mt-4 space-y-4 text-sm">
        <li className="flex gap-3">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.6} aria-hidden />
          <div>
            <p className="font-medium text-ink">{insideLabel}</p>
            <p className="text-ink-muted">1–2 working days · {formatPrice(delivery.insideChargeMinor / 100)}</p>
          </div>
        </li>
        <li className="flex gap-3">
          <Truck className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.6} aria-hidden />
          <div>
            <p className="font-medium text-ink">{outsideLabel}</p>
            <p className="text-ink-muted">3–5 working days · {formatPrice(delivery.outsideChargeMinor / 100)}</p>
          </div>
        </li>
        <li className="flex gap-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.6} aria-hidden />
          <div>
            <p className="font-medium text-ink">Order confirmation</p>
            <p className="text-ink-muted">Our team calls to confirm COD orders before dispatch.</p>
          </div>
        </li>
      </ul>
    </section>
  );
}
