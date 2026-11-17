import type { ReactNode } from "react";
import { cn } from "@/design-system/cn";

/**
 * FilterBar — responsive layout container for filters. Compose with
 * children: SearchInput, the existing Select from src/components/ui/
 * Field, and ui/ Button elements. Stacks on phones (390px), wraps in
 * a row on wider screens. No state, no fetching — parents own filter
 * values (URL state is the page's decision, per web guidelines).
 */
export function FilterBar({
  label = "Filters",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex flex-col gap-3 font-admin-sans sm:flex-row sm:flex-wrap sm:items-end",
        className,
      )}
    >
      {children}
    </div>
  );
}
