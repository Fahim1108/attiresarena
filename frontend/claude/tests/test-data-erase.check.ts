import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isTestProductName,
  parseTestDataEraseCounts,
} from "../src/lib/admin/settings-shared";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationPath = join(
  repoRoot,
  "supabase/migrations/20261123000100_test_data_erase.sql",
);
const migration = readFileSync(migrationPath, "utf8");

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
  test_products: 2,
  test_product_names: ["TEST All-Size Shirt 15", "test shirt"],
  test_product_variants: 3,
  test_product_media: 4,
  test_inventory_movements: 3,
  test_thrift_intake: 1,
  test_catalogue_terms: 2,
  product_reviews: 1,
  review_moderation_log: 0,
  coupons: 1,
  banners: 2,
  customers: 5,
  storage_files: 6,
};

describe("isTestProductName", () => {
  it("matches names and slugs starting with test, case-insensitive", () => {
    expect(isTestProductName("TEST All-Size Shirt 15", "test-all-size-shirt-15")).toBe(true);
    expect(isTestProductName("test shirt", "test-shirt")).toBe(true);
    expect(isTestProductName("Test Shirt", "test-shirt")).toBe(true);
    expect(isTestProductName("Testing 123", "testing-123")).toBe(true);
    expect(isTestProductName("  Test Shirt", "test-shirt")).toBe(true);
    expect(isTestProductName("Solid shirt", "test-shirt")).toBe(true);
  });

  it("rejects real products", () => {
    expect(isTestProductName("Solid shirt", "solid-shirt")).toBe(false);
    expect(isTestProductName("Attire Test", "attire-test")).toBe(false);
    expect(isTestProductName("Latest Shirt", "latest-shirt")).toBe(false);
    expect(isTestProductName("", "")).toBe(false);
    expect(isTestProductName("White Navy Pinstripe Shirt", "white-navy-pinstripe-shirt")).toBe(false);
  });
});

describe("parseTestDataEraseCounts", () => {
  it("parses a valid counts object", () => {
    expect(parseTestDataEraseCounts(validCounts)).toEqual(validCounts);
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
    expect(
      parseTestDataEraseCounts({ ...validCounts, test_product_names: "TEST" }),
    ).toBeNull();
    expect(
      parseTestDataEraseCounts({ ...validCounts, test_product_names: ["TEST", 7] }),
    ).toBeNull();
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

  it("defines the counts RPC, the erase RPC and the shared helpers", () => {
    expect(migration).toContain(
      "create or replace function public.admin_test_data_erase_counts()",
    );
    expect(migration).toContain(
      "create or replace function public.admin_test_data_erase(p_confirmation text)",
    );
    expect(migration).toContain(
      "create or replace function private.is_test_product(p_name text, p_slug text)",
    );
    expect(migration).toContain(
      "create or replace function private.require_owner()",
    );
  });

  it("gates both RPCs on MFA plus a hard owner role check", () => {
    expect(migration.split("perform private.require_owner();").length - 1).toBe(2);
    expect(migration).toContain("role = 'owner'");
    expect(migration).toContain("auth.jwt()->>'aal' is distinct from 'aal2'");
  });

  it("requires the exact confirmation word ERASE", () => {
    expect(migration).toContain("p_confirmation is distinct from 'ERASE'");
  });

  it("shares one test-product predicate between counts and erase", () => {
    expect(migration).toContain("lower(btrim(coalesce(p_name, ''))) like 'test%'");
    expect(migration).toContain("lower(btrim(coalesce(p_slug, ''))) like 'test%'");
    expect(
      migration.split("private.is_test_product(name, slug)").length - 1,
    ).toBe(4);
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
      "delete from public.product_catalogue_terms",
      "delete from public.product_media",
      "delete from public.inventory_movements",
      "delete from public.inventory\n",
      "delete from public.product_variants",
      "delete from public.thrift_intake",
      "delete from public.products where id = any",
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

  it("never deletes the protected tables, the sequence or auth users", () => {
    const neverDelete = [
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
      "delete from auth.users",
    ];
    for (const statement of neverDelete) {
      expect(migration).not.toContain(statement);
    }
    expect(migration.toLowerCase()).not.toContain("truncate");
    expect(migration).not.toContain("setval");
  });

  it("writes one audit row for the erase and returns the cleanup lists", () => {
    expect(migration).toContain("insert into public.admin_audit_logs");
    expect(migration).toContain("'admin.test_data_erased'");
    expect(migration).toContain("'storage_paths'");
    expect(migration).toContain("'customer_user_ids'");
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
