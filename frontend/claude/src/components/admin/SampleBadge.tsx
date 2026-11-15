import { StatusBadge } from "./ui";

/**
 * Visible "Sample data" marker. Render on EVERY surface showing fabricated
 * display-only rows (see lib/admin/sample-data.ts). Never render on real
 * data, and never on analytics/profit/revenue surfaces.
 */
export function SampleBadge() {
  return (
    <StatusBadge tone="warning">
      <span title="Sample data for UX testing only. Not real store data and never saved.">
        Sample data
      </span>
    </StatusBadge>
  );
}
