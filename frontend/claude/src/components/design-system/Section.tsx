import { useId, type ReactNode } from "react";
import { cn } from "@/design-system/cn";

/**
 * Section — a labelled page section (title, description, actions, body).
 * Borderless, unlike Card: use Section to group content on a page and
 * Card for bordered panels inside a section. Must render inside an
 * `.aa-admin-ds` ancestor.
 */
export function Section({
  title,
  description,
  actions,
  headingLevel = "h2",
  className,
  children,
}: {
  title: string;
  description?: string;
  /** Action slot — pass existing ui/ Button/ButtonLink elements. */
  actions?: ReactNode;
  headingLevel?: "h2" | "h3";
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const Heading = headingLevel;
  return (
    <section
      aria-labelledby={titleId}
      className={cn("font-admin-sans", className)}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Heading
            id={titleId}
            className="text-lg font-semibold leading-7 text-admin-text [text-wrap:balance] [overflow-wrap:anywhere]"
          >
            {title}
          </Heading>
          {description ? (
            <p className="mt-1 max-w-prose text-sm leading-6 text-admin-text-secondary [overflow-wrap:anywhere]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
