import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Capsule-button regression checks (2026-11-18, owner request): every
 * admin text button is a pill (border-radius 999px). These pin the
 * central shape rule in admin-ds.css, the higher-specificity button
 * rules that carry their own 999px declarations, and the guardrails:
 * the unscoped .aa-button base in admin.css keeps 7px (storefront
 * buttons), underline tabs keep radius 0, inputs keep the control
 * radius, and the shared Button component is untouched.
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

const adminDs = read("../src/app/admin/admin-ds.css");
const adminPanel = read("../src/app/admin/admin-panel.css");
const loginCss = read("../src/app/admin/login.css");
const workspaceCss = read("../src/app/admin/workspace.css");
const adminCss = read("../src/app/admin/admin.css");
const buttonTsx = read("../src/components/ui/Button.tsx");
const modalTsx = read("../src/components/ui/Modal.tsx");

it("keeps the central capsule rule for admin + dialog buttons", () => {
  expect(adminDs).toContain(".aa-admin button,");
  expect(adminDs).toContain(".aa-admin .aa-button,");
  expect(adminDs).toContain(".aa-admin .aa-secondary,");
  expect(adminDs).toContain(".aa-modal-portal button,");
  expect(adminDs).toContain(".aa-modal-portal .aa-button,");
  expect(adminDs).toContain(".aa-modal-portal .aa-secondary {");
  const block = ruleBlock(adminDs, ".aa-admin button,");
  expect(block).toContain("border-radius: 999px;");
});

it("keeps the higher-specificity admin-ds button rules pill-shaped", () => {
  expect(ruleBlock(adminDs, ".aa-admin .aa-admin-ds .aa-top .aa-collapse-toggle {")).toContain(
    "border-radius: 999px;",
  );
  expect(ruleBlock(adminDs, ".aa-admin .aa-main--ds .aa-pagination a,")).toContain(
    "border-radius: 999px;",
  );
  expect(
    ruleBlock(
      adminDs,
      ".aa-admin .aa-login--ds .aa-form button:not(:disabled):not([data-danger])",
    ),
  ).toContain("border-radius: 999px;");
  expect(ruleBlock(adminDs, ".aa-admin .aa-login--ds .aa-secondary:not(:disabled) {")).toContain(
    "border-radius: 999px;",
  );
  expect(
    ruleBlock(adminDs, ".aa-admin-ds .aa-orders-v2 .aa-button:not(:disabled):not([data-danger]) {"),
  ).toContain("border-radius: 999px;");
  expect(
    ruleBlock(adminDs, ".aa-admin-ds .aa-orders-v2 .aa-secondary:not(:disabled) {"),
  ).toContain("border-radius: 999px;");
});

it("keeps row actions, icon buttons, and pagination pill-shaped", () => {
  expect(ruleBlock(adminPanel, ".aa-admin button.aa-row-action,")).toContain(
    "border-radius: 999px;",
  );
  expect(ruleBlock(adminPanel, ".aa-admin .aa-icon-button {")).toContain("border-radius: 999px;");
  expect(ruleBlock(adminPanel, ".aa-admin .aa-pagination a,")).toContain("border-radius: 999px;");
});

it("keeps the login submit and password-eye controls pill-shaped", () => {
  expect(loginCss).toContain(".aa-login-submit{width:100%;min-height:46px;border-radius:999px;");
  expect(loginCss).toContain("border-radius:999px;min-height:44px;width:44px;");
});

it("keeps the workspace button base pill-shaped", () => {
  expect(workspaceCss).toContain(
    ".aa-admin--workspace button,.aa-admin--workspace .aa-button{background:#6b0202;border-color:#6b0202;gap:7px;font-size:13px;border-radius:999px}",
  );
  // Mobile bottom nav items beat the central rule on specificity
  // (0,2,1 inside the phone media query), so they carry their own 999px.
  expect(workspaceCss).toContain(
    ".aa-admin--workspace .aa-admin-bottom>a,.aa-admin--workspace .aa-admin-bottom>button{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:5px;flex:1;min-width:0;min-height:52px;border:0;border-radius:999px;",
  );
});

it("marks both Modal/Overlay portal roots for dialog button coverage", () => {
  expect(modalTsx.match(/className="aa-modal-portal fixed inset-0/g)?.length).toBe(2);
  // .aa-dialog already styles native <dialog> elements (border, 26rem
  // max-width) — reusing it on the full-viewport portal roots would
  // shrink the overlay. The marker must stay distinct.
  expect(modalTsx).not.toContain('className="aa-dialog ');
});

it("keeps the storefront button base at 7px (admin.css untouched)", () => {
  expect(adminCss).not.toContain("999px");
  expect(ruleBlock(adminCss, ".aa-admin button,")).toContain("border-radius: 7px;");
  expect(buttonTsx).toContain('rounded-control');
  expect(buttonTsx).not.toContain("999px");
});

it("keeps underline tabs square and the switch track pill-shaped", () => {
  expect(ruleBlock(adminPanel, '.aa-admin div[role="tablist"] [role="tab"] {')).toContain(
    "border-radius: 0;",
  );
  expect(workspaceCss).toContain(".aa-workspace-tabs button{flex-shrink:0;border:0;border-bottom:2px solid transparent;border-radius:0;");
  expect(ruleBlock(adminPanel, '.aa-admin button[role="switch"] {')).toContain(
    "border-radius: 999px;",
  );
});

it("keeps inputs and navigation links on the control radius", () => {
  expect(
    ruleBlock(adminDs, ".aa-admin .aa-main--ds .aa-field input,"),
  ).toContain("border-radius: var(--admin-radius-control);");
  expect(ruleBlock(adminDs, ".aa-admin .aa-admin-ds .aa-sidebar nav a,")).toContain(
    "border-radius: var(--admin-radius-control);",
  );
  expect(adminPanel).toContain("border-radius: var(--aa-radius-control);");
});
