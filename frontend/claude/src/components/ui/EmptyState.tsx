import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({ icon, title, description, action, className, headingLevel = "h2" }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string; headingLevel?: "h1" | "h2" }) {
  const Title = headingLevel;
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}>
      {icon && <div aria-hidden="true" className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-selected text-primary">{icon}</div>}
      <Title className="font-serif text-2xl text-ink sm:text-3xl">{title}</Title>
      {description && <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
