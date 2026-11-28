import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Admin notification bell (2026-11-28, owner request): a bell in the
 * top-right of the admin header, with a red round badge showing the
 * white count of new orders. The count is defined as orders still in
 * "pending" — the new/unconfirmed state; there is no seen/unread flag
 * on orders, so pending is the honest "new order" number. The bell
 * links to the orders list. Static checks in the style of the other
 * admin checks: they pin the wiring (count query, layout prop, shell
 * markup, badge CSS) without a live database.
 */

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const ordersTs = read("../src/lib/admin/orders.ts");
const layoutTsx = read("../src/app/admin/(workspace)/layout.tsx");
const shellTsx = read(
  "../src/components/admin/access/AdminShell.tsx",
);
const adminDs = read("../src/app/admin/admin-ds.css");

it("counts pending orders for the bell, degrading to 0, never throwing", () => {
  expect(ordersTs).toContain("export async function readPendingOrderCount()");
  expect(ordersTs).toContain('.eq("status", "pending")');
  expect(ordersTs).toContain('select("id", { count: "exact", head: true })');
  expect(ordersTs).toContain("if (!adminConfiguration()) return 0;");
  expect(ordersTs).toContain("if (result.error) return 0;");
});

it("passes the pending count from the workspace layout into the shell", () => {
  expect(layoutTsx).toContain("readPendingOrderCount");
  expect(layoutTsx).toContain(
    "const pendingOrderCount = session ? await readPendingOrderCount() : 0;",
  );
  expect(layoutTsx).toContain("pendingOrderCount={pendingOrderCount}");
});

it("renders the bell in the header, gated on orders access, linking to the orders list", () => {
  expect(shellTsx).toContain("pendingOrderCount");
  expect(shellTsx).toContain('href="/admin/sales/orders"');
  expect(shellTsx).toContain('className="aa-notification-bell"');
  expect(shellTsx).toContain('className="aa-notification-badge"');
  expect(shellTsx).toContain('className="aa-top-actions"');
  // Same gate as the Orders nav link: staff without orders access get
  // no bell instead of a link to a page they cannot open.
  const bellAt = shellTsx.indexOf('className="aa-notification-bell"');
  const gateAt = shellTsx.lastIndexOf('hasArea("orders")', bellAt);
  expect(gateAt).toBeGreaterThanOrEqual(0);
  // No badge at zero; the count caps at 99+.
  expect(shellTsx).toContain("pendingOrderCount > 0");
  expect(shellTsx).toContain('"99+"');
});

it("styles the badge red and round with a white number, and keeps the bell tappable on phones", () => {
  const badgeAt = adminDs.indexOf(".aa-notification-badge {");
  expect(badgeAt).toBeGreaterThanOrEqual(0);
  const badge = adminDs.slice(badgeAt, badgeAt + 600);
  expect(badge).toContain("background: rgb(var(--admin-danger));");
  expect(badge).toContain("color: #fff;");
  expect(badge).toContain("border-radius: 999px;");
  // The bell and the environment pill share one right-side group, so
  // the bell stays top-right on the phone grid instead of wrapping.
  expect(adminDs).toContain(".aa-top-actions {");
  const phoneAt = adminDs.indexOf("@media (max-width: 767px)");
  expect(phoneAt).toBeGreaterThanOrEqual(0);
  const phone = adminDs.slice(phoneAt);
  expect(phone).toContain(".aa-notification-bell {");
  expect(phone).toContain("width: 44px;");
});
