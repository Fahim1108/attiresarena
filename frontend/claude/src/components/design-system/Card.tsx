import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "@/design-system/cn";

/**
 * Card — compound container for dashboard panels.
 *
 * Compose with children (composition_patterns: children over render
 * props, no boolean modes). Explicit parts: CardHeader, CardTitle,
 * CardDescription, CardContent, CardFooter. Must render inside an
 * `.aa-admin-ds` ancestor so the `--admin-*` variables resolve.
 *
 * This does NOT replace src/components/ui/* — there is no card in ui/,
 * so this is additive, not duplicative.
 */

const cardVariants = cva(
  "rounded-admin-card border border-admin-border font-admin-sans text-admin-text shadow-admin-card",
  {
    variants: {
      tone: {
        default: "bg-admin-card",
        soft: "bg-admin-soft-bg",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export function Card({
  tone,
  className,
  children,
}: {
  tone?: "default" | "soft";
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn(cardVariants({ tone }), className)}>{children}</div>;
}

export function CardHeader({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 px-4 pt-4 sm:px-6 sm:pt-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  headingLevel = "h3",
  className,
  children,
}: {
  /** Match the page heading hierarchy; the page decides the level. */
  headingLevel?: "h2" | "h3" | "h4";
  className?: string;
  children: ReactNode;
}) {
  const Heading = headingLevel;
  return (
    <Heading
      className={cn(
        "min-w-0 text-sm font-semibold leading-5 text-admin-text [text-wrap:balance] [overflow-wrap:anywhere]",
        className,
      )}
    >
      {children}
    </Heading>
  );
}

export function CardDescription({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "min-w-0 text-[13px] leading-5 text-admin-text-secondary [overflow-wrap:anywhere]",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function CardContent({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("px-4 pb-4 pt-3 sm:px-6 sm:pb-6 sm:pt-4", className)}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border-t border-admin-border px-4 py-3 sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
