import type { StorefrontFeedHealth } from "@/lib/catalog-publication";
import styles from "./catalogue-v2.module.css";

/**
 * Admin-only storefront publication counts (products page). Shows the
 * published-products count from the storefront feed read — nothing
 * technical: no project refs, no per-source diagnostics, no footnotes.
 *
 * NOTE: an unpublished-products count is deliberately NOT shown: it
 * cannot be derived from the data this page loads (the product list
 * is filtered + paginated, and the feed read carries no catalogue
 * total), and an estimate would be a fake number. A follow-up read
 * can add it; see ADMIN_REDESIGN_V2_CLIENT_FIXES_REPORT.md.
 */
export function FeedHealthIndicator({
  health,
}: {
  health: StorefrontFeedHealth | null;
}) {
  const publishedCount =
    health !== null && health.publishedOk ? health.publishedCount : null;

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
      </dl>
    </section>
  );
}
