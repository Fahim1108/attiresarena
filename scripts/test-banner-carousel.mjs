import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

/**
 * Banner-carousel behaviour verification (hero section, 2026-11-16 order):
 * full-width 16:9 frame with no side gaps, sequential 2s auto-rotation,
 * hover/focus/manual pause, manual-advance timer reset, reduced motion.
 * Runs against a local preview only (CLAUDE_PREVIEW_URL, default :3006).
 *
 * Timing is asserted in REAL time with measured windows. Playwright's fake
 * clock was tried first and does not drive this component: with the clock
 * paused, React never flushes the interval's state update to the DOM even
 * across runFor(2000), while the same build rotates every ~2.0s in real
 * time (verified empirically 2026-11-16). Windows below allow for slow
 * shared-CPU hydration while still discriminating the behaviours.
 *
 * Chromium: Playwright's bundled build by default; set CHROMIUM_PATH to
 * override (the old /usr/bin/chromium path does not exist on every host).
 */
const launchOptions = { args: ["--no-sandbox"] };
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launchOptions);
const origin = process.env.CLAUDE_PREVIEW_URL || "http://localhost:3006";
const dir = "artifacts/banner-carousel";
await mkdir(dir, { recursive: true });
const results = [];

/** Current active slide number (1-based) from its aria-label. */
async function slideNumber(active) {
  const label = await active().getAttribute("aria-label");
  return Number(String(label).split(" ")[0]);
}

/**
 * Wait for the active slide to change from `from`, polling every 100ms.
 * Returns the elapsed ms, or null if `timeoutMs` passes without a change.
 */
async function waitForChange(active, from, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await slideNumber(active)) !== from) return Date.now() - start;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * Clear hover AND focus pause after interacting with the carousel: a mouse
 * click leaves the pointer over the hero (hover pause) and focus inside it
 * (focus pause), either of which legitimately stops rotation. Moving to the
 * top-left corner leaves the hero, and blurring clears focus.
 */
async function settle(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
}

/** Swipe left on the banner frame (next slide), without moving the mouse or focus. */
async function swipeLeft(carousel) {
  const surface = carousel.locator("[data-banner-frame]");
  await surface.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 250, clientY: 100 }] });
  await surface.dispatchEvent("touchend", { changedTouches: [{ identifier: 1, clientX: 100, clientY: 105 }] });
}

try {
  for (const width of [390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: true });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const carousel = page.getByRole("region", { name: "Attires Arena campaigns" });
    const active = () => carousel.locator('[aria-roledescription="slide"][aria-hidden="false"]');
    await expect(active()).toHaveAttribute("aria-label", /^1 of 3/);
    await expect
      .poll(() => carousel.locator("img").evaluateAll((imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0)))
      .toBe(true);
    // Full width, no side gaps: the frame spans the viewport, its ratio
    // matches the 16:9 artwork, and object-contain therefore fills it
    // exactly (contain + equal ratios leaves no letterbox on any side).
    const frame = await carousel.locator("[data-banner-frame]").boundingBox();
    assert.ok(frame, "banner frame exists");
    // Compare against the layout viewport, not the window viewport: with
    // classic space-taking scrollbars the frame spans clientWidth, which
    // is narrower than the viewport width by the scrollbar.
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    assert.ok(Math.abs(frame.width - clientWidth) <= 1, `frame spans viewport (${frame.width} vs ${clientWidth})`);
    assert.ok(Math.abs(frame.height - (width * 9) / 16) <= 2, `frame is 16:9 (${frame.width}x${frame.height})`);
    assert.ok(
      await carousel
        .locator("img")
        .evaluateAll((imgs) => imgs.every((i) => getComputedStyle(i).objectFit === "contain")),
    );
    assert.ok(
      await carousel
        .locator("img")
        .evaluateAll((imgs) => imgs.every((i) => Math.abs(i.naturalWidth / i.naturalHeight - 16 / 9) < 0.01)),
    );
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    // Pause control exists now that autoplay is on (it was absent when autoplayMs was 0).
    await expect(carousel.getByRole("button", { name: "Pause banners", exact: true })).toBeVisible();

    // Sequential rotation with wraparound, in order 1 -> 2 -> 3 -> 1.
    // The first wait is generous: hydration on a slow host delays the first tick.
    await expect(active()).toHaveAttribute("aria-label", /^2 of 3/, { timeout: 12000 });
    await expect(active()).toHaveAttribute("aria-label", /^3 of 3/, { timeout: 5000 });
    await expect(active()).toHaveAttribute("aria-label", /^1 of 3/, { timeout: 5000 });

    // Measured interval: the gap between two consecutive advances is ~2s.
    const gap = await waitForChange(active, 1, 5000);
    assert.ok(gap !== null && gap >= 1500 && gap <= 3200, `rotation interval ~2s (measured ${gap}ms)`);
    assert.equal(await slideNumber(active), 2);

    // Manual pause stops rotation; resume restarts it.
    await carousel.getByRole("button", { name: "Pause banners", exact: true }).click();
    await settle(page);
    await expect(carousel.getByRole("button", { name: "Play banners", exact: true })).toBeVisible();
    assert.equal(await waitForChange(active, 2, 2600), null, "paused carousel must not advance in 2.6s");
    await carousel.getByRole("button", { name: "Play banners", exact: true }).click();
    await settle(page);
    assert.notEqual(await waitForChange(active, 2, 4500), null, "resumed carousel advances");
    assert.equal(await slideNumber(active), 3);

    // Hover pauses; leaving resumes with a fresh window.
    await carousel.locator("[data-banner-frame]").hover();
    assert.equal(await waitForChange(active, 3, 2600), null, "hovered carousel must not advance in 2.6s");
    await page.mouse.move(0, 0);
    assert.notEqual(await waitForChange(active, 3, 4500), null, "carousel resumes after hover ends");
    assert.equal(await slideNumber(active), 1);

    // Keyboard focus within the hero pauses; blur resumes.
    await carousel.getByRole("button", { name: "Next banner" }).focus();
    assert.equal(await waitForChange(active, 1, 2600), null, "focused carousel must not advance in 2.6s");
    await settle(page);
    assert.notEqual(await waitForChange(active, 1, 4500), null, "carousel resumes after blur");
    assert.equal(await slideNumber(active), 2);

    // Manual advance RESETS the timer (discriminating check): 1.2s into a
    // window, swipe to the next slide without touching hover/focus state, so
    // the navigation itself is the only thing that can restart the timer.
    // With the reset, the next automatic advance comes ~2s after the swipe;
    // without it, the old schedule would fire ~0.8s after the swipe.
    await page.waitForTimeout(1200);
    await swipeLeft(carousel);
    assert.equal(await slideNumber(active), 3);
    const resetGap = await waitForChange(active, 3, 4500);
    assert.ok(
      resetGap !== null && resetGap >= 1500 && resetGap <= 3400,
      `timer resets on manual advance (advance ${resetGap}ms after swipe, want ~2000ms)`,
    );
    assert.equal(await slideNumber(active), 1);

    // Arrow click: no near-immediate automatic advance after a manual one.
    await page.waitForTimeout(1200);
    await carousel.getByRole("button", { name: "Next banner" }).click();
    await settle(page);
    assert.equal(await slideNumber(active), 2);
    await page.waitForTimeout(1200);
    assert.equal(await slideNumber(active), 2, "no automatic advance 1.2s after an arrow click");
    assert.notEqual(await waitForChange(active, 2, 2500), null, "advance follows ~2s after arrow click");
    assert.equal(await slideNumber(active), 3);

    // Dot navigation: same user-visible behaviour.
    await page.waitForTimeout(1200);
    await carousel.getByRole("button", { name: "Show banner 1: Classic Brand" }).click();
    await settle(page);
    assert.equal(await slideNumber(active), 1);
    await page.waitForTimeout(1200);
    assert.equal(await slideNumber(active), 1, "no automatic advance 1.2s after a dot click");
    assert.notEqual(await waitForChange(active, 1, 2500), null, "advance follows ~2s after dot click");
    assert.equal(await slideNumber(active), 2);

    // Arrows loop, keyboard arrows work, swipe works (pre-existing behaviour).
    // Pause first so auto-rotation cannot interleave with these assertions.
    await carousel.getByRole("button", { name: "Pause banners", exact: true }).click();
    await settle(page);
    await carousel.getByRole("button", { name: "Show banner 3: Boutique Showcase" }).click();
    await carousel.getByRole("button", { name: "Next banner" }).click();
    await expect(active()).toHaveAttribute("aria-label", /^1 of 3/);
    await carousel.getByRole("button", { name: "Previous banner" }).click();
    await expect(active()).toHaveAttribute("aria-label", /^3 of 3/);
    await carousel.getByRole("button", { name: "Previous banner" }).press("ArrowRight");
    await expect(active()).toHaveAttribute("aria-label", /^1 of 3/);
    await swipeLeft(carousel);
    await expect(active()).toHaveAttribute("aria-label", /^2 of 3/);

    await carousel.screenshot({ path: `${dir}/carousel-${width}.png`, animations: "disabled" });
    results.push({
      width,
      imageRatio: "16:9",
      frame: `${frame.width}x${frame.height}`,
      fullWidth: true,
      contain: true,
      rotationMs: 2000,
      measuredGapMs: gap,
      measuredResetGapMs: resetGap,
      sequential: true,
      wraparound: true,
      manualPause: true,
      hoverPause: true,
      focusPause: true,
      timerReset: true,
      arrows: true,
      loop: true,
      swipe: true,
      keyboard: true,
      overflow: false,
    });
    await page.close();
    console.log(`PASS carousel ${width}px (gap ${gap}ms, reset gap ${resetGap}ms)`);
  }

  // Reduced motion: no auto-advance at all, manual controls still work.
  const reduced = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await reduced.goto(origin, { waitUntil: "domcontentloaded" });
  const reducedCarousel = reduced.getByRole("region", { name: "Attires Arena campaigns" });
  const reducedActive = () => reducedCarousel.locator('[aria-roledescription="slide"][aria-hidden="false"]');
  await expect(reducedActive()).toHaveAttribute("aria-label", /^1 of 3/);
  assert.equal(await waitForChange(reducedActive, 1, 5000), null, "reduced-motion carousel must not auto-advance");
  await reducedCarousel.getByRole("button", { name: "Next banner" }).click();
  await expect(reducedActive()).toHaveAttribute("aria-label", /^2 of 3/);
  results.push({ width: 1440, reducedMotion: true, manualOnlyUnderReducedMotion: true });
  await reduced.close();
  console.log("PASS carousel reduced-motion 1440px");
} finally {
  await browser.close();
  await writeFile(`${dir}/verification.json`, JSON.stringify({ origin, results }, null, 2));
}
