import { describe, it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {}, get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));

import { canViewProductCosts } from "../src/lib/admin/authorization";
import {
  ALL_PERMISSIONS,
  AREA_ROLES,
  COST_VIEWING_ROLES,
  PERMISSION_GROUPS,
  ROLE_PERMISSION_DEFAULTS,
  STAFF_ROLES,
  areaRoles,
  isPermissionName,
  type PermissionName,
  type StaffRole,
} from "../src/lib/admin/constants";
import { PASSWORD_SCHEMA } from "../src/lib/admin/account";
import {
  CUSTOM_CODE_SCHEMA,
  GENERAL_DISPLAY_SCHEMA,
  MARKETING_SETTINGS_SCHEMA,
  OWNER_ONLY_SETTING_KEYS,
  PIXEL_EVENTS,
  SEO_EXTENDED_SCHEMA,
  SETTING_KEYS,
  isOwnerOnlySettingKey,
  isSettingKey,
  parseLowStockThreshold,
  parsePixelEvents,
  parseSeoRobots,
  parseSeoSitemap,
} from "../src/lib/admin/settings-shared";
import { effectivePermissions } from "../src/lib/admin/users";
import {
  parseMarketingSettings,
  resolveStorefrontMetadata,
} from "../src/lib/store-settings";

describe("v2 setting-key allowlist", () => {
  it("contains the original 17 keys plus the 16 v2 keys plus the M-B verification key plus the 3 delivery zone keys", () => {
    expect(SETTING_KEYS).toHaveLength(37);
    for (const key of [
      "meta_pixel_id",
      "meta_pixel_events",
      "ga_measurement_id",
      "custom_head_code",
      "custom_body_code",
      "seo_keywords",
      "seo_og_title",
      "seo_og_description",
      "seo_og_image_url",
      "seo_twitter_card",
      "seo_canonical_base_url",
      "seo_robots",
      "seo_sitemap",
      // SEO follow-up M-B (migration 20261119000400).
      "google_search_console_verification",
      "display_currency",
      "display_timezone",
      "low_stock_threshold",
      // Delivery zones (migration 20261122000100).
      "delivery_inside_district",
      "delivery_inside_charge_minor",
      "delivery_outside_charge_minor",
    ] as const) {
      expect(isSettingKey(key)).toBe(true);
    }
  });

  it("never treats an SMS secret as a setting key", () => {
    expect(isSettingKey("sms_api_secret")).toBe(false);
    expect(isSettingKey("sms_provider")).toBe(false);
    expect(isSettingKey("sms_sender_id")).toBe(false);
    expect(isSettingKey("sms_enabled")).toBe(false);
    expect(isSettingKey("service_role_key")).toBe(false);
    expect(isSettingKey("")).toBe(false);
    expect(isSettingKey(42)).toBe(false);
  });

  it("marks only the custom-code keys as owner-only", () => {
    expect([...OWNER_ONLY_SETTING_KEYS].sort()).toEqual([
      "custom_body_code",
      "custom_head_code",
    ]);
    expect(isOwnerOnlySettingKey("custom_head_code")).toBe(true);
    expect(isOwnerOnlySettingKey("custom_body_code")).toBe(true);
    expect(isOwnerOnlySettingKey("meta_pixel_id")).toBe(false);
    expect(isOwnerOnlySettingKey("seo_default_title")).toBe(false);
  });
});

describe("marketing settings validation", () => {
  const validEvents = {
    PageView: true,
    ViewContent: false,
    AddToCart: false,
    InitiateCheckout: false,
    Purchase: false,
  };

  it("accepts a numeric pixel ID and GA ID", () => {
    expect(
      MARKETING_SETTINGS_SCHEMA.safeParse({
        meta_pixel_id: "123456789012345",
        meta_pixel_events: validEvents,
        ga_measurement_id: "G-ABCDEF1234",
      }).success,
    ).toBe(true);
  });

  it("accepts empty IDs (unconfigured) and rejects malformed IDs", () => {
    expect(
      MARKETING_SETTINGS_SCHEMA.safeParse({
        meta_pixel_id: "",
        meta_pixel_events: validEvents,
        ga_measurement_id: "",
      }).success,
    ).toBe(true);
    expect(
      MARKETING_SETTINGS_SCHEMA.safeParse({
        meta_pixel_id: "abc123",
        meta_pixel_events: validEvents,
        ga_measurement_id: "",
      }).success,
    ).toBe(false);
    expect(
      MARKETING_SETTINGS_SCHEMA.safeParse({
        meta_pixel_id: "",
        meta_pixel_events: validEvents,
        ga_measurement_id: "UA-12345",
      }).success,
    ).toBe(false);
  });

  it("covers exactly the five pixel events", () => {
    expect([...PIXEL_EVENTS]).toEqual([
      "PageView",
      "ViewContent",
      "AddToCart",
      "InitiateCheckout",
      "Purchase",
    ]);
  });

  it("parses stored pixel events and rejects malformed values", () => {
    expect(parsePixelEvents(validEvents)).toEqual(validEvents);
    expect(parsePixelEvents({ PageView: true })).toBe(null);
    expect(parsePixelEvents("PageView")).toBe(null);
    expect(parsePixelEvents(null)).toBe(null);
  });

  it("caps custom code at 20,000 characters per slot", () => {
    expect(
      CUSTOM_CODE_SCHEMA.safeParse({
        custom_head_code: "x".repeat(20000),
        custom_body_code: "",
      }).success,
    ).toBe(true);
    expect(
      CUSTOM_CODE_SCHEMA.safeParse({
        custom_head_code: "x".repeat(20001),
        custom_body_code: "",
      }).success,
    ).toBe(false);
  });
});

describe("extended SEO validation", () => {
  const valid = {
    seo_keywords: "shirts, Dhaka",
    seo_og_title: "Attires Arena",
    seo_og_description: "Premium menswear.",
    seo_og_image_url: "https://example.com/og.jpg",
    seo_twitter_card: "summary_large_image" as const,
    seo_canonical_base_url: "https://attiresarena.com",
    seo_robots: { index: false, follow: false },
    seo_sitemap: {
      includeShop: true,
      includeCategories: true,
      includePolicies: true,
      includeProducts: false,
    },
    // M-B: empty token clears the stored value.
    google_search_console_verification: "",
  };

  it("accepts a complete valid extended SEO payload", () => {
    expect(SEO_EXTENDED_SCHEMA.safeParse(valid).success).toBe(true);
  });

  it("rejects non-http(s) URLs and unknown card types", () => {
    expect(
      SEO_EXTENDED_SCHEMA.safeParse({ ...valid, seo_og_image_url: "ftp://x/y.jpg" })
        .success,
    ).toBe(false);
    expect(
      SEO_EXTENDED_SCHEMA.safeParse({
        ...valid,
        seo_twitter_card: "player",
      }).success,
    ).toBe(false);
  });

  it("parses robots and sitemap configs and rejects malformed values", () => {
    expect(parseSeoRobots({ index: true, follow: true })).toEqual({
      index: true,
      follow: true,
    });
    expect(parseSeoRobots({ index: true })).toBe(null);
    expect(parseSeoRobots(null)).toBe(null);
    expect(
      parseSeoSitemap({
        includeShop: true,
        includeCategories: false,
        includePolicies: false,
        includeProducts: false,
      }),
    ).toEqual({
      includeShop: true,
      includeCategories: false,
      includePolicies: false,
      includeProducts: false,
    });
    expect(parseSeoSitemap({ includeShop: true })).toBe(null);
  });
});

describe("general display settings validation", () => {
  it("accepts currency, timezone and a 0-999 threshold", () => {
    expect(
      GENERAL_DISPLAY_SCHEMA.safeParse({
        display_currency: "BDT",
        display_timezone: "Asia/Dhaka",
        low_stock_threshold: 5,
      }).success,
    ).toBe(true);
    expect(
      GENERAL_DISPLAY_SCHEMA.safeParse({
        display_currency: "BDT",
        display_timezone: "Asia/Dhaka",
        low_stock_threshold: 1000,
      }).success,
    ).toBe(false);
  });

  it("parses stored thresholds from numbers and numeric strings", () => {
    expect(parseLowStockThreshold(5)).toBe(5);
    expect(parseLowStockThreshold("12")).toBe(12);
    expect(parseLowStockThreshold("abc")).toBe(null);
    expect(parseLowStockThreshold(1000)).toBe(null);
    expect(parseLowStockThreshold(null)).toBe(null);
  });
});

describe("v2 roles and permissions", () => {
  it("includes moderator, editor and admin roles", () => {
    expect(STAFF_ROLES).toContain("moderator");
    expect(STAFF_ROLES).toContain("editor");
    expect(STAFF_ROLES).toContain("admin");
    expect(STAFF_ROLES).toContain("owner");
  });

  it("keeps settings and users owner-only, with owner in every area", () => {
    expect(areaRoles("settings")).toEqual(["owner"]);
    expect(areaRoles("users")).toEqual(["owner"]);
    for (const area of Object.keys(AREA_ROLES)) {
      expect(areaRoles(area)).toContain("owner");
    }
  });

  it("grants costs.read only to owner, admin and product_manager by default", () => {
    expect([...COST_VIEWING_ROLES].sort()).toEqual([
      "admin",
      "owner",
      "product_manager",
    ]);
    for (const role of STAFF_ROLES) {
      const hasCosts = ROLE_PERMISSION_DEFAULTS[role].includes("costs.read");
      expect(hasCosts).toBe(
        (["owner", "admin", "product_manager"] as StaffRole[]).includes(role),
      );
    }
    expect(ROLE_PERMISSION_DEFAULTS.moderator).not.toContain("costs.read");
    expect(ROLE_PERMISSION_DEFAULTS.editor).not.toContain("costs.read");
    expect(ROLE_PERMISSION_DEFAULTS.moderator).not.toContain("settings.manage");
    expect(ROLE_PERMISSION_DEFAULTS.admin).not.toContain("settings.manage");
    expect(ROLE_PERMISSION_DEFAULTS.admin).not.toContain("users.manage");
    expect(ROLE_PERMISSION_DEFAULTS.owner).toHaveLength(ALL_PERMISSIONS.length);
  });

  it("groups every permission exactly once for the access UI", () => {
    const grouped = PERMISSION_GROUPS.flatMap((group) => group.permissions);
    expect([...grouped].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(new Set(grouped).size).toBe(ALL_PERMISSIONS.length);
    expect(isPermissionName("costs.read")).toBe(true);
    expect(isPermissionName("billing.read")).toBe(false);
  });

  it("computes effective permissions as role grants plus user grants", () => {
    const roleGrants: ReadonlyMap<string, readonly PermissionName[]> = new Map([
      ["moderator", ["catalogue.read"]],
    ]);
    const effective = effectivePermissions(
      ["moderator"],
      roleGrants,
      ["orders.read"],
    );
    expect(effective).toContain("catalogue.read");
    expect(effective).toContain("orders.read");
    expect(effective).not.toContain("costs.read");
  });
});

describe("cost viewing helper", () => {
  it("allows owner, admin and product_manager only", () => {
    expect(canViewProductCosts({ roles: ["owner"] })).toBe(true);
    expect(canViewProductCosts({ roles: ["admin"] })).toBe(true);
    expect(canViewProductCosts({ roles: ["product_manager"] })).toBe(true);
    expect(canViewProductCosts({ roles: ["moderator"] })).toBe(false);
    expect(canViewProductCosts({ roles: ["editor"] })).toBe(false);
    expect(canViewProductCosts({ roles: ["analyst"] })).toBe(false);
    expect(canViewProductCosts({ roles: [] })).toBe(false);
    expect(canViewProductCosts({ roles: ["moderator", "admin"] })).toBe(true);
  });
});

describe("password reauthentication validation", () => {
  it("requires the current password and a different new password", () => {
    expect(
      PASSWORD_SCHEMA.safeParse({
        currentPassword: "old password 99",
        password: "correct horse 42",
        confirmPassword: "correct horse 42",
      }).success,
    ).toBe(true);
    expect(
      PASSWORD_SCHEMA.safeParse({
        currentPassword: "",
        password: "correct horse 42",
        confirmPassword: "correct horse 42",
      }).success,
    ).toBe(false);
    expect(
      PASSWORD_SCHEMA.safeParse({
        currentPassword: "correct horse 42",
        password: "correct horse 42",
        confirmPassword: "correct horse 42",
      }).success,
    ).toBe(false);
  });
});

describe("storefront marketing parsing", () => {
  it("returns all null when nothing is configured", () => {
    expect(parseMarketingSettings(null)).toEqual({
      pixelId: null,
      pixelEvents: null,
      gaMeasurementId: null,
      headCode: null,
      bodyCode: null,
    });
    expect(parseMarketingSettings({})).toEqual({
      pixelId: null,
      pixelEvents: null,
      gaMeasurementId: null,
      headCode: null,
      bodyCode: null,
    });
  });

  it("validates each field independently", () => {
    const parsed = parseMarketingSettings({
      meta_pixel_id: "not-a-number",
      meta_pixel_events: {
        PageView: true,
        ViewContent: true,
        AddToCart: false,
        InitiateCheckout: false,
        Purchase: false,
      },
      ga_measurement_id: "G-ABCDEF1234",
      custom_head_code: "<script>ok</script>",
      custom_body_code: "x".repeat(20001),
    });
    expect(parsed.pixelId).toBe(null);
    expect(parsed.pixelEvents?.PageView).toBe(true);
    expect(parsed.gaMeasurementId).toBe("G-ABCDEF1234");
    expect(parsed.headCode).toBe("<script>ok</script>");
    expect(parsed.bodyCode).toBe(null);
  });
});

describe("storefront metadata resolution", () => {
  const base = {
    siteName: "Attires Arena",
    siteUrl: "https://attiresarena.com",
    description: "Premium menswear.",
    logoBadge: "/brand/logo-badge.jpg",
  };

  it("keeps static fallbacks when unconfigured", () => {
    const meta = resolveStorefrontMetadata(base, null);
    expect(meta.metadataBase?.toString()).toBe("https://attiresarena.com/");
    const robots = meta.robots as unknown as { index?: boolean; follow?: boolean };
    expect(robots.index).toBe(false);
    expect(robots.follow).toBe(false);
    const title = meta.title as unknown as { default?: unknown; template?: unknown };
    // DELIBERATE (Fahim's call, 2026-11-20): the default home title keeps
    // the live wording; the "Best thrift collection in Bangladesh" phrase
    // stays in the brand description / llms.txt / FAQ / JSON-LD, not the title.
    expect(title.default).toBe("Attires Arena — Thrift Shirts in Bangladesh");
    expect(title.template).toBe("%s | Attires Arena");
    expect(meta.description).toBe("Premium menswear.");
    expect(meta.twitter).toBeUndefined();
    const og = meta.openGraph as unknown as { images?: { url?: unknown }[] };
    expect(og.images?.[0]?.url).toBe("/brand/logo-badge.jpg");
  });

  it("applies stored SEO overrides and robots opt-in", () => {
    // DELIBERATE behavior change (SEO build): the robots opt-in only takes
    // effect on production. The test env is non-production, so the opt-in
    // is passed an explicit production env record; see the Preview test
    // below proving the same stored toggle is ignored off-production.
    const meta = resolveStorefrontMetadata(
      base,
      {
        seo_default_title: "Custom Title",
        seo_default_description: "Custom description.",
        seo_keywords: "shirts, Dhaka, , thrift",
        seo_og_title: "OG Title",
        seo_og_image_url: "https://example.com/og.jpg",
        seo_twitter_card: "summary",
        seo_canonical_base_url: "https://shop.example.com",
        seo_robots: { index: true, follow: true },
      },
      { VERCEL_ENV: "production" },
    );
    expect(meta.metadataBase?.toString()).toBe("https://shop.example.com/");
    const robots = meta.robots as unknown as { index?: boolean; follow?: boolean };
    expect(robots.index).toBe(true);
    expect(robots.follow).toBe(true);
    const title = meta.title as unknown as { default?: unknown };
    expect(title.default).toBe("Custom Title");
    expect(meta.description).toBe("Custom description.");
    expect(meta.keywords).toEqual(["shirts", "Dhaka", "thrift"]);
    const og = meta.openGraph as unknown as {
      title?: unknown;
      images?: { url?: unknown }[];
    };
    expect(og.title).toBe("OG Title");
    expect(og.images?.[0]?.url).toBe("https://example.com/og.jpg");
    const twitter = meta.twitter as unknown as { card?: unknown };
    expect(twitter.card).toBe("summary");
  });

  it("ignores invalid canonical and OG URLs", () => {
    const meta = resolveStorefrontMetadata(base, {
      seo_canonical_base_url: "not a url",
      seo_og_image_url: "/relative/path.jpg",
    });
    expect(meta.metadataBase?.toString()).toBe("https://attiresarena.com/");
    const og = meta.openGraph as unknown as { images?: { url?: unknown }[] };
    expect(og.images?.[0]?.url).toBe("/brand/logo-badge.jpg");
  });

  it("ignores the robots opt-in off-production (Preview is never indexable)", () => {
    const settings = { seo_robots: { index: true, follow: true } };
    for (const env of [
      { VERCEL_ENV: "preview", NODE_ENV: "production" },
      { NODE_ENV: "development" },
      {},
    ]) {
      const meta = resolveStorefrontMetadata(base, settings, env);
      const robots = meta.robots as unknown as { index?: boolean; follow?: boolean };
      expect(robots.index).toBe(false);
      expect(robots.follow).toBe(false);
    }
  });

  it("fails closed on production when the toggle is unset or malformed", () => {
    for (const settings of [null, {}, { seo_robots: { index: true } }, { seo_robots: "yes" }]) {
      const meta = resolveStorefrontMetadata(base, settings, { VERCEL_ENV: "production" });
      const robots = meta.robots as unknown as { index?: boolean; follow?: boolean };
      expect(robots.index).toBe(false);
      expect(robots.follow).toBe(false);
    }
  });

  it("emits the root canonical, OG url/locale, badge dimensions/alt, and Twitter images", () => {
    const meta = resolveStorefrontMetadata(base, { seo_twitter_card: "summary_large_image" }, { VERCEL_ENV: "production" });
    const alternates = meta.alternates as unknown as { canonical?: unknown };
    expect(alternates.canonical).toBe("/");
    const og = meta.openGraph as unknown as {
      url?: unknown;
      locale?: unknown;
      images?: Array<{ url?: unknown; width?: unknown; height?: unknown; alt?: unknown }>;
    };
    expect(og.url).toBe("/");
    expect(og.locale).toBe("en_US");
    expect(og.images).toEqual([{ url: "/brand/logo-badge.jpg", width: 540, height: 540, alt: "Attires Arena" }]);
    const twitter = meta.twitter as unknown as { images?: unknown };
    expect(twitter.images).toEqual(["/brand/logo-badge.jpg"]);
  });

  it("omits dimensions for a stored OG image URL (unknown, never guessed)", () => {
    const meta = resolveStorefrontMetadata(base, { seo_og_image_url: "https://example.com/og.jpg" });
    const og = meta.openGraph as unknown as { images?: Array<Record<string, unknown>> };
    expect(og.images).toEqual([{ url: "https://example.com/og.jpg" }]);
  });

  it("renders Search Console verification only when a valid token is stored", () => {
    const withToken = resolveStorefrontMetadata(base, { google_search_console_verification: "abc123TOKEN" });
    expect(withToken.verification).toEqual({ google: "abc123TOKEN" });
    expect(resolveStorefrontMetadata(base, null).verification).toBeUndefined();
    expect(
      resolveStorefrontMetadata(base, { google_search_console_verification: "  " }).verification,
    ).toBeUndefined();
    expect(
      resolveStorefrontMetadata(base, { google_search_console_verification: "has space" }).verification,
    ).toBeUndefined();
  });
});
