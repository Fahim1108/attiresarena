import { Clock, MapPin, Truck } from "lucide-react";
import { commerce } from "@/config";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Delivery Information card for product pages. Rendered on EVERY product
 * page — real products and design-review fixtures alike — so the Barishal
 * charges are never hidden behind a product-type gate. (2026-11-21: the
 * card used to live inside the `!product.reviewOnly` block and was missing
 * from real shirt pages on the Preview.)
 */
export function ProductDeliveryInfo({ className }: { className?: string }) {
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
            <p className="font-medium text-ink">Inside Barishal City</p>
            <p className="text-ink-muted">1–2 working days · {formatPrice(commerce.deliveryCharges.insideBarishalCity)}</p>
          </div>
        </li>
        <li className="flex gap-3">
          <Truck className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.6} aria-hidden />
          <div>
            <p className="font-medium text-ink">Outside Barishal City</p>
            <p className="text-ink-muted">3–5 working days · {formatPrice(commerce.deliveryCharges.outsideBarishalCity)}</p>
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
