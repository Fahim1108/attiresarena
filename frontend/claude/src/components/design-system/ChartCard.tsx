import { ChartColumn } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/design-system/cn";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card";

/**
 * ChartCard — titled card shell for dashboard charts. Compose: pass a
 * chart (LazyAreaChart / LazyDonutChart from ./charts/lazy, or the
 * existing hand-built admin/charts) as children. When there is no data,
 * render ChartEmpty as the child instead of an empty chart — never
 * invent placeholder series.
 *
 * Recharts itself loads only through the lazy wrappers, so pages that
 * never render a chart never download it (react_best_practices
 * bundle-dynamic-imports).
 */
export function ChartCard({
  title,
  description,
  actions,
  footer,
  headingLevel = "h3",
  className,
  children,
}: {
  title: string;
  description?: string;
  /** Action slot — pass existing ui/ Button/ButtonLink elements. */
  actions?: ReactNode;
  footer?: ReactNode;
  headingLevel?: "h2" | "h3" | "h4";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle headingLevel={headingLevel}>{title}</CardTitle>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}

/**
 * ChartEmpty — honest empty state for charts: names what is absent and
 * what will make it appear. Shared by the Recharts components and
 * available to any ChartCard child.
 */
export function ChartEmpty({
  title,
  guidance,
  icon,
  action,
  className,
}: {
  title: string;
  guidance?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[180px] flex-col items-center justify-center px-6 py-10 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-admin-soft-bg text-admin-primary"
      >
        {icon ?? <ChartColumn className="h-6 w-6" aria-hidden="true" />}
      </span>
      <p className="text-sm font-medium text-admin-text">{title}</p>
      {guidance ? (
        <p className="mt-1 max-w-sm text-[13px] leading-5 text-admin-text-secondary">
          {guidance}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
