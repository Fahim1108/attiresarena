import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Admin speed (client-feedback item 17) structural guards.
 *
 * These pin the shape of the fix, not the numbers (the numbers are
 * pinned by tests/dashboard-sections.check.ts): the dashboard and
 * analytics pages must stream behind Suspense instead of awaiting
 * every query before any JSX, and the 500-product catalogue read must
 * live in the (store) layout only — never in the root layout that
 * every route, including /admin/sign-in, pays for.
 */

function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

describe("root layout skips the catalogue/cart read", () => {
  it("never fetches products or the cart", () => {
    const layout = readSource("src/app/layout.tsx");
    expect(layout).not.toContain("getProducts(");
    expect(layout).not.toContain("getInitialCart(");
    expect(layout).not.toContain("CartProvider");
    expect(layout).not.toContain("WishlistProvider");
  });

  it("still provides the storefront settings shell", () => {
    const layout = readSource("src/app/layout.tsx");
    expect(layout).toContain("getStorefrontSettings()");
    expect(layout).toContain("StorefrontProvider");
  });
});

describe("storefront layout owns the catalogue/cart read", () => {
  it("fetches the catalogue and cart and provides cart + wishlist", () => {
    const layout = readSource("src/app/(store)/layout.tsx");
    expect(layout).toContain("getProducts({pageSize:500})");
    expect(layout).toContain("getInitialCart()");
    expect(layout).toContain("CartProvider");
    expect(layout).toContain("WishlistProvider");
  });
});

describe("dashboard streams behind Suspense", () => {
  it("starts the section load without awaiting the whole dashboard", () => {
    const page = readSource("src/app/admin/(workspace)/page.tsx");
    expect(page).toContain("startDashboardLoad(session.client, range)");
    expect(page).toContain("Suspense");
    expect(page).not.toContain("await loadDashboard(");
  });
});

describe("analytics streams report and visitors in parallel", () => {
  it("starts both reads without awaiting either before the shell", () => {
    const page = readSource("src/app/admin/(workspace)/analytics/page.tsx");
    expect(page).toContain("const reportPromise = getAnalyticsReport(params)");
    expect(page).toContain("const visitorPromise = getVisitorReport(visitorPeriod)");
    expect(page).toContain("Suspense");
    expect(page).not.toContain("await getAnalyticsReport(");
    expect(page).not.toContain("await getVisitorReport(");
  });
});
