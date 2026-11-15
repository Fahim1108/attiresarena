import { feedHealthStatus } from "@/lib/catalog-publication";
import type { StorefrontFeedHealth } from "@/lib/catalog-publication";
import { StatusBadge } from "../ui";
import styles from "./catalogue-v2.module.css";

/**
 * Admin-only storefront feed diagnostics (products page). Shows WHICH
 * data source this deployment reads plus per-source feed status, so a
 * silent-empty storefront is diagnosable instead of mysterious.
 *
 * SECRETS: project refs/hostnames only — never keys, never
 * credential-bearing URLs. The feed read itself uses the public anon
 * configuration; this surface only reports its outcome.
 */
export function FeedHealthIndicator({
  health,
}: {
  health: StorefrontFeedHealth | null;
}) {
  if (!health) {
    return (
      <section
        className={styles.feedHealth}
        aria-label="Storefront feed diagnostics"
      >
        <div className={styles.feedHealthHead}>
          <span className={styles.feedHealthTitle}>Storefront feed</span>
          <StatusBadge tone="neutral">Could not be checked</StatusBadge>
        </div>
        <p className={styles.feedHealthFootnote}>
          The feed health check itself failed. The storefront may still be
          serving products; check the server log for{" "}
          <code>[attiresarena:storefront-feed]</code> entries.
        </p>
      </section>
    );
  }

  const status = feedHealthStatus(health);
  const mismatch =
    health.envProjectRef !== null &&
    health.expectedProjectRef !== null &&
    health.envProjectRef !== health.expectedProjectRef;

  return (
    <section
      className={styles.feedHealth}
      aria-label="Storefront feed diagnostics"
    >
      <div className={styles.feedHealthHead}>
        <span className={styles.feedHealthTitle}>Storefront feed</span>
        <StatusBadge
          tone={
            status === "ok"
              ? "success"
              : status === "partial"
                ? "warning"
                : "danger"
          }
        >
          {status === "ok"
            ? "Available"
            : status === "partial"
              ? "Partially available"
              : "Unavailable"}
        </StatusBadge>
        <span>
          {health.visibleCount} product{health.visibleCount === 1 ? "" : "s"}{" "}
          visible on the storefront
        </span>
      </div>

      <dl className={styles.feedHealthRows}>
        <div className={styles.feedHealthRow}>
          <dt className={styles.feedHealthLabel}>Reading project</dt>
          <dd className={styles.feedHealthValue}>
            {health.projectRef ?? "None — configuration check failed"}
          </dd>
        </div>
        <div className={styles.feedHealthRow}>
          <dt className={styles.feedHealthLabel}>Expected project</dt>
          <dd className={styles.feedHealthValue}>
            {health.expectedProjectRef ?? "Unknown"}
          </dd>
        </div>
        {mismatch ? (
          <div className={styles.feedHealthRow}>
            <dt className={styles.feedHealthLabel}>Data source</dt>
            <dd className={styles.feedHealthWarning}>
              The environment points at project {health.envProjectRef}, but
              this deployment expects {health.expectedProjectRef}. The
              storefront is reading a different database than intended.
            </dd>
          </div>
        ) : null}
        {!health.configured ? (
          <div className={styles.feedHealthRow}>
            <dt className={styles.feedHealthLabel}>Configuration</dt>
            <dd className={styles.feedHealthWarning}>
              The public feed configuration check failed
              {health.envProjectRef
                ? ` (environment points at ${health.envProjectRef})`
                : " (no Supabase URL configured)"}
              . The storefront cannot read any project until this is fixed.
            </dd>
          </div>
        ) : null}
        <div className={styles.feedHealthRow}>
          <dt className={styles.feedHealthLabel}>Allowlist feed</dt>
          <dd>
            {health.allowlistOk ? (
              <>
                {health.allowlistCount} product
                {health.allowlistCount === 1 ? "" : "s"}
              </>
            ) : (
              <span className={styles.feedHealthWarning}>
                Failed ({health.allowlistError ?? "unknown error"})
              </span>
            )}
          </dd>
        </div>
        <div className={styles.feedHealthRow}>
          <dt className={styles.feedHealthLabel}>Published products</dt>
          <dd>
            {health.publishedOk ? (
              <>
                {health.publishedCount} product
                {health.publishedCount === 1 ? "" : "s"}
              </>
            ) : (
              <span className={styles.feedHealthWarning}>
                Failed ({health.publishedError ?? "unknown error"})
                {health.publishedError === "http-404"
                  ? " — the publication feed was not found; migration 20261115000800 may not be applied to this project."
                  : ""}
              </span>
            )}
          </dd>
        </div>
      </dl>

      <p className={styles.feedHealthFootnote}>
        Counts exclude design-review copies. Project refs only — no
        credentials are shown. A failed data call shows shoppers a
        &ldquo;catalogue unavailable&rdquo; state instead of an empty
        catalogue.
      </p>
    </section>
  );
}
