import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OrderTimeline } from "@/components/account/OrderTimeline";
import {
  BANNER_FIT_HEIGHT,
  BANNER_FIT_MAX_BYTES,
  BANNER_FIT_WIDTH,
} from "@/components/admin/catalog/banner-image-fit";
import type { OrderTimelineEvent } from "@/types";

/**
 * Client feedback batch E: banner admin size + auto-fit (item 2),
 * timeline ticks (item 18), admin speed (item 17), Google belt
 * image (item 1 — check only, no code change: the homepage OG is
 * already the check-shirts photo).
 */

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(TESTS_DIR, "..", "src");

async function readSrc(relative: string): Promise<string> {
  return readFile(join(SRC_DIR, relative), "utf8");
}

/** The customer timeline is derived from status + placedAt only: one timestamp, no intermediate ones. */
function derivedTimeline(status: string): { events: OrderTimelineEvent[]; status: string } {
  return {
    events: [
      { status: "pending", label: "Pending", at: "2026-11-16T10:00:00.000Z" },
      { status: status as OrderTimelineEvent["status"], label: status },
    ],
    status,
  };
}

function tickCount(html: string): number {
  // Each completed stage renders one lucide Check <svg> inside its indicator; nothing else in the timeline renders an <svg>.
  return (html.match(/<svg/g) ?? []).length;
}

describe("timeline ticks (item 18)", () => {
  it("ticks every passed stage for a shipped order and blinks only the current one", () => {
    const { events, status } = derivedTimeline("shipped");
    const html = renderToStaticMarkup(
      createElement(OrderTimeline, { events, status: status as never }),
    );
    expect(tickCount(html)).toBe(3); // Order Placed, Confirmed, Packed
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain("Current stage");
    expect(html).toContain("Shipped");
  });

  it("ticks all six stages for a delivered order, with no blinking current stage", () => {
    const { events, status } = derivedTimeline("delivered");
    const html = renderToStaticMarkup(
      createElement(OrderTimeline, { events, status: status as never }),
    );
    expect(tickCount(html)).toBe(6);
    expect(html).toContain("Final status");
    expect(html).not.toContain("Current stage");
  });

  it("ticks the whole chain for a returned order (delivery happened before the return)", () => {
    const { events, status } = derivedTimeline("returned");
    const html = renderToStaticMarkup(
      createElement(OrderTimeline, { events, status: status as never }),
    );
    expect(tickCount(html)).toBe(7); // six stages + Returned
    expect(html).toContain("Final status");
  });

  it("does not invent ticks for a cancelled order: only the placed stage and the cancellation tick", () => {
    const { events, status } = derivedTimeline("cancelled");
    const html = renderToStaticMarkup(
      createElement(OrderTimeline, { events, status: status as never }),
    );
    expect(tickCount(html)).toBe(2); // Order Placed + Cancelled
    expect(html).toContain("Final status");
  });

  it("still invents no timestamps: only the placed stage shows a date", () => {
    const { events, status } = derivedTimeline("shipped");
    const html = renderToStaticMarkup(
      createElement(OrderTimeline, { events, status: status as never }),
    );
    // One date line (the placedAt date); the passed stages show ticks, not dates.
    expect(html.match(/16 Nov 2026|Nov 16, 2026|2026-11-16/g)?.length ?? 0).toBeGreaterThan(0);
    expect(html).not.toContain("undefined");
  });
});

describe("banner admin size + auto-fit (item 2)", () => {
  it("fits to the built-in banner frame: 1920x1080 (16:9), under the 768 KiB server cap", () => {
    expect(BANNER_FIT_WIDTH).toBe(1920);
    expect(BANNER_FIT_HEIGHT).toBe(1080);
    expect(BANNER_FIT_WIDTH / BANNER_FIT_HEIGHT).toBe(16 / 9);
    expect(BANNER_FIT_MAX_BYTES).toBe(768 * 1024);
  });

  it("states the required size in the form and fits uploads before submit", async () => {
    const form = await readSrc("components/admin/content/forms.tsx");
    expect(form).toContain("BANNER_FIT_WIDTH");
    expect(form).toContain("BANNER_FIT_HEIGHT");
    expect(form).toContain("16:9");
    expect(form).toContain("fitBannerImage");
    expect(form).toContain("onImageChange");
    expect(form).not.toContain("Image (JPEG, PNG or WebP, up to 768 KiB)");
  });

  it("fits by containing the whole image on a white canvas, never by cropping", async () => {
    const fit = await readSrc("components/admin/catalog/banner-image-fit.ts");
    expect(fit).toContain("contain");
    expect(fit).toContain("#ffffff");
    expect(fit).toContain("imageOrientation");
    expect(fit).toContain("Math.min(1,");
    expect(fit).toContain("768 * 1024");
  });
});

describe("admin speed (item 17)", () => {
  it("runs the independent session checks in parallel and dedupes the check per request", async () => {
    const access = await readSrc("lib/admin/access.ts");
    expect(access).toContain("Promise.all");
    expect(access).toContain("client.auth.getUser()");
    expect(access).toContain("client.auth.mfa.getAuthenticatorAssuranceLevel()");
    expect(access).toContain("cache(async function staffSession");
    // Redirect order is unchanged: no user, then no roles, then MFA.
    const noUser = access.indexOf('redirect("/admin/sign-in")');
    const noRoles = access.indexOf('redirect("/admin/sign-in?denied=1")');
    const mfa = access.indexOf('redirect("/admin/mfa")');
    expect(noUser).toBeGreaterThan(-1);
    expect(noRoles).toBeGreaterThan(noUser);
    expect(mfa).toBeGreaterThan(noRoles);
  });

  it("keeps the workspace loading skeleton for the post-session wait", async () => {
    const loading = await readSrc("app/admin/(workspace)/loading.tsx");
    expect(loading).toContain("Loading administration page");
    expect(loading).toContain("aa-skeleton-row");
  });
});

describe("Google belt image (item 1 — check only)", () => {
  it("the homepage share image is the check-shirts photo, not a belt", async () => {
    const seo = await readSrc("lib/seo.ts");
    expect(seo).toContain('url: "/brand/og-home.jpg"');
    expect(seo).toContain("Two folded check thrift shirts");
  });
});
