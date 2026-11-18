import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Mobile admin shell regression checks (2026-11-18, owner report):
 * on production phones the admin content squeezed into the left ~55%
 * of the screen because the design-system shell grid (`240px
 * minmax(0, 1fr)` at 0,3,0) beat the legacy phone collapse (0,1,0)
 * while the sidebar was `display: none`, so `.aa-content` auto-placed
 * into the 240px first column. Staging masked it via the staging-only
 * `display: block` shell rule. These pin the phone collapse (both
 * sidebar states), the orderly phone layout of the segmented period
 * toggle, and the word-boundary wrapping of KPI/status labels.
 * Numeric values deliberately keep `overflow-wrap: anywhere` as
 * overflow safety for long unbroken numbers; labels must not.
 */

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const adminDs = read("../src/app/admin/admin-ds.css");
const periodToggleCss = read(
  "../src/components/admin/PeriodToggle.module.css",
);
const statCardTsx = read("../src/components/design-system/StatCard.tsx");
const dashboardTsx = read("../src/app/admin/(workspace)/page.tsx");
const csvDownloadTsx = read(
  "../src/components/admin/analytics/csv-download.tsx",
);

it("collapses the admin shell grid to one column on phones, both sidebar states", () => {
  const anchor = adminDs.indexOf("The shell grid MUST collapse here too");
  expect(anchor).toBeGreaterThanOrEqual(0);
  const block = adminDs.slice(anchor, anchor + 1200);
  expect(block).toContain(".aa-admin .aa-admin-ds.aa-shell,");
  expect(block).toContain(
    '.aa-admin .aa-admin-ds.aa-shell[data-sidebar="collapsed"] {',
  );
  expect(block).toContain("grid-template-columns: minmax(0, 1fr);");
});

it("lays the period toggle out in orderly rows on phones", () => {
  const start = periodToggleCss.indexOf("@media (max-width: 767px)");
  expect(start).toBeGreaterThanOrEqual(0);
  const block = periodToggleCss.slice(start);
  expect(block).toContain("display: flex;");
  expect(block).toContain("width: 100%;");
  expect(block).toContain("border-radius: 1rem;");
  expect(block).toContain("flex: 1 1 40%;");
  expect(block).toContain("white-space: nowrap;");
});

it("wraps KPI labels at word boundaries, keeping anywhere only on the value", () => {
  expect(statCardTsx).toContain(
    "break-words text-xs font-medium leading-5",
  );
  expect(statCardTsx).toContain('className="break-words">{trend.label}</span>');
  expect(statCardTsx).toContain("break-words text-[13px] leading-5");
  // Exactly one anywhere left: the numeric value (overflow safety).
  expect(statCardTsx.match(/\[overflow-wrap:anywhere\]/g)).toHaveLength(1);
});

it("wraps dashboard status labels at word boundaries, keeping anywhere only on the count", () => {
  const start = dashboardTsx.indexOf("function StatusCell");
  const end = dashboardTsx.indexOf("function ChartSummary", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const block = dashboardTsx.slice(start, end);
  expect(block).toContain("break-words text-[13px] font-medium leading-5");
  expect(block.match(/\[overflow-wrap:anywhere\]/g)).toHaveLength(1);
});

it("keeps the CSV download label on one line", () => {
  expect(csvDownloadTsx).toContain("whitespace-nowrap");
});
