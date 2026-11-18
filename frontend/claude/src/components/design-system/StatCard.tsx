import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/design-system/cn";
import { Card, CardContent } from "./Card";

/**
 * StatCard (KPI card) — label, value, optional description, icon and
 * trend. Fully props-driven: the caller formats the value and the trend
 * label from real data. No fetching, no count-up here — compose the
 * existing CountUpValue from admin/charts as the value when a page
 * wants animation.
 *
 * Trend colour is the caller's decision (`trendTone`): a falling number
 * is not always bad (fewer cancellations is good), so direction alone
 * never picks the colour. Default tone is neutral.
 */

export interface StatCardTrend {
  direction: "up" | "down" | "flat";
  /** Caller-formatted, e.g. "12% vs last month". Never invented here. */
  label: string;
}

const trendIcons = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
} as const;

const trendToneClasses = {
  positive: "text-admin-success",
  negative: "text-admin-danger",
  neutral: "text-admin-text-secondary",
} as const;

export function StatCard({
  label,
  value,
  description,
  icon,
  trend,
  trendTone = "neutral",
  className,
  children,
}: {
  label: string;
  /** Caller-formatted value node (numbers via Intl, currency, …). */
  value: ReactNode;
  description?: string;
  /** Lucide icon node, rendered in a tinted tile. */
  icon?: ReactNode;
  trend?: StatCardTrend;
  trendTone?: "positive" | "negative" | "neutral";
  className?: string;
  /** Optional footer slot below the value. */
  children?: ReactNode;
}) {
  const TrendIcon = trend ? trendIcons[trend.direction] : null;
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-words text-xs font-medium leading-5 text-admin-text-secondary sm:text-[13px]">
            {label}
          </p>
          {icon ? (
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-admin-control bg-admin-soft-bg text-admin-primary"
            >
              {icon}
            </span>
          ) : null}
        </div>
        <p className="admin-ds-numeric min-w-0 text-3xl font-semibold leading-9 text-admin-text [overflow-wrap:anywhere]">
          {value}
        </p>
        {trend && TrendIcon ? (
          <p
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-[13px] leading-5",
              trendToneClasses[trendTone],
            )}
          >
            <TrendIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="break-words">{trend.label}</span>
          </p>
        ) : null}
        {description ? (
          <p className="min-w-0 break-words text-[13px] leading-5 text-admin-text-secondary">
            {description}
          </p>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}

/** Alias: StatCard is the KPI card. */
export const KpiCard = StatCard;
