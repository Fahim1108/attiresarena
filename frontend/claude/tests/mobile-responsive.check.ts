import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Mobile-pass regression checks (2026-11-15). These pin the shipped CSS
 * values and TSX structure behind the 390px pass: 16px text entry (no iOS
 * zoom trap), 44px coarse-pointer targets, labelled card tables, and no
 * fixed element width wider than a phone in the touched stylesheets.
 * Counts below were verified against the tree at authoring time; a table
 * edit that drops a data-label fails here instead of silently returning
 * that table to sideways scroll on phones.
 */

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const adminPanel = read("../src/app/admin/admin-panel.css");
const globals = read("../src/app/globals.css");
const footerCss = read("../src/components/layout/Footer.module.css");
const pieCss = read("../src/components/admin/charts/PieChart.module.css");
const barsCss = read("../src/components/admin/charts/HorizontalBarList.module.css");

it("keeps admin text entry at 16px on phones (no iOS zoom trap)", () => {
  expect(adminPanel).toContain("@media (max-width: 767px)");
  expect(adminPanel).toContain(".aa-admin input,");
  expect(adminPanel).toContain(".aa-admin select,");
  expect(adminPanel).toContain(".aa-admin textarea");
  expect(adminPanel).toContain("font-size: 16px;");
});

it("keeps the storefront 16px backstop for unclassed controls", () => {
  expect(globals).toContain("@media (max-width: 767px)");
  const block = globals.slice(globals.indexOf("@media (max-width: 767px)"));
  expect(block).toContain("font-size: 16px;");
});

it("keeps 44px coarse-pointer targets in the admin drawer and check rows", () => {
  expect(adminPanel).toContain("@media (pointer: coarse)");
  expect(adminPanel).toContain(".aa-admin .aa-drawer nav a");
  expect(adminPanel).toContain(".aa-admin .aa-nav-group summary");
  expect(adminPanel).toContain(".aa-admin .aa-check-row label");
  expect(adminPanel).toContain("min-height: 44px;");
});

it("keeps 44px touch rows for pie legend links and bar names", () => {
  expect(pieCss).toContain("@media (pointer: coarse)");
  expect(pieCss).toContain("min-height: 44px;");
  expect(barsCss).toContain("@media (pointer: coarse)");
  expect(barsCss).toContain("min-height: 44px;");
});

it("keeps the card-table reflow rules for labelled tables", () => {
  expect(adminPanel).toContain(".aa-table:has(td[data-label])");
  expect(adminPanel).toContain("border-collapse: separate;");
  expect(adminPanel).toContain('td[data-label]:not([data-label=""])::before');
  expect(adminPanel).toContain("content: attr(data-label);");
  expect(adminPanel).toContain("clip: rect(0, 0, 0, 0);");
  expect(adminPanel).toContain("tbody td[colspan] { display: block; }");
});

it("keeps the contained scroll fallback for unlabelled tables", () => {
  expect(adminPanel).toContain(".aa-table-scroll { overflow-x: auto;");
  expect(adminPanel).toContain("overscroll-behavior-x: contain;");
});

it("keeps chart axis text enlarged on phones", () => {
  expect(adminPanel).toContain(".aa-chart svg text { font-size: 14px; }");
  expect(adminPanel).toContain(".aa-chart svg { overflow: visible; }");
});

it("labels every admin table cell (except the checkbox and empty-state rows)", () => {
  // [file, <td occurrences, data-label occurrences]
  const expected: Array<[string, number, number]> = [
    ["../src/components/admin/catalog/product-list-table.tsx", 7, 6],
    ["../src/app/admin/(workspace)/sales/customers/page.tsx", 7, 7],
    ["../src/app/admin/(workspace)/sales/coupons/page.tsx", 6, 6],
    ["../src/app/admin/(workspace)/sales/incomplete/page.tsx", 7, 7],
    ["../src/app/admin/(workspace)/catalog/inventory/page.tsx", 13, 11],
    ["../src/app/admin/(workspace)/analytics/page.tsx", 4, 4],
    ["../src/app/admin/(workspace)/page.tsx", 9, 9],
    ["../src/app/admin/(workspace)/sales/orders/[id]/page.tsx", 0, 0],
    ["../src/components/admin/sales/OrderInvoice.tsx", 6, 4],
    ["../src/app/admin/(workspace)/sales/customers/[phone]/page.tsx", 4, 4],
    ["../src/app/admin/(workspace)/sales/incomplete/[id]/page.tsx", 4, 4],
    ["../src/app/admin/(workspace)/sales/coupons/[id]/page.tsx", 2, 2],
    ["../src/app/admin/(workspace)/sales/orders/page.tsx", 5, 5],
    ["../src/components/admin/content/banner-list.tsx", 5, 5],
    ["../src/components/admin/content/widget-list.tsx", 6, 6],
    ["../src/components/admin/system/redirect-list.tsx", 4, 4],
    ["../src/components/admin/charts/BarChart.tsx", 2, 2],
    ["../src/components/admin/charts/SeriesChart.tsx", 2, 2],
    ["../src/components/admin/catalog/variant-editor.tsx", 1, 1],
  ];
  for (const [path, tdTotal, labelled] of expected) {
    const src = read(path);
    expect(count(src, "<td"), path).toBe(tdTotal);
    expect(count(src, "data-label"), path).toBe(labelled);
  }
});

it("keeps 44px targets on small storefront controls", () => {
  const button = read("../src/components/ui/Button.tsx");
  expect(button).toContain("[@media(pointer:coarse)]:h-11");
  const stepper = read("../src/components/product/QuantitySelector.tsx");
  expect(stepper).toContain("[@media(pointer:coarse)]:h-11");
  expect(stepper).toContain("[@media(pointer:coarse)]:w-11");
  const hero = read("../src/components/home/Hero.tsx");
  expect(hero).toContain("flex h-11 w-11 items-center justify-center");
  expect(hero).toContain("sm:h-[clamp(44px,3.4vw,50px)]");
  const pagination = read("../src/components/catalog/Pagination.tsx");
  expect(pagination).toContain("flex flex-wrap items-center justify-center");
});

it("keeps 44px footer targets on phones", () => {
  expect(footerCss).toContain("width: 44px;");
  expect(footerCss).toContain("height: 44px;");
  expect(footerCss).toContain("min-height: 44px;");
});

it("has no fixed element width wider than a phone in the touched stylesheets", () => {
  for (const [name, css] of [
    ["admin-panel.css", adminPanel],
    ["globals.css", globals],
    ["Footer.module.css", footerCss],
    ["PieChart.module.css", pieCss],
    ["HorizontalBarList.module.css", barsCss],
  ] as const) {
    // Drop @media prelude lines: their min/max-width values are breakpoints.
    const rules = css
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("@media"))
      .join("\n");
    const widths = [...rules.matchAll(/(?<!max-)width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    for (const width of widths) {
      expect(width, `${name} width ${width}px`).toBeLessThanOrEqual(390);
    }
  }
});

it("uses no transition: all in the touched stylesheets", () => {
  for (const css of [adminPanel, globals, footerCss, pieCss, barsCss]) {
    expect(css).not.toContain("transition: all");
    expect(css).not.toContain("transition:all");
  }
});

it("still honors prefers-reduced-motion in the touched stylesheets", () => {
  expect(adminPanel).toContain("@media (prefers-reduced-motion: reduce)");
  expect(globals).toContain("@media (prefers-reduced-motion: reduce)");
  expect(footerCss).toContain("@media (prefers-reduced-motion: reduce)");
});
