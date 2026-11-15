/**
 * Display-only sample-data contract for Admin Panel v2 (owner item 7).
 *
 * RULES (non-negotiable, from the owner):
 * - Sample data is rendered ONLY when a live query is UNAVAILABLE (the loader
 *   returns null: config missing, table missing, or the query failed). A live
 *   empty array means "genuinely empty" and MUST render an honest empty state,
 *   never sample rows.
 * - EVERY surface rendering sample data MUST visibly render <SampleBadge />.
 * - Sample data is NEVER persisted, NEVER sent in a mutation, and NEVER mixed
 *   into real totals, counts, or KPIs. Sample rows must not carry working
 *   edit/delete/publish actions that would write sample ids to the database:
 *   detail links on sample rows go nowhere actionable (or are omitted).
 * - Analytics, profit, and revenue surfaces MUST NOT use sample data. The
 *   dashboard and /admin/analytics render honest empty states when live data
 *   is unavailable.
 * - Datasets live in per-area modules owned by one builder each:
 *   `sample-catalogue.ts` (catalogue), `sample-sales.ts` (sales). Dataset
 *   modules MUST use `import type` only when referencing loader types, so no
 *   server-only code leaks into the client bundle.
 *
 * REMOVAL: delete the per-area dataset modules, the resolveDisplayData call
 * sites, and this file plus SampleBadge. No database change is involved.
 */

export type DataSource = "live" | "sample";

export interface DisplayData<T> {
  items: T[];
  isSample: boolean;
}

/**
 * Resolve a list for display. `live === null` means the live query was
 * unavailable (not merely empty): the sample dataset is shown, flagged.
 * A live array — including an empty one — is always returned as-is.
 */
export function resolveDisplayData<T>(
  live: readonly T[] | null,
  sample: readonly T[],
): DisplayData<T> {
  if (live === null) {
    return { items: [...sample], isSample: true };
  }
  return { items: [...live], isSample: false };
}

export interface DisplayRecord<T> {
  record: T;
  isSample: boolean;
}

/** Single-record variant of resolveDisplayData (same null-means-unavailable rule). */
export function resolveDisplayRecord<T>(live: T | null, sample: T): DisplayRecord<T> {
  if (live === null) {
    return { record: sample, isSample: true };
  }
  return { record: live, isSample: false };
}
