import { Banknote, CreditCard } from "lucide-react";
import { cn } from "@/lib/cn";
import type { PaymentMethod } from "@/types";

export function PaymentMethodSelector({ value, onChange, onlineEnabled, previewEnabled = false, isProduction = false }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; onlineEnabled: boolean; previewEnabled?: boolean; isProduction?: boolean }) {
  // The payment step is Bangla: the online description must never claim
  // full payment is disabled. Off states stay neutral: the preview names
  // itself as preview-only, and no state shows send-money instructions.
  const onlineDescription = onlineEnabled
    ? "পুরো অর্ডারের টাকা পে করুন।"
    : isProduction
      ? "bKash বা Nagad দিয়ে পেমেন্ট।"
      : previewEnabled
        ? "bKash বা Nagad · শুধু প্রিভিউ। টাকা পাঠাবেন না।"
        : "bKash বা Nagad দিয়ে পেমেন্ট।";
  const options = [
    { id: "cod" as const, title: "Cash on Delivery", description: "Location-based advance, then the remaining balance on delivery. Advance must be verified before confirmation.", Icon: Banknote, disabled: false },
    { id: "online" as const, title: "Full Online Payment", description: onlineDescription, Icon: CreditCard, disabled: !onlineEnabled && !previewEnabled },
  ];
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-medium text-ink">Payment Method</legend>
      <div className="space-y-2.5" role="radiogroup">
        {options.map(({ id, title, description, Icon, disabled }) => {
          const active = value === id;
          return (
            <label
              key={id}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-card border p-4 transition-colors",
                active ? "border-primary bg-selected/60" : "border-line hover:border-ink/30",
                disabled && "cursor-not-allowed opacity-60 hover:border-line",
              )}
            >
              <input type="radio" name="payment" value={id} checked={active} disabled={disabled} onChange={() => onChange(id)} className="h-4 w-4 accent-[rgb(var(--aa-primary))]" />
              <Icon className={cn("h-5 w-5", active ? "text-primary" : "text-ink-muted")} strokeWidth={1.6} aria-hidden />
              <span className="flex-1">
                <span className="block text-sm font-medium text-ink">{title}</span>
                <span lang={id === "online" ? "bn" : undefined} className={cn("block text-xs", disabled ? "text-primary" : "text-ink-muted")}>{description}</span>
                {id === "cod" && <span lang="bn" className="mt-1 block text-sm font-medium leading-relaxed text-primary">অর্ডার কনফার্ম করতে ডেলিভারি চার্জ পে করুন।</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
