import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTestDataEraseCounts } from "../src/lib/admin/settings-shared";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationPath = join(
  repoRoot,
  "supabase/migrations/20261123000100_test_data_erase.sql",
);
const migration = readFileSync(migrationPath, "utf8");

// New scope (2026-11-24, Fahim chose it from client feedback): orders,
// delivery and profit data, checkout data, reviews, coupons, banners go;
// products, customer details and visitor data all stay.
const validCounts = {
  orders: 3,
  order_items: 5,
  payment_submissions: 2,
  order_shipments: 0,
  courier_booking_claims: 0,
  coupon_redemptions: 1,
  checkout_sessions: 4,
  checkout_items: 6,
  abandoned_recovery_log: 0,
  checkout_rate_events: 9,
  product_reviews: 1,
  review_moderation_log: 0,
  coupons: 1,
  banners: 2,
};

const settingsSource = readFileSync(
  join(repoRoot, "frontend/claude/src/lib/admin/settings.ts"),
  "utf8",
);
const accountSource = readFileSync(
  join(repoRoot, "frontend/claude/src/lib/admin/account.ts"),
  "utf8",
);
const formsSource = readFileSync(
  join(repoRoot, "frontend/claude/src/components/admin/settings/forms.tsx"),
  "utf8",
);

describe("password re-authentication", () => {
  it("eraseTestData reads the password from the form", () => {
    expect(settingsSource).toContain('formText(form, "password")');
  });

  it("checks ERASE, then the password, then the RPC — in that order", () => {
    const eraseStart = settingsSource.indexOf("export async function eraseTestData");
    expect(eraseStart).toBeGreaterThan(-1);
    const body = settingsSource.slice(eraseStart);
    const confirmationAt = body.indexOf('formText(form, "confirmation")');
    const passwordAt = body.indexOf('formText(form, "password")');
    const verifyAt = body.indexOf("verifyStaffPassword(email, password)");
    const rpcAt = body.indexOf('rpc("admin_test_data_erase"');
    expect(confirmationAt).toBeGreaterThan(-1);
    expect(passwordAt).toBeGreaterThan(confirmationAt);
    expect(verifyAt).toBeGreaterThan(passwordAt);
    expect(rpcAt).toBeGreaterThan(verifyAt);
  });

  it("wrong password blocks the erase with a clear error, nothing deleted", () => {
    const eraseStart = settingsSource.indexOf("export async function eraseTestData");
    const body = settingsSource.slice(eraseStart);
    const wrongPasswordAt = body.indexOf("ভুল পাসওয়ার্ড");
    expect(wrongPasswordAt).toBeGreaterThan(-1);
    expect(body).toContain("the password is incorrect. Nothing was deleted.");
    // The wrong-password return sits before the RPC call: no partial erase.
    expect(wrongPasswordAt).toBeLessThan(body.indexOf('rpc("admin_test_data_erase"'));
  });

  it("empty password also blocks the erase", () => {
    expect(settingsSource).toContain(
      "Enter your admin login password to confirm the erase. Nothing was deleted.",
    );
  });

  it("the password never reaches the database or the audit log", () => {
    // The RPC call carries only the ERASE word.
    const rpcStart = settingsSource.indexOf('rpc("admin_test_data_erase"');
    const rpcEnd = settingsSource.indexOf("});", rpcStart);
    expect(rpcStart).toBeGreaterThan(-1);
    expect(rpcEnd).toBeGreaterThan(rpcStart);
    expect(settingsSource.slice(rpcStart, rpcEnd)).not.toContain("password");
    // The migration knows nothing about passwords at all.
    expect(migration.toLowerCase()).not.toContain("password");
    // Neither server module logs anything that could carry the password.
    expect(settingsSource).not.toContain("console.");
    expect(accountSource).not.toContain("console.");
  });

  it("verifyStaffPassword uses a throwaway in-memory client, server-side only", () => {
    expect(accountSource).toContain(
      "export async function verifyStaffPassword(",
    );
    const helperStart = accountSource.indexOf(
      "export async function verifyStaffPassword(",
    );
    const helper = accountSource.slice(helperStart, helperStart + 800);
    expect(helper).toContain("persistSession: false");
    expect(helper).toContain("autoRefreshToken: false");
    expect(helper).toContain("signInWithPassword");
    expect(helper).toContain("Promise<boolean>");
    // changeOwnPassword reuses the same helper instead of its own check.
    expect(accountSource).toContain(
      "verifyStaffPassword(email, parsed.data.currentPassword)",
    );
    expect(accountSource.split("auth.signInWithPassword").length - 1).toBe(1);
  });

  it("the dialog asks for the password and keeps erase disabled without it", () => {
    expect(formsSource).toContain('name="password"');
    expect(formsSource).toContain('type="password"');
    expect(formsSource).toContain('autoComplete="current-password"');
    expect(formsSource).toContain(
      'disabled={confirmText !== "ERASE" || password.length === 0}',
    );
    // ERASE alone no longer enables the button.
    expect(formsSource).not.toContain('disabled={confirmText !== "ERASE"}');
    // The password is cleared when the dialog closes.
    expect(formsSource).toContain('setPassword("")');
  });
});

describe("parseTestDataEraseCounts", () => {
  it("parses a valid counts object", () => {
    expect(parseTestDataEraseCounts(validCounts)).toEqual(validCounts);
  });

  it("has exactly the new-scope keys — no products, customers or files", () => {
    const parsed = parseTestDataEraseCounts(validCounts);
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed as object)).toEqual([
      "orders",
      "order_items",
      "payment_submissions",
      "order_shipments",
      "courier_booking_claims",
      "coupon_redemptions",
      "checkout_sessions",
      "checkout_items",
      "abandoned_recovery_log",
      "checkout_rate_events",
      "product_reviews",
      "review_moderation_log",
      "coupons",
      "banners",
    ]);
  });

  it("rejects missing, negative, non-integer or mistyped fields", () => {
    expect(parseTestDataEraseCounts(null)).toBeNull();
    expect(parseTestDataEraseCounts("erase")).toBeNull();
    expect(parseTestDataEraseCounts({ ...validCounts, orders: -1 })).toBeNull();
    expect(parseTestDataEraseCounts({ ...validCounts, orders: 1.5 })).toBeNull();
    expect(parseTestDataEraseCounts({ ...validCounts, orders: "3" })).toBeNull();
    const { banners, ...withoutBanners } = validCounts;
    void banners;
    expect(parseTestDataEraseCounts(withoutBanners)).toBeNull();
  });

  it("tolerates extra keys", () => {
    expect(
      parseTestDataEraseCounts({ ...validCounts, unexpected: true }),
    ).toEqual(validCounts);
  });
});

describe("migration 20261123000100 text", () => {
  it("is a single transaction", () => {
    expect(migration.trimStart().startsWith("begin;")).toBe(true);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("defines the counts RPC, the erase RPC and the owner gate — nothing else", () => {
    expect(migration).toContain(
      "create or replace function public.admin_test_data_erase_counts()",
    );
    expect(migration).toContain(
      "create or replace function public.admin_test_data_erase(p_confirmation text)",
    );
    expect(migration).toContain(
      "create or replace function private.require_owner()",
    );
    // The old test-product predicate is gone with the old scope.
    expect(migration).not.toContain("is_test_product");
    expect(migration).not.toContain("like 'test%'");
  });

  it("gates both RPCs on MFA plus a hard owner role check", () => {
    expect(migration.split("perform private.require_owner();").length - 1).toBe(2);
    expect(migration).toContain("role = 'owner'");
    expect(migration).toContain("auth.jwt()->>'aal' is distinct from 'aal2'");
  });

  it("requires the exact confirmation word ERASE", () => {
    expect(migration).toContain("p_confirmation is distinct from 'ERASE'");
  });

  it("deletes delivery data, order history, checkout data, reviews, coupons, banners", () => {
    for (const statement of [
      "delete from public.order_shipments",
      "delete from public.courier_booking_claims",
      "delete from public.coupon_redemptions",
      "delete from public.payment_submissions",
      "delete from public.order_items",
      "delete from public.orders",
      "delete from private.customer_order_numbers",
      "delete from public.checkout_items",
      "delete from public.abandoned_recovery_log",
      "delete from public.checkout_sessions",
      "delete from private.checkout_rate_events",
      "delete from public.review_moderation_log",
      "delete from public.product_reviews",
      "delete from public.coupons",
      "delete from public.banners",
    ]) {
      expect(migration).toContain(statement);
    }
  });

  it("deletes children before parents, in FK order", () => {
    const order = [
      "delete from public.review_moderation_log",
      "delete from public.product_reviews",
      "delete from public.order_shipments",
      "delete from public.courier_booking_claims",
      "delete from public.coupon_redemptions",
      "delete from public.payment_submissions",
      "delete from public.order_items",
      "delete from public.orders",
      "delete from private.customer_order_numbers",
      "delete from public.checkout_items",
      "delete from public.abandoned_recovery_log",
      "delete from public.checkout_sessions",
      "delete from public.coupons",
      "delete from public.banners",
    ];
    const positions = order.map((statement) => {
      const at = migration.indexOf(statement);
      expect(at).toBeGreaterThan(-1);
      return at;
    });
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1] as number);
    }
  });

  it("never deletes products, customers, visitors or the protected tables", () => {
    const neverDelete = [
      "delete from public.products",
      "delete from public.product_variants",
      "delete from public.product_media",
      "delete from public.inventory",
      "delete from public.inventory_movements",
      "delete from public.thrift_intake",
      "delete from public.product_catalogue_terms",
      "delete from public.profiles",
      "delete from public.customer_addresses",
      "delete from auth.users",
      "delete from public.categories",
      "delete from public.catalogue_terms",
      "delete from public.store_settings",
      "delete from public.layout_settings",
      "delete from private.checkout_settings",
      "delete from private.delivery_locations",
      "delete from public.marketing_secrets",
      "delete from private.telegram_config",
      "delete from private.smtp_config",
      "delete from public.user_roles",
      "delete from public.user_permissions",
      "delete from public.role_permissions",
      "delete from private.owner_provisioning_log",
      "delete from public.blocked_customers",
      "delete from public.admin_audit_logs",
    ];
    for (const statement of neverDelete) {
      expect(migration).not.toContain(statement);
    }
    expect(migration.toLowerCase()).not.toContain("truncate");
    expect(migration).not.toContain("setval");
    // Visitor data lives in Google Analytics, not in this database:
    // the migration must not reference visitors at all.
    expect(migration.toLowerCase()).not.toContain("visitor");
    // No storage or auth cleanup is returned any more.
    expect(migration).not.toContain("storage_paths");
    expect(migration).not.toContain("customer_user_ids");
  });

  it("writes one audit row for the erase and returns only the deleted counts", () => {
    expect(migration).toContain("insert into public.admin_audit_logs");
    expect(migration).toContain("'admin.test_data_erased'");
    expect(migration).toContain("return jsonb_build_object('deleted', v_counts);");
  });

  it("exposes both RPCs to authenticated callers only", () => {
    expect(migration).toContain(
      "grant execute on function public.admin_test_data_erase_counts() to authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.admin_test_data_erase(text) to authenticated",
    );
  });

  it("is the newest migration file", () => {
    const files = readdirSync(join(repoRoot, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files).toHaveLength(61);
    expect(files[files.length - 1]).toBe("20261123000100_test_data_erase.sql");
  });
});

describe("new-scope server action and UI", () => {
  it("eraseTestData does no service-role, storage or auth-user cleanup", () => {
    const eraseStart = settingsSource.indexOf("export async function eraseTestData");
    expect(eraseStart).toBeGreaterThan(-1);
    const nextExport = settingsSource.indexOf(
      "export async function",
      eraseStart + 1,
    );
    const body = settingsSource.slice(
      eraseStart,
      nextExport === -1 ? undefined : nextExport,
    );
    expect(body).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(body).not.toContain("adminConfiguration");
    expect(body).not.toContain("createClient");
    expect(body).not.toContain("deleteUser");
    expect(body).not.toContain("storage_paths");
    expect(body).not.toContain("customer_user_ids");
    expect(body).not.toContain(".storage");
    expect(body).not.toContain("test_products");
    expect(body).not.toContain("customers");
    expect(body).toContain("Erased");
  });

  it("the dialog lists the new delete set and the new keep set", () => {
    expect(formsSource).not.toContain("Test products");
    expect(formsSource).not.toContain("Customer accounts");
    expect(formsSource).not.toContain("test_product_names");
    expect(formsSource).toContain("Delivery records");
    expect(formsSource).toContain("All products, customer accounts, visitor data");
  });
});
