import type { ReactNode } from "react";
import { cn } from "@/design-system/cn";

/**
 * PageHeader — the top of an admin page: breadcrumbs slot, h1 title,
 * description, and an actions slot. Composition only: pass breadcrumbs
 * as children and existing ui/ Button/ButtonLink elements as actions.
 * Must render inside an `.aa-admin-ds` ancestor.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: string;
  description?: string;
  /** Action slot — pass existing ui/ Button/ButtonLink elements. */
  actions?: ReactNode;
  className?: string;
  /** Breadcrumbs slot, rendered above the title. */
  children?: ReactNode;
}) {
  return (
    <div className={cn("font-admin-sans", className)}>
      {children ? <div className="mb-2 min-w-0">{children}</div> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-8 text-admin-text [overflow-wrap:anywhere]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-prose text-sm leading-6 text-admin-text-secondary [overflow-wrap:anywhere]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
