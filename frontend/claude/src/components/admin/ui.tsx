import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared server-safe admin UI primitives. Styles live in
 * src/app/admin/admin-panel.css plus the existing aa-* classes.
 * Interactive pieces live in ./ui-client.tsx.
 */

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="aa-page-heading">
      <div>
        <p className="aa-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="aa-heading-actions">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`aa-panel${className ? ` ${className}` : ""}`}>
      {title ? (
        <div className="aa-section-heading">
          <h2>{title}</h2>
          {actions}
        </div>
      ) : null}
      {description ? <p className="aa-muted">{description}</p> : null}
      {children}
    </section>
  );
}

export type BadgeTone =
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "neutral";

export function StatusBadge({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: ReactNode;
}) {
  return <span className={`aa-badge aa-badge--${tone}`}>{children}</span>;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="aa-empty-state">
      {icon}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Notice({
  kind,
  children,
}: {
  kind: "info" | "success" | "error" | "warning";
  children: ReactNode;
}) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={`aa-notice aa-notice--${kind}`}>
      {children}
    </p>
  );
}

export function Pagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let p = start; p <= end; p += 1) pages.push(p);
  return (
    <nav aria-label="Pagination" className="aa-pagination">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} aria-label="Previous page">
          ← Previous
        </Link>
      ) : (
        <span aria-hidden="true">← Previous</span>
      )}
      {pages.map((p) =>
        p === page ? (
          <span key={p} aria-current="page">
            {p}
          </span>
        ) : (
          <Link key={p} href={hrefFor(p)}>
            {p}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} aria-label="Next page">
          Next →
        </Link>
      ) : (
        <span aria-hidden="true">Next →</span>
      )}
    </nav>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="aa-skeleton-list">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="aa-skeleton-row" />
      ))}
    </div>
  );
}

/** Build a query-string href preserving existing params with overrides. */
export function hrefWithParams(
  base: string,
  current: Record<string, string | string[] | undefined>,
  overrides: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (typeof value === "string" && value !== "") params.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
