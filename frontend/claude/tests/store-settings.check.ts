import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { campaignHero } from "../src/config/campaign-banners";
import { footer } from "../src/config/footer";
import { header } from "../src/config/header";
import { policyPages } from "../src/content/policies";
import {
  applyAnnouncementOverride,
  applyFooterOverride,
  applyHeroOverride,
  applyPromoOverride,
  bannerImageRouteUrl,
  parseAnnouncementBar,
  resolveAboutContent,
  resolveBannerImageUrls,
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

  it("applies a social-only override without touching contact or tagline", () => {
    const merged = applyFooterOverride(footer, {
      social_instagram: "https://instagram.com/attiresarena",
    });
    expect(
      merged.social.find((link) => link.network === "instagram")?.href,
    ).toBe("https://instagram.com/attiresarena");
    expect(
      merged.social.find((link) => link.network === "facebook")?.href,
    ).toBe("#");
    expect(merged.contact).toEqual(footer.contact);
    expect(merged.tagline).toBe(footer.tagline);
  });

  it("ignores empty-string social links", () => {
    expect(applyFooterOverride(footer, { social_facebook: "  " })).toBe(
      footer,
    );
  });

  it("merges all four social links at once (facebook, instagram, youtube, tiktok)", () => {
    const merged = applyFooterOverride(footer, {
      social_facebook: "https://facebook.com/attiresarena",
      social_instagram: "https://instagram.com/attiresarena",
      social_youtube: "https://youtube.com/@attiresarena",
      social_tiktok: "https://tiktok.com/@attiresarena",
    });
    expect(
      merged.social.find((link) => link.network === "facebook")?.href,
    ).toBe("https://facebook.com/attiresarena");
    expect(
      merged.social.find((link) => link.network === "instagram")?.href,
    ).toBe("https://instagram.com/attiresarena");
    expect(
      merged.social.find((link) => link.network === "youtube")?.href,
    ).toBe("https://youtube.com/@attiresarena");
    expect(
      merged.social.find((link) => link.network === "tiktok")?.href,
    ).toBe("https://tiktok.com/@attiresarena");
    expect(merged.social).toHaveLength(4);
  });

  it("keeps an invalid youtube link from breaking the other three", () => {
    const merged = applyFooterOverride(footer, {
      social_facebook: "https://facebook.com/attiresarena",
      social_youtube: "not-a-url",
      social_tiktok: "https://tiktok.com/@attiresarena",
    });
    expect(
      merged.social.find((link) => link.network === "facebook")?.href,
    ).toBe("https://facebook.com/attiresarena");
    expect(
      merged.social.find((link) => link.network === "youtube")?.href,
    ).toBe("#");
    expect(
      merged.social.find((link) => link.network === "tiktok")?.href,
    ).toBe("https://tiktok.com/@attiresarena");
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

describe("promo banner merge", () => {
  const staticPromos = [
    {
      id: "promo-tonal",
      title: "Tonal Essentials",
      image: { src: "/images/banners/promo-tonal.svg", alt: "Stack of folded neutral shirts" },
      align: "left" as const,
      tone: "dark" as const,
    },
  ];

  function bannerRow(overrides: Partial<BannerRow>): BannerRow {
    return {
      id: "promo-1",
      title: "Winter Promo",
      subtitle: "Up to 30% off",
      image_storage_path: "banners/winter.jpg",
      link_url: "/shop",
      sort_position: 0,
      visible: true,
      placement: "promo",
      ...overrides,
    };
  }

  it("returns the static promotions unchanged without resolvable banners", () => {
    expect(applyPromoOverride(staticPromos, null, () => "/x.jpg")).toBe(staticPromos);
    expect(applyPromoOverride(staticPromos, [], () => "/x.jpg")).toBe(staticPromos);
    expect(applyPromoOverride(staticPromos, [bannerRow({})], () => null)).toBe(staticPromos);
    expect(
      applyPromoOverride(
        staticPromos,
        [bannerRow({ visible: false }), bannerRow({ placement: "hero", id: "h1" })],
        () => "/x.jpg",
      ),
    ).toBe(staticPromos);
  });

  it("replaces promotions with visible promo banners in stored order", () => {
    const merged = applyPromoOverride(
      staticPromos,
      [
        bannerRow({ id: "first", title: "First", sort_position: 0 }),
        bannerRow({ id: "second", title: "Second", sort_position: 1, link_url: null, subtitle: null }),
      ],
      (path) => `/api/banner-media/${path.split("/")[1]}`,
    );
    expect(merged.map((item) => item.id)).toEqual(["first", "second"]);
    expect(merged[0]?.image.src).toBe("/api/banner-media/winter.jpg");
    expect(merged[0]?.cta).toEqual({ label: "Shop Now", href: "/shop" });
    expect(merged[1]?.cta).toBeUndefined();
    expect(merged[1]?.subtitle).toBeUndefined();
  });
});

describe("about content override", () => {
  function aboutBlock(overrides: Partial<ContentBlockRow>): ContentBlockRow {
    return {
      slug: "about",
      title: "Our story, retold",
      body: "First paragraph.\n\nSecond paragraph.",
      image_storage_path: null,
      sort_position: 0,
      visible: true,
      updated_at: "2026-11-15T08:00:00Z",
      ...overrides,
    };
  }

  it("returns null without a visible about block", () => {
    expect(resolveAboutContent(null)).toBe(null);
    expect(resolveAboutContent([])).toBe(null);
    expect(resolveAboutContent([aboutBlock({ visible: false })])).toBe(null);
    expect(resolveAboutContent([aboutBlock({ slug: "privacy-policy" })])).toBe(null);
    expect(resolveAboutContent([aboutBlock({ body: "   \n\n  " })])).toBe(null);
  });

  it("returns the stored title and paragraphs", () => {
    const resolved = resolveAboutContent([aboutBlock({})]);
    expect(resolved).toEqual({
      title: "Our story, retold",
      paragraphs: ["First paragraph.", "Second paragraph."],
    });
  });

  it("keeps the title null when the block has no title", () => {
    const resolved = resolveAboutContent([aboutBlock({ title: null })]);
    expect(resolved?.title).toBe(null);
    expect(resolved?.paragraphs).toEqual(["First paragraph.", "Second paragraph."]);
  });
});

describe("banner image URLs", () => {
  const STAGING_URL = "https://jwccyndyaamodxjtjtfo.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_test_fixture_key";
  const IMAGE_ID = "66666666-6666-4666-8666-666666666666.jpg";
  const PATH = `banners/${IMAGE_ID}`;

  function bannerRow(overrides: Partial<BannerRow>): BannerRow {
    return {
      id: "banner-1",
      title: "Winter Sale",
      subtitle: null,
      image_storage_path: PATH,
      link_url: null,
      sort_position: 0,
      visible: true,
      placement: "hero",
      ...overrides,
    };
  }

  function stubFetch(
    respond: (url: string) => Response | Promise<Response>,
  ): { calls: string[]; fetchImpl: typeof fetch } {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return respond(String(url));
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SUPABASE_URL", STAGING_URL);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("maps well-formed banner paths to the banner-media route", () => {
    expect(bannerImageRouteUrl(PATH)).toBe(`/api/banner-media/${IMAGE_ID}`);
    expect(bannerImageRouteUrl("banners/66666666-6666-4666-8666-666666666666.png")).toBe(
      "/api/banner-media/66666666-6666-4666-8666-666666666666.png",
    );
  });

  it("rejects non-banner paths", () => {
    expect(bannerImageRouteUrl("55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666.jpg")).toBe(null);
    expect(bannerImageRouteUrl("brand/66666666-6666-4666-8666-666666666666.png")).toBe(null);
    expect(bannerImageRouteUrl("banners/not-a-uuid.jpg")).toBe(null);
    expect(bannerImageRouteUrl("banners/66666666-6666-4666-8666-666666666666.gif")).toBe(null);
    expect(bannerImageRouteUrl("banners/66666666-6666-4666-8666-666666666666.jpg/extra")).toBe(null);
    expect(bannerImageRouteUrl("")).toBe(null);
  });

  it("resolves a servable banner image to its route URL", async () => {
    const { calls, fetchImpl } = stubFetch(
      () =>
        new Response("fake-image-bytes", {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    );
    const urls = await resolveBannerImageUrls([bannerRow({})], fetchImpl);
    expect(urls.get(PATH)).toBe(`/api/banner-media/${IMAGE_ID}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(
      `${STAGING_URL}/storage/v1/object/authenticated/attires-product-drafts/banners/${IMAGE_ID}`,
    );
    expect(calls[0]).not.toContain(PUBLISHABLE_KEY);
  });

  it("skips banners whose image is denied, missing, or the wrong type", async () => {
    const denied = await resolveBannerImageUrls(
      [bannerRow({})],
      stubFetch(() => new Response("denied", { status: 403 })).fetchImpl,
    );
    expect(denied.size).toBe(0);
    const wrongType = await resolveBannerImageUrls(
      [bannerRow({})],
      stubFetch(
        () =>
          new Response("evil", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ).fetchImpl,
    );
    expect(wrongType.size).toBe(0);
  });

  it("never fetches for malformed paths or without configuration", async () => {
    const { calls, fetchImpl } = stubFetch(
      () =>
        new Response("fake-image-bytes", {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    );
    const malformed = await resolveBannerImageUrls(
      [bannerRow({ image_storage_path: "not-a-banner-path" })],
      fetchImpl,
    );
    expect(malformed.size).toBe(0);
    expect(calls).toHaveLength(0);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    const unconfigured = await resolveBannerImageUrls([bannerRow({})], fetchImpl);
    expect(unconfigured.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("skips a banner when the probe throws, and still resolves the others", async () => {
    const { fetchImpl } = stubFetch((url) => {
      if (url.includes("66666666")) throw new Error("offline");
      return new Response("fake-image-bytes", {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    const urls = await resolveBannerImageUrls(
      [
        bannerRow({}),
        bannerRow({
          id: "banner-2",
          image_storage_path: "banners/77777777-7777-4777-8777-777777777777.png",
        }),
      ],
      fetchImpl,
    );
    expect(urls.size).toBe(1);
    expect(urls.get("banners/77777777-7777-4777-8777-777777777777.png")).toBe(
      "/api/banner-media/77777777-7777-4777-8777-777777777777.png",
    );
  });
});
