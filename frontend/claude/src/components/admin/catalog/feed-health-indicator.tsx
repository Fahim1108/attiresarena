import type { StorefrontFeedHealthWithCatalogueTotal } from "@/lib/catalog-publication";
import styles from "./catalogue-v2.module.css";

/**
 * Admin-only storefront publication counts (products page). Shows two
 * real numbers and nothing technical: no project refs, no per-source
 * diagnostics, no footnotes.
 *
 * DEFINITION (decided 2026-11-18): unpublished = catalogue total
 * MINUS the published-feed count, i.e. every product NOT in the
 * published-feed result set — archived, never published, or missing
 * the media/variants/category the feed requires. Published +
 * unpublished = the whole catalogue. The two reads happen at
 * slightly different times, so a transient race can make the total
 * momentarily smaller than the published count; the difference is
 * clamped at zero rather than showing a negative count.
 */
export function FeedHealthIndicator({
  health,
}: {
  health: StorefrontFeedHealthWithCatalogueTotal | null;
}) {
  const publishedCount =
    health !== null && health.publishedOk ? health.publishedCount : null;
  const catalogueTotal = health?.catalogueTotal ?? null;
  const unpublishedCount =
    publishedCount !== null && catalogueTotal !== null
      ? Math.max(0, catalogueTotal - publishedCount)
      : null;

  return (
    <section className={styles.feedHealth} aria-label="Storefront feed">
      <div className={styles.feedHealthHead}>
        <span className={styles.feedHealthTitle}>Storefront feed</span>
      </div>

      <dl className={styles.feedHealthRows}>
        <div className={styles.feedHealthRow}>
          <dt className={styles.feedHealthLabel}>Published products</dt>
          <dd className={styles.feedHealthValue}>
            {publishedCount === null ? (
              "Could not be checked"
            ) : (
              <>
                {publishedCount} product{publishedCount === 1 ? "" : "s"}
              </>
            )}
          </dd>
        </div>
        <div className={styles.feedHealthRow}>
          <dt className={styles.feedHealthLabel}>Unpublished products</dt>
          <dd className={styles.feedHealthValue}>
            {unpublishedCount === null ? (
              "Could not be checked"
            ) : (
              <>
                {unpublishedCount} product{unpublishedCount === 1 ? "" : "s"}
              </>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
