import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { campaignHero } from "../src/config/campaign-banners";
import { logo } from "../src/config/brand";
import { footer } from "../src/config/footer";
import { header } from "../src/config/header";
import { theme } from "../src/config/theme";
import { policyPages } from "../src/content/policies";
import { FONT_STACKS } from "../src/lib/admin/reference-adapt";
import {
  applyAnnouncementOverride,
  applyBrandOverride,
  applyCustomizeOverride,
  applyFooterLinksOverride,
  applyFooterOverride,
  applyHeroOverride,
  applyNavigationOverride,
  applyPromoOverride,
  applySiteNameOverride,
  bannerImageRouteUrl,
  parseAnnouncementBar,
  resolveAboutContent,
  resolveBannerImageUrls,
  resolvePolicyPage,
  resolveStorefrontMetadata,
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

describe("store name merge", () => {
  it("returns the static name unchanged without a valid stored value", () => {
    expect(applySiteNameOverride("Attires Arena", null)).toBe("Attires Arena");
    expect(applySiteNameOverride("Attires Arena", {})).toBe("Attires Arena");
    expect(applySiteNameOverride("Attires Arena", { store_name: "   " })).toBe("Attires Arena");
    expect(applySiteNameOverride("Attires Arena", { store_name: 42 })).toBe("Attires Arena");
  });

  it("uses the saved name, trimmed", () => {
    expect(
      applySiteNameOverride("Attires Arena", { store_name: "  Attires Arena BD " }),
    ).toBe("Attires Arena BD");
  });
});

describe("brand merge", () => {
  const brandFile = "11111111-1111-4111-8111-111111111111.jpg";

  it("returns the static logo unchanged without a valid brand path", () => {
    expect(applyBrandOverride(logo, null, "Attires Arena")).toBe(logo);
    expect(applyBrandOverride(logo, {}, "Attires Arena")).toBe(logo);
    expect(applyBrandOverride(logo, { logo_storage_path: "   " }, "Attires Arena")).toBe(logo);
    // Product and banner paths are not brand images.
    expect(
      applyBrandOverride(
        logo,
        { logo_storage_path: `22222222-2222-4222-8222-222222222222/${brandFile}` },
        "Attires Arena",
      ),
    ).toBe(logo);
    expect(
      applyBrandOverride(logo, { logo_storage_path: "banners/winter.jpg" }, "Attires Arena"),
    ).toBe(logo);
    expect(
      applyBrandOverride(logo, { logo_storage_path: "../secret.jpg" }, "Attires Arena"),
    ).toBe(logo);
  });

  it("replaces only the header logo and follows the site name for alt text", () => {
    const merged = applyBrandOverride(
      logo,
      { logo_storage_path: `brand/${brandFile}` },
      "Attires Arena BD",
    );
    expect(merged.primary).toBe(`/api/brand-media/${brandFile}`);
    expect(merged.alt).toBe("Attires Arena BD");
    // One upload cannot serve both light and dark backgrounds, and the
    // square badge feeds the OG image: both stay static.
    expect(merged.inverse).toBe(logo.inverse);
    expect(merged.badge).toBe(logo.badge);
    expect(merged.heightDesktop).toBe(logo.heightDesktop);
  });
});

describe("customize merge", () => {
  it("returns the static theme unchanged without valid stored values", () => {
    expect(applyCustomizeOverride(theme, null)).toBe(theme);
    expect(applyCustomizeOverride(theme, {})).toBe(theme);
    expect(
      applyCustomizeOverride(theme, {
        customize_typography: { heading_font: "nope", body_font: "inter" },
      }),
    ).toBe(theme);
    expect(
      applyCustomizeOverride(theme, {
        customize_buttons: { style: "solid", shape: "rounded", radius_px: 99 },
      }),
    ).toBe(theme);
  });

  it("applies saved fonts to the theme stacks", () => {
    const merged = applyCustomizeOverride(theme, {
      customize_typography: { heading_font: "playfair", body_font: "cormorant" },
    });
    expect(merged.typography.serif).toBe(FONT_STACKS.playfair);
    expect(merged.typography.sans).toBe(FONT_STACKS.cormorant);
    expect(merged.colors).toBe(theme.colors);
    expect(merged.radius.control).toBe(theme.radius.control);
    expect(merged.radius.card).toBe(theme.radius.card);
  });

  it("applies saved button shape and radius to the control radius only", () => {
    const rounded = applyCustomizeOverride(theme, {
      customize_buttons: { style: "solid", shape: "rounded", radius_px: 12 },
    });
    expect(rounded.radius.control).toBe("12px");
    expect(rounded.radius.card).toBe(theme.radius.card);

    const square = applyCustomizeOverride(theme, {
      customize_buttons: { style: "outline", shape: "square", radius_px: 12 },
    });
    expect(square.radius.control).toBe("0px");

    const pill = applyCustomizeOverride(theme, {
      customize_buttons: { style: "solid", shape: "pill", radius_px: 4 },
    });
    expect(pill.radius.control).toBe("9999px");
  });

  it("applies fonts and button radius together", () => {
    const merged = applyCustomizeOverride(theme, {
      customize_typography: { heading_font: "allura", body_font: "inter" },
      customize_buttons: { style: "solid", shape: "rounded", radius_px: 3 },
    });
    expect(merged.typography.serif).toBe(FONT_STACKS.allura);
    expect(merged.radius.control).toBe("3px");
  });
});

describe("navigation merge", () => {
  it("returns the static header unchanged without a valid non-empty list", () => {
    expect(applyNavigationOverride(header, null)).toBe(header);
    expect(applyNavigationOverride(header, {})).toBe(header);
    expect(applyNavigationOverride(header, { navigation_links: [] })).toBe(header);
    expect(
      applyNavigationOverride(header, {
        navigation_links: [{ label: "Hi" }],
      }),
    ).toBe(header);
  });

  it("replaces navigation with stored links, children included", () => {
    const merged = applyNavigationOverride(header, {
      navigation_links: [
        { label: "Shop", href: "/shop", children: [] },
        {
          label: "Men",
          href: "/shop",
          children: [{ label: "Shirts", href: "/category/shirts" }],
        },
      ],
    });
    expect(merged.navigation).toEqual([
      { label: "Shop", href: "/shop" },
      {
        label: "Men",
        href: "/shop",
        children: [{ label: "Shirts", href: "/category/shirts" }],
      },
    ]);
    expect(merged.announcement).toBe(header.announcement);
    expect(merged.searchPlaceholder).toBe(header.searchPlaceholder);
  });
});

describe("footer links merge", () => {
  it("returns the static footer unchanged without a valid non-empty list", () => {
    expect(applyFooterLinksOverride(footer, null)).toBe(footer);
    expect(applyFooterLinksOverride(footer, {})).toBe(footer);
    expect(applyFooterLinksOverride(footer, { footer_links: [] })).toBe(footer);
    expect(
      applyFooterLinksOverride(footer, {
        footer_links: [{ title: "Shop", links: [{ label: "Men" }] }],
      }),
    ).toBe(footer);
  });

  it("replaces only the link columns, keeping tagline and contact", () => {
    const merged = applyFooterLinksOverride(footer, {
      footer_links: [
        {
          title: "Shop",
          links: [{ label: "All Shirts", href: "/category/shirts" }],
        },
      ],
    });
    expect(merged.columns).toEqual([
      {
        title: "Shop",
        links: [{ label: "All Shirts", href: "/category/shirts" }],
      },
    ]);
    expect(merged.tagline).toBe(footer.tagline);
    expect(merged.contact).toBe(footer.contact);
    expect(merged.social).toBe(footer.social);
    expect(merged.copyright).toBe(footer.copyright);
  });
});

describe("storefront metadata favicon", () => {
  const base = {
    siteName: "Attires Arena",
    siteUrl: "https://attiresarena.com",
    description: "Premium menswear.",
    logoBadge: "/brand/logo-badge.jpg",
  };

  it("uses the static icon when no favicon is stored", () => {
    const metadata = resolveStorefrontMetadata(base, {});
    expect(metadata.icons).toEqual({
      icon: "/brand/icon.png",
      apple: "/brand/apple-icon.png",
    });
  });

  it("uses the saved favicon URL when provided", () => {
    const metadata = resolveStorefrontMetadata(
      { ...base, faviconUrl: "/api/brand-media/11111111-1111-4111-8111-111111111111.png" },
      {},
    );
    expect(metadata.icons).toEqual({
      icon: "/api/brand-media/11111111-1111-4111-8111-111111111111.png",
      apple: "/brand/apple-icon.png",
    });
  });

  it("uses the saved store name in the title template", () => {
    const metadata = resolveStorefrontMetadata({ ...base, siteName: "Attires Arena BD" }, {});
    expect(metadata.title).toEqual({
      default: "Attires Arena BD — Thrift Shirts in Bangladesh",
      template: "%s | Attires Arena BD",
    });
  });
});
