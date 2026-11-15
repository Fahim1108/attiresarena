import { describe, it, expect } from "vitest";

import { campaignHero } from "../src/config/campaign-banners";
import { footer } from "../src/config/footer";
import { header } from "../src/config/header";
import { policyPages } from "../src/content/policies";
import {
  applyAnnouncementOverride,
  applyFooterOverride,
  applyHeroOverride,
  parseAnnouncementBar,
  resolvePolicyPage,
  settingText,
  type BannerRow,
  type ContentBlockRow,
} from "../src/lib/store-settings";

function block(overrides: Partial<ContentBlockRow>): ContentBlockRow {
  return {
    slug: "privacy-policy",
    title: "Privacy Policy (stored)",
    body: "First paragraph.\n\nSecond paragraph.",
    image_storage_path: null,
    sort_position: 0,
    visible: true,
    updated_at: "2026-11-15T08:00:00Z",
    ...overrides,
  };
}

describe("policy page fallback and override", () => {
  const page = policyPages["privacy-policy"]!;

  it("returns the static page unchanged when the reader returns nothing", () => {
    expect(resolvePolicyPage(page, null)).toBe(page);
    expect(resolvePolicyPage(page, undefined)).toBe(page);
    expect(resolvePolicyPage(page, [])).toBe(page);
  });

  it("ignores hidden, non-matching and empty blocks", () => {
    expect(resolvePolicyPage(page, [block({ visible: false })])).toBe(page);
    expect(resolvePolicyPage(page, [block({ slug: "terms" })])).toBe(page);
    expect(resolvePolicyPage(page, [block({ body: "   \n\n  " })])).toBe(page);
  });

  it("replaces sections with stored paragraphs and the stored title", () => {
    const resolved = resolvePolicyPage(page, [block({})]);
    expect(resolved).not.toBe(page);
    expect(resolved.title).toBe("Privacy Policy (stored)");
    expect(resolved.sections).toEqual([
      {
        heading: "Privacy Policy (stored)",
        body: ["First paragraph.", "Second paragraph."],
      },
    ]);
    expect(resolved.updated).toBe("2026-11-15");
    expect(resolved.intro).toBe(page.intro);
  });

  it("keeps the static title when the block has no title", () => {
    const resolved = resolvePolicyPage(page, [block({ title: null })]);
    expect(resolved.title).toBe(page.title);
    expect(resolved.sections[0]?.heading).toBe(page.title);
  });
});

describe("announcement bar merge", () => {
  it("returns the static header unchanged without a valid stored value", () => {
    expect(applyAnnouncementOverride(header, null)).toBe(header);
    expect(applyAnnouncementOverride(header, {})).toBe(header);
    expect(applyAnnouncementOverride(header, { announcement_bar: "Sale!" })).toBe(header);
    expect(
      applyAnnouncementOverride(header, {
        announcement_bar: { text: "  ", visible: true },
      }),
    ).toBe(header);
  });

  it("applies stored text and visibility, keeping the rest static", () => {
    const merged = applyAnnouncementOverride(header, {
      announcement_bar: { text: "Free delivery over ৳2,000", visible: false },
    });
    expect(merged.announcement.enabled).toBe(false);
    expect(merged.announcement.left).toBe("Free delivery over ৳2,000");
    expect(merged.announcement.items).toBe(header.announcement.items);
    expect(merged.navigation).toBe(header.navigation);
  });

  it("parses only well-formed announcement values", () => {
    expect(parseAnnouncementBar({ text: "Hi", visible: true })).toEqual({
      text: "Hi",
      visible: true,
    });
    expect(parseAnnouncementBar({ text: "Hi" })).toBe(null);
    expect(parseAnnouncementBar(null)).toBe(null);
  });
});

describe("footer merge", () => {
  it("returns the static footer unchanged without stored values", () => {
    expect(applyFooterOverride(footer, null)).toBe(footer);
    expect(applyFooterOverride(footer, {})).toBe(footer);
    expect(applyFooterOverride(footer, { contact_phone: 123 })).toBe(footer);
  });

  it("overrides contact, socials and tagline field by field", () => {
    const merged = applyFooterOverride(footer, {
      contact_phone: "+880 1000000000",
      social_facebook: "https://facebook.com/attiresarena",
      footer_about: "New about text",
    });
    expect(merged.contact.phone).toBe("+880 1000000000");
    expect(merged.contact.email).toBe(footer.contact.email);
    expect(merged.tagline).toBe("New about text");
    expect(
      merged.social.find((link) => link.network === "facebook")?.href,
    ).toBe("https://facebook.com/attiresarena");
    expect(
      merged.social.find((link) => link.network === "instagram")?.href,
    ).toBe("#");
  });

  it("never applies a non-http(s) social link", () => {
    const merged = applyFooterOverride(footer, {
      social_facebook: "javascript:alert(1)",
    });
    expect(merged).toBe(footer);
  });
});

describe("hero slide merge", () => {
  function bannerRow(overrides: Partial<BannerRow>): BannerRow {
    return {
      id: "banner-1",
      title: "Winter Sale",
      subtitle: "Up to 30% off",
      image_storage_path: "banners/winter.jpg",
      link_url: "/shop",
      sort_position: 0,
      visible: true,
      placement: "hero",
      ...overrides,
    };
  }

  it("returns the static hero unchanged without resolvable banners", () => {
    expect(applyHeroOverride(campaignHero, null, () => "/x.jpg")).toBe(campaignHero);
    expect(applyHeroOverride(campaignHero, [], () => "/x.jpg")).toBe(campaignHero);
    expect(applyHeroOverride(campaignHero, [bannerRow({})], () => null)).toBe(campaignHero);
    expect(
      applyHeroOverride(
        campaignHero,
        [bannerRow({ visible: false }), bannerRow({ placement: "promo", id: "p1" })],
        () => "/x.jpg",
      ),
    ).toBe(campaignHero);
  });

  it("replaces slides with visible hero banners in stored order", () => {
    const merged = applyHeroOverride(
      campaignHero,
      [
        bannerRow({ id: "first", title: "First", sort_position: 0 }),
        bannerRow({ id: "second", title: "Second", sort_position: 1 }),
      ],
      (path) => `https://cdn.example/${path}`,
    );
    expect(merged.slides.map((slide) => slide.id)).toEqual(["first", "second"]);
    expect(merged.slides[0]?.image.src).toBe("https://cdn.example/banners/winter.jpg");
    expect(merged.slides[0]?.cta).toEqual({ label: "Shop Now", href: "/shop" });
    expect(merged.imageOnly).toBe(campaignHero.imageOnly);
    expect(merged.autoplayMs).toBe(campaignHero.autoplayMs);
  });
});

describe("settingText", () => {
  it("reads trimmed strings and rejects anything else", () => {
    expect(settingText({ store_name: "  Attires Arena " }, "store_name")).toBe("Attires Arena");
    expect(settingText({ store_name: "   " }, "store_name")).toBe(null);
    expect(settingText({ store_name: 42 }, "store_name")).toBe(null);
    expect(settingText(null, "store_name")).toBe(null);
  });
});
