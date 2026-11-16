import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { campaignHero } from "@/config/campaign-banners";
import { hero as editorialHeroDefaults } from "@/config/homepage";
import { ownerCatalogue } from "@/services/adapters/owner-catalogue";

/**
 * Hero-section regressions (ordered 2026-11-16):
 * 1. The live image-only hero (BannerCarousel, fed by campaignHero) showed
 *    wide white gaps on both sides of every banner on desktop: its frame
 *    was h-[clamp(380px,29vw,460px)] (417px tall at 1440px) while the 16:9
 *    artwork was rendered with object-contain, so the sharp image spanned
 *    only ~742px of the 1440px frame. The frame now matches the artwork
 *    ratio (aspect-video), so contain fills it edge-to-edge with no crop
 *    of the contact strip along the artwork's bottom edge.
 * 2. Auto-rotation was off (campaignHero autoplayMs: 0) and the editorial
 *    default was 6s. Both hero configs now rotate every 2s, sequentially.
 * 3. Manual navigation never restarted the autoplay timer in either hero
 *    variant (the interval effect did not depend on navigation), so a
 *    manual advance could be followed almost immediately by an automatic
 *    one. Both variants now bump a `cycle` counter on manual navigation
 *    and the autoplay effect depends on it, restarting the full window.
 * Behaviour itself (advance timing, hover/focus pause, reduced motion,
 * timer reset) is proven in the browser by scripts/test-banner-carousel.mjs;
 * these checks pin the config values and the wiring that behaviour relies on.
 */

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const carousel = read("../src/components/home/BannerCarousel.tsx");
const heroTsx = read("../src/components/home/Hero.tsx");

describe("hero live wiring", () => {
  it("serves the campaign hero with 2s autoplay from the storefront settings the homepage reads", async () => {
    // getStorefrontSettings also reads the published feed, but with no
    // Supabase configuration that read short-circuits offline (readRows
    // returns "not-configured" without fetching), so stub the credentials
    // empty to guarantee no network contact. Reference equality is the
    // discriminating check: the editorial default also rotates every 2s
    // now, so autoplayMs alone would not catch the override being removed.
    for (const name of [
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ])
      vi.stubEnv(name, "");
    try {
      const settings = await ownerCatalogue.getStorefrontSettings();
      expect(settings.hero).toBe(campaignHero);
      expect(settings.hero.autoplayMs).toBe(2000);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("hero rotation interval", () => {
  it("rotates the live campaign hero every 2 seconds", () => {
    expect(campaignHero.autoplayMs).toBe(2000);
  });

  it("rotates the editorial hero every 2 seconds", () => {
    expect(editorialHeroDefaults.autoplayMs).toBe(2000);
  });
});

describe("hero banner data (unchanged)", () => {
  it("keeps the campaign hero image-only with the same three banners", () => {
    expect(campaignHero.imageOnly).toBe(true);
    expect(campaignHero.side).toEqual([]);
    expect(campaignHero.badges).toEqual([]);
    expect(campaignHero.slides.map((s) => s.id)).toEqual([
      "banner-01",
      "banner-02",
      "banner-03",
    ]);
    expect(campaignHero.slides.map((s) => s.title)).toEqual([
      "Classic Brand",
      "Editorial Collage",
      "Boutique Showcase",
    ]);
    expect(campaignHero.slides.map((s) => s.image.src)).toEqual([
      "/banners/01_classic_brand.webp",
      "/banners/02_editorial_collage.webp",
      "/banners/03_boutique_showcase.webp",
    ]);
  });

  it("adds no fields to the hero settings or banner data model", () => {
    expect(Object.keys(campaignHero).sort()).toEqual(
      ["autoplayMs", "badges", "imageOnly", "side", "slides"].sort(),
    );
    for (const slide of campaignHero.slides) {
      expect(Object.keys(slide).sort()).toEqual(
        ["align", "id", "image", "title", "tone"].sort(),
      );
    }
  });
});

describe("hero full-width frame", () => {
  it("sizes the banner frame to the 16:9 artwork ratio at full width", () => {
    expect(carousel).toContain("aspect-video");
    expect(carousel).toContain("w-full");
  });

  it("removes the fixed clamp heights that caused the side gaps", () => {
    expect(carousel).not.toContain("h-[clamp(");
    expect(carousel).not.toContain("29vw");
    expect(carousel).not.toContain("818px");
  });

  it("keeps the artwork whole (contain, never cropped) and serves viewport-width images", () => {
    expect(carousel).toContain("object-contain");
    expect(carousel).not.toContain("object-cover");
    expect(carousel).toContain('sizes="100vw"');
  });

  it("keeps every slide mounted and cross-fades with opacity only (no remount per advance)", () => {
    expect(carousel).toContain("hero.slides.map");
    expect(carousel).toContain("opacity-100");
    expect(carousel).toContain("opacity-0");
    expect(carousel).toContain("transition-opacity duration-500");
    expect(heroTsx).toContain("slides.map");
  });
});

describe("hero autoplay timer reset", () => {
  it("restarts the banner carousel interval on every manual navigation", () => {
    // Both manual paths (arrows/keyboard/swipe via go, dots via goTo) bump cycle.
    expect(carousel.match(/setCycle\(c=>c\+1\)/g)?.length).toBe(2);
    expect(carousel).toContain("hero.autoplayMs,cycle]");
  });

  it("restarts the editorial hero interval on manual navigation", () => {
    expect(heroTsx).toContain("setCycle((c) => c + 1)");
    expect(heroTsx).toContain("slides.length, cycle]");
  });
});

describe("hero autoplay pause rules", () => {
  it("honours hover, focus, reduced motion, and tab visibility in the banner carousel", () => {
    expect(carousel).toContain("prefers-reduced-motion");
    expect(carousel).toContain("setHovered");
    expect(carousel).toContain("setFocused");
    expect(carousel).toContain("document.hidden");
    expect(carousel).toContain("visibilitychange");
    expect(carousel).toContain("clearInterval");
  });

  it("honours hover, focus, reduced motion, and tab visibility in the editorial hero", () => {
    expect(heroTsx).toContain("prefers-reduced-motion");
    expect(heroTsx).toContain("setHovered");
    expect(heroTsx).toContain("setFocused");
    expect(heroTsx).toContain("document.hidden");
    expect(heroTsx).toContain("visibilitychange");
    expect(heroTsx).toContain("clearInterval");
  });

  it("keeps the manual controls and their labels in both variants", () => {
    expect(carousel).toContain("Previous banner");
    expect(carousel).toContain("Next banner");
    expect(carousel).toContain("Show banner");
    expect(carousel).toContain("Pause banners");
    expect(carousel).toContain("Play banners");
    expect(heroTsx).toContain("Previous slide");
    expect(heroTsx).toContain("Next slide");
    expect(heroTsx).toContain("Pause slideshow");
    expect(heroTsx).toContain("Play slideshow");
  });
});
