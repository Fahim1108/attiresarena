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
 *    default was 6s. Both hero configs then rotated every 2s; the hero
 *    tweak (2026-11-16) moved both to 3s, sequentially.
 * 3. Manual navigation never restarted the autoplay timer in either hero
 *    variant (the interval effect did not depend on navigation), so a
 *    manual advance could be followed almost immediately by an automatic
 *    one. Both variants now bump a `cycle` counter on manual navigation
 *    and the autoplay effect depends on it, restarting the full window.
 * 4. The first live advance took >6s at a 2s config. No stored setting can
 *    override the interval (see EXPLORATION.md); the timer starts only
 *    after hydration, and the old `sync()` restarted the countdown on
 *    every visibility/media event even while already running. `sync()`
 *    now starts/stops only on a real running-state change.
 * 5. The banner transition is a gentle slide+fade (opacity + a slight
 *    sideways drift), not opacity-only. The editorial variant keeps its
 *    opacity fade; it is not the live hero.
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
  it("serves the campaign hero with 3s autoplay from the storefront settings the homepage reads", async () => {
    // getStorefrontSettings also reads the published feed, but with no
    // Supabase configuration that read short-circuits offline (readRows
    // returns "not-configured" without fetching), so stub the credentials
    // empty to guarantee no network contact. Reference equality is the
    // discriminating check: the editorial default also rotates every 3s
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
      expect(settings.hero.autoplayMs).toBe(3000);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("hero rotation interval", () => {
  it("rotates the live campaign hero every 3 seconds", () => {
    expect(campaignHero.autoplayMs).toBe(3000);
  });

  it("rotates the editorial hero every 3 seconds", () => {
    expect(editorialHeroDefaults.autoplayMs).toBe(3000);
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

  it("keeps every slide mounted and slides+fades gently (opacity + slight sideways drift, no remount per advance)", () => {
    expect(carousel).toContain("hero.slides.map");
    expect(carousel).toContain("opacity-100");
    expect(carousel).toContain("opacity-0");
    expect(carousel).toContain("transition-[opacity,transform] duration-500 ease-out");
    expect(carousel).not.toContain("transition-opacity");
    expect(carousel).toContain("translate-x-0");
    expect(carousel).toContain("translate-x-[2%]");
    expect(carousel).toContain("motion-reduce:translate-x-0");
    // Tie the classes to the active/inactive assignment: a swapped ternary
    // would still pass the presence pins above but put the offset on the
    // visible slide. Pin the full ternary fragment so a swap fails.
    expect(carousel).toContain(
      "i===active?'translate-x-0 opacity-100':'pointer-events-none translate-x-[2%] opacity-0'",
    );
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

describe("hero autoplay timer restart guard", () => {
  it("does not restart a running banner carousel timer on visibility/media events", () => {
    // sync() must leave an already-running interval alone: the old
    // unconditional clear+recreate restarted the countdown on every
    // visibilitychange/media-change event and delayed the first advance.
    expect(carousel).toContain("if(timer!==undefined)return;");
    expect(carousel).toContain("timer=undefined;return;");
    expect(carousel).not.toContain("window.clearInterval(timer);\n      if(!media.matches");
    // Order matters, not just presence: the stop branch must come BEFORE
    // the running-guard, or a guard placed first would return early and the
    // timer would never stop when hidden. Pin the ordering so a misordered
    // sync() fails even though both fragments are present.
    const stopAt = carousel.indexOf(
      "if(media.matches||document.hidden){window.clearInterval(timer);timer=undefined;return;}",
    );
    const guardAt = carousel.indexOf("if(timer!==undefined)return;");
    expect(stopAt).toBeGreaterThanOrEqual(0);
    expect(guardAt).toBeGreaterThan(stopAt);
  });

  it("does not restart a running editorial hero timer on visibility/media events", () => {
    expect(heroTsx).toContain("if (timer !== undefined) return;");
    expect(heroTsx).toContain("timer = undefined; return;");
    // Same ordering pin as the banner carousel: the stop branch must
    // precede the running-guard, or the timer would never stop when hidden.
    const stopAt = heroTsx.indexOf(
      'if (media.matches || document.hidden) { window.clearInterval(timer); timer = undefined; return; }',
    );
    const guardAt = heroTsx.indexOf("if (timer !== undefined) return;");
    expect(stopAt).toBeGreaterThanOrEqual(0);
    expect(guardAt).toBeGreaterThan(stopAt);
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
