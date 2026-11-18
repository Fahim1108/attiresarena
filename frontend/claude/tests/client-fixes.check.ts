import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Client-fixes regression checks (2026-11-18, owner request):
 * (1) the storefront feed card shows only the published-products
 * count — no project refs, no allowlist row, no footnote;
 * (2) card-table action cells use a symmetrical 2-column grid on
 * phones; (3) anchors carrying .aa-secondary get the button box.
 */

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/** CSS declarations between a selector's opening brace and its close. */
function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  expect(close).toBeGreaterThan(open);
  return css.slice(open, close);
}

const feedCard = read("../src/components/admin/catalog/feed-health-indicator.tsx");
const catalogueModule = read("../src/components/admin/catalog/catalogue-v2.module.css");
const adminPanel = read("../src/app/admin/admin-panel.css");
const adminCss = read("../src/app/admin/admin.css");

it("feed card shows the published-products count", () => {
  expect(feedCard).toContain("Published products");
  expect(feedCard).toContain("Could not be checked");
});

it("feed card carries no project refs, allowlist row, or footnote", () => {
  for (const banned of [
    "Reading project",
    "Expected project",
    "Allowlist feed",
    "design-review",
    "projectRef",
    "envProjectRef",
    "expectedProjectRef",
    "feedHealthStatus",
    "StatusBadge",
    "feedHealthWarning",
    "feedHealthFootnote",
    "catalogue unavailable",
  ]) {
    expect(feedCard).not.toContain(banned);
  }
  expect(catalogueModule).not.toContain(".feedHealthWarning");
  expect(catalogueModule).not.toContain(".feedHealthFootnote");
});

it("phone action cells use a symmetrical equal-width grid", () => {
  const block = ruleBlock(
    adminPanel,
    ".aa-table:has(td[data-label]) tbody td.aa-cell-actions {",
  );
  expect(block).toContain("display: grid;");
  expect(block).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
  expect(adminPanel).toContain(
    ".aa-table:has(td[data-label]) tbody td[data-label].aa-cell-actions::before {",
  );
  expect(adminPanel).toContain(
    ".aa-table:has(td[data-label]) tbody td.aa-cell-actions > form > .aa-row-action {",
  );
});

it("secondary anchors get the button box without touching colors", () => {
  const block = ruleBlock(adminCss, ".aa-admin a.aa-secondary {");
  expect(block).toContain("display: inline-flex;");
  expect(block).toContain("align-items: center;");
  expect(block).toContain("justify-content: center;");
  expect(block).toContain("min-height: 44px;");
  expect(block).toContain("padding: 10px 18px;");
  expect(block).toContain("border-width: 1px;");
  expect(block).toContain("border-style: solid;");
  expect(block).not.toContain("background");
  expect(block).not.toContain("border-color");
  expect(block).not.toContain("color:");
});
