import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Unpublished-count checks (2026-11-18, owner request): the feed card
 * shows published + unpublished counts, where unpublished = catalogue
 * total − published-feed count, so the two rows sum to the whole
 * catalogue. The total comes from one staff-gated head-count read;
 * no migration, no RPC.
 */

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/** Function body between a function declaration and its closing brace. */
function functionBlock(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n}\n", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const feedCard = read("../src/components/admin/catalog/feed-health-indicator.tsx");
const feedLib = read("../src/lib/catalog-publication.ts");
const catalogProducts = read("../src/lib/admin/catalog-products.ts");

it("feed card shows published and unpublished rows", () => {
  expect(feedCard).toContain("Published products");
  expect(feedCard).toContain("Unpublished products");
  expect(feedCard).toContain("Could not be checked");
});

it("unpublished is total minus published, clamped at zero", () => {
  expect(feedCard).toContain("Math.max(0, catalogueTotal - publishedCount)");
});

it("feed card carries no technical text", () => {
  for (const banned of [
    "projectRef",
    "envProjectRef",
    "expectedProjectRef",
    "Allowlist feed",
    "design-review",
    "feedHealthStatus",
    "StatusBadge",
    "feedHealthWarning",
    "feedHealthFootnote",
    "catalogue unavailable",
  ]) {
    expect(feedCard).not.toContain(banned);
  }
});

it("health type carries the staff-only catalogue total", () => {
  expect(feedLib).toContain("StorefrontFeedHealthWithCatalogueTotal");
  expect(feedLib).toContain("catalogueTotal: number | null");
  expect(feedCard).toContain("StorefrontFeedHealthWithCatalogueTotal");
});

it("catalogue total is one staff-gated head-count read, no RPC", () => {
  const block = functionBlock(
    catalogProducts,
    "async function readCatalogueTotal",
  );
  expect(block).toContain('.from("products")');
  expect(block).toContain('count: "exact"');
  expect(block).toContain("head: true");
  expect(block).not.toContain(".rpc(");
  expect(block).toContain("total.error");
  expect(catalogProducts).toContain("readCatalogueTotal(session.client)");
  expect(catalogProducts).toContain('requireStaff(areaRoles("catalogue"))');
});
