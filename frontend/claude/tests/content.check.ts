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

import {
  ANNOUNCEMENT_SCHEMA,
  SETTING_KEYS,
  SEO_DEFAULTS_SCHEMA,
  STORE_SETTINGS_VALIDATED,
  isSettingKey,
} from "../src/lib/admin/settings";
import {
  BANNER_SCHEMA,
  CONTENT_BLOCK_SCHEMA,
  MANAGED_BLOCKS,
  isValidSlug,
  orderBannerIds,
} from "../src/lib/admin/content";
import { PASSWORD_SCHEMA } from "../src/lib/admin/account";
import { countOtherOwners } from "../src/lib/admin/users";

describe("settings key allowlist", () => {
  it("contains the fifteen specified keys", () => {
    for (const key of [
      "announcement_bar",
      "store_name",
      "contact_phone",
      "contact_email",
      "contact_address",
      "whatsapp_number",
      "social_facebook",
      "social_instagram",
      "social_youtube",
      "social_tiktok",
      "footer_about",
      "seo_default_title",
      "seo_default_description",
      "logo_storage_path",
      "favicon_storage_path",
    ]) {
      expect(SETTING_KEYS).toContain(key);
    }
  });

  it("rejects keys outside the allowlist", () => {
    expect(isSettingKey("service_role_key")).toBe(false);
    expect(isSettingKey("admin")).toBe(false);
    expect(isSettingKey("")).toBe(false);
    expect(isSettingKey(undefined)).toBe(false);
  });

  it("validates store settings fields", () => {
    const base = {
      store_name: "Attires Arena",
      contact_phone: "+880 1XXX-XXXXXX",
      contact_email: "",
      contact_address: "",
      whatsapp_number: "",
      social_facebook: "",
      social_instagram: "",
      social_youtube: "",
      social_tiktok: "",
      footer_about: "",
    };
    expect(STORE_SETTINGS_VALIDATED.safeParse(base).success).toBe(true);
    expect(
      STORE_SETTINGS_VALIDATED.safeParse({ ...base, contact_email: "not-an-email" })
        .success,
    ).toBe(false);
    expect(
      STORE_SETTINGS_VALIDATED.safeParse({
        ...base,
        social_facebook: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      STORE_SETTINGS_VALIDATED.safeParse({
        ...base,
        social_facebook: "https://facebook.com/attiresarena",
      }).success,
    ).toBe(true);
    expect(
      STORE_SETTINGS_VALIDATED.safeParse({ ...base, whatsapp_number: "abc" }).success,
    ).toBe(false);
  });

  it("validates the announcement bar value", () => {
    expect(ANNOUNCEMENT_SCHEMA.safeParse({ text: "Sale", visible: true }).success).toBe(true);
    expect(ANNOUNCEMENT_SCHEMA.safeParse({ text: "  ", visible: true }).success).toBe(false);
    expect(
      ANNOUNCEMENT_SCHEMA.safeParse({ text: "x".repeat(201), visible: true }).success,
    ).toBe(false);
  });

  it("validates SEO defaults and page overrides", () => {
    const overrides = {
      home: { title: "", description: "" },
      shop: { title: "", description: "" },
      about: { title: "", description: "" },
      contact: { title: "", description: "" },
    };
    expect(
      SEO_DEFAULTS_SCHEMA.safeParse({
        seo_default_title: "Attires Arena",
        seo_default_description: "Shop",
        seo_page_overrides: overrides,
      }).success,
    ).toBe(true);
    expect(
      SEO_DEFAULTS_SCHEMA.safeParse({
        seo_default_title: "x".repeat(201),
        seo_default_description: "",
        seo_page_overrides: overrides,
      }).success,
    ).toBe(false);
  });
});

describe("content block slugs", () => {
  it("accepts lowercase hyphenated slugs", () => {
    expect(isValidSlug("privacy-policy")).toBe(true);
    expect(isValidSlug("about")).toBe(true);
    expect(isValidSlug("shipping-policy")).toBe(true);
  });

  it("rejects invalid slugs", () => {
    expect(isValidSlug("Privacy Policy")).toBe(false);
    expect(isValidSlug("privacy_policy")).toBe(false);
    expect(isValidSlug("-privacy")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("privacy/policy")).toBe(false);
  });

  it("rejects blocks with invalid slugs or overlong bodies", () => {
    const base = {
      slug: "privacy-policy",
      title: "Privacy",
      body: "Hello",
      image_storage_path: "",
      sort_position: 0,
      visible: true,
    };
    expect(CONTENT_BLOCK_SCHEMA.safeParse(base).success).toBe(true);
    expect(
      CONTENT_BLOCK_SCHEMA.safeParse({ ...base, slug: "Privacy Policy" }).success,
    ).toBe(false);
    expect(
      CONTENT_BLOCK_SCHEMA.safeParse({ ...base, body: "x".repeat(20001) }).success,
    ).toBe(false);
  });

  it("marks only the wired pages as wired", () => {
    const wired = new Map(MANAGED_BLOCKS.map((block) => [block.slug, block.wired]));
    expect(wired.get("privacy-policy")).toBe(true);
    expect(wired.get("terms")).toBe(true);
    expect(wired.get("return-policy")).toBe(true);
    expect(wired.get("shipping-policy")).toBe(true);
    expect(wired.get("about")).toBe(false);
  });
});

describe("banner validation and ordering", () => {
  const base = {
    id: null,
    title: "Winter Sale",
    subtitle: "",
    image_storage_path: "banners/abc.jpg",
    link_url: "/shop",
    sort_position: 0,
    visible: true,
    placement: "hero" as const,
  };

  it("accepts site paths and http(s) links", () => {
    expect(BANNER_SCHEMA.safeParse(base).success).toBe(true);
    expect(
      BANNER_SCHEMA.safeParse({ ...base, link_url: "https://example.com/sale" }).success,
    ).toBe(true);
    expect(BANNER_SCHEMA.safeParse({ ...base, link_url: "" }).success).toBe(true);
  });

  it("rejects javascript links and non-banner image paths", () => {
    expect(
      BANNER_SCHEMA.safeParse({ ...base, link_url: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      BANNER_SCHEMA.safeParse({ ...base, image_storage_path: "brand/logo.png" }).success,
    ).toBe(false);
    expect(BANNER_SCHEMA.safeParse({ ...base, image_storage_path: "" }).success).toBe(false);
  });

  it("orders by sort position then creation time", () => {
    const banners = [
      { id: "b2", sort_position: 1, created_at: "2026-11-15T00:00:00Z" },
      { id: "b3", sort_position: 0, created_at: "2026-11-15T01:00:00Z" },
      { id: "b1", sort_position: 0, created_at: "2026-11-14T00:00:00Z" },
    ];
    expect(orderBannerIds(banners)).toEqual(["b1", "b3", "b2"]);
  });
});

describe("password strength rules", () => {
  it("accepts a 12+ character letter-and-number password", () => {
    expect(
      PASSWORD_SCHEMA.safeParse({ password: "correct horse 42", confirmPassword: "correct horse 42" })
        .success,
    ).toBe(true);
  });

  it("rejects short, letter-only and mismatched passwords", () => {
    expect(
      PASSWORD_SCHEMA.safeParse({ password: "short1", confirmPassword: "short1" }).success,
    ).toBe(false);
    expect(
      PASSWORD_SCHEMA.safeParse({
        password: "allletterspassword",
        confirmPassword: "allletterspassword",
      }).success,
    ).toBe(false);
    expect(
      PASSWORD_SCHEMA.safeParse({ password: "correct horse 42", confirmPassword: "different 42" })
        .success,
    ).toBe(false);
  });
});

describe("last-owner counting", () => {
  it("counts owners excluding the target user", () => {
    const members = [
      { userId: "u1", displayName: "A", roles: ["owner" as const] },
      { userId: "u2", displayName: "B", roles: ["owner" as const, "analyst" as const] },
      { userId: "u3", displayName: "C", roles: ["analyst" as const] },
    ];
    expect(countOtherOwners(members, "u1")).toBe(1);
    expect(countOtherOwners(members, "u3")).toBe(2);
    expect(countOtherOwners([members[0]!], "u1")).toBe(0);
  });
});
