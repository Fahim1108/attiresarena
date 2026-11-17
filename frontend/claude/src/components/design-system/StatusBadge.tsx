import { cva } from "class-variance-authority";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  type OrderStatus,
} from "@/lib/admin/constants";
import { cn } from "@/design-system/cn";

/**
 * StatusBadge — order status badge for the fixed 8 statuses.
 *
 * The status set, labels and tones are imported from
 * src/lib/admin/constants.ts (the database CHECK constraint mirror) —
 * never redefined here. "Processing" is NOT a status and can never
 * reach this component: the OrderStatus type forbids it.
 *
 * Badge text uses the dark tone colour on a 5% tint: at 10% the
 * warning and neutral tones fell below 4.5:1 on white cards (4.46:1
 * and 4.40:1); at 5% every tone stays above 4.5:1. A dot AND the
 * label text carry meaning, so it never relies on colour alone. For
 * non-order badges, reuse the existing Badge from src/components/ui/.
 */

export type StatusBadgeTone =
  (typeof ORDER_STATUS_TONES)[OrderStatus];

/** Pure mapping, unit-tested in tests/design-system.check.ts. */
export function statusBadgeProps(status: OrderStatus): {
  label: string;
  tone: StatusBadgeTone;
} {
  return { label: ORDER_STATUS_LABELS[status], tone: ORDER_STATUS_TONES[status] };
}

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
  {
    variants: {
      tone: {
        info: "bg-admin-info/5 text-admin-info ring-admin-info/30",
        success: "bg-admin-success/5 text-admin-success ring-admin-success/30",
        warning: "bg-admin-warning/5 text-admin-warning ring-admin-warning/30",
        danger: "bg-admin-danger/5 text-admin-danger ring-admin-danger/30",
        neutral:
          "bg-admin-text-secondary/5 text-admin-text-secondary ring-admin-text-secondary/30",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function StatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const { label, tone } = statusBadgeProps(status);
  return (
    <span className={cn(statusBadgeVariants({ tone }), className)}>
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
      />
      {label}
    </span>
  );
}
