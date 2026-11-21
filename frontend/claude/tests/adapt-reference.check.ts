import { describe, expect, it } from "vitest";
import {
  EMPTY_CATALOG_QUERY,
  applyCatalogPatch,
  catalogHref,
  parsePriceBounds,
} from "../src/components/catalog/catalog-url";
import { incompleteStats } from "../src/lib/admin/incomplete";
import {
  DEFAULT_CUSTOMIZE_BUTTONS,
  DEFAULT_CUSTOMIZE_TYPOGRAPHY,
  DEFAULT_ERROR_404,
  FONT_STACKS,
  REDIRECT_SCHEMA,
  WIDGET_SCHEMA,
  activeWidgets,
  countdownParts,
  isLayoutSettingKey,
  isMatrixRole,
  isSiteHref,
  matrixGrantViolations,
  matrixSectionsForRole,
  normalizeRedirectSource,
  normalizeRedirectTarget,
  parseLayoutSetting,
  parseWidgetRow,
  placedWidgets,
  resolveErrorPage,
  resolveWidgetStyle,
  robotsPreview,
  widgetsAfterSection,
  type Widget,
} from "../src/lib/admin/reference-adapt";
import { withWidgetStatus } from "../src/lib/admin/widgets";

const NOW = Date.parse("2026-11-15T08:00:00+06:00");

function makeWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    title: "Winter Sale",
    type: "countdown",
    placement: "after-hero",
    title_visible: true,
    title_alignment: "left",
    title_size: "medium",
    subtitle: "Ends soon",
    ends_at: "2026-11-20T00:00:00+06:00",
    offer_title: "Winter Sale",
    discount_text: "Up to 30% off",
    style_theme: "default",
    use_theme_color: true,
    background_color: "",
    accent_color: "",
    title_color: "",
    content_color: "",
    sort_position: 0,
    active: true,
    created_at: "2026-11-15T00:00:00+06:00",
    updated_at: "2026-11-15T00:00:00+06:00",
    ...overrides,
  };
}

describe("widget rules", () => {
  it("accepts a complete countdown widget and requires an end date for countdowns", () => {
    const parsed = WIDGET_SCHEMA.safeParse({ ...makeWidget(), id: null });
    expect(parsed.success).toBe(true);
    const missingEnd = WIDGET_SCHEMA.safeParse({
      ...makeWidget(),
      id: null,
      ends_at: null,
    });
    expect(missingEnd.success).toBe(false);
    const announcement = WIDGET_SCHEMA.safeParse({
      ...makeWidget(),
      id: null,
      type: "announcement",
      ends_at: null,
    });
    expect(announcement.success).toBe(true);
  });

  it("rejects bad colors, placements and sort positions", () => {
    expect(
      WIDGET_SCHEMA.safeParse({ ...makeWidget(), id: null, background_color: "red" })
        .success,
    ).toBe(false);
    expect(
      WIDGET_SCHEMA.safeParse({ ...makeWidget(), id: null, background_color: "#6B0202" })
        .success,
    ).toBe(true);
    expect(
      WIDGET_SCHEMA.safeParse({ ...makeWidget(), id: null, placement: "after-footer" })
        .success,
    ).toBe(false);
    expect(
      WIDGET_SCHEMA.safeParse({ ...makeWidget(), id: null, sort_position: 1000 }).success,
    ).toBe(false);
  });

  it("never renders inactive, expired or end-date-less countdown widgets", () => {
    const widgets = [
      makeWidget({ id: "a0000000-0000-4000-8000-000000000001" }),
      makeWidget({ id: "a0000000-0000-4000-8000-000000000002", active: false }),
      makeWidget({
        id: "a0000000-0000-4000-8000-000000000003",
        ends_at: "2026-11-14T00:00:00+06:00",
      }),
      makeWidget({
        id: "a0000000-0000-4000-8000-000000000004",
        type: "announcement",
        ends_at: null,
      }),
    ];
    const active = activeWidgets(widgets, NOW);
    expect(active.map((w) => w.id)).toEqual([
      "a0000000-0000-4000-8000-000000000001",
      "a0000000-0000-4000-8000-000000000004",
    ]);
    expect(activeWidgets([], NOW)).toEqual([]);
  });

  it("sorts active widgets by display order then creation order", () => {
    const widgets = [
      makeWidget({
        id: "b0000000-0000-4000-8000-000000000001",
        sort_position: 1,
        created_at: "2026-11-15T00:00:00+06:00",
      }),
      makeWidget({
        id: "b0000000-0000-4000-8000-000000000002",
        sort_position: 0,
        created_at: "2026-11-15T01:00:00+06:00",
      }),
      makeWidget({
        id: "b0000000-0000-4000-8000-000000000003",
        sort_position: 0,
        created_at: "2026-11-15T00:30:00+06:00",
      }),
    ];
    expect(activeWidgets(widgets, NOW).map((w) => w.id)).toEqual([
      "b0000000-0000-4000-8000-000000000003",
      "b0000000-0000-4000-8000-000000000002",
      "b0000000-0000-4000-8000-000000000001",
    ]);
  });

  it("places widgets only after their own section, and none when inactive", () => {
    const widgets = [makeWidget({ placement: "after-categories" })];
    expect(widgetsAfterSection(widgets, "categories", NOW)).toHaveLength(1);
    expect(widgetsAfterSection(widgets, "hero", NOW)).toEqual([]);
    expect(widgetsAfterSection([], "categories", NOW)).toEqual([]);
    expect(
      widgetsAfterSection([makeWidget({ active: false })], "hero", NOW),
    ).toEqual([]);
  });

  it("selects pre-filtered widgets by placement only", () => {
    const widgets = [
      makeWidget({ placement: "after-hero" }),
      makeWidget({
        id: "c0000000-0000-4000-8000-000000000001",
        placement: "after-featured",
      }),
    ];
    expect(placedWidgets(widgets, "hero")).toHaveLength(1);
    expect(placedWidgets(widgets, "featured")).toHaveLength(1);
    expect(placedWidgets(widgets, "categories")).toEqual([]);
    expect(placedWidgets([], "hero")).toEqual([]);
  });

  it("marks ended countdowns for the admin list", () => {
    const annotated = withWidgetStatus(
      [
        makeWidget({ ends_at: "2026-11-14T00:00:00+06:00" }),
        makeWidget({
          id: "d0000000-0000-4000-8000-000000000001",
          type: "announcement",
          ends_at: null,
        }),
      ],
      NOW,
    );
    expect(annotated[0]?.ended).toBe(true);
    expect(annotated[1]?.ended).toBe(false);
  });

  it("skips malformed widget rows instead of rendering them", () => {
    expect(parseWidgetRow(null)).toBeNull();
    expect(parseWidgetRow({ ...makeWidget(), type: "slider" })).toBeNull();
    expect(parseWidgetRow({ ...makeWidget(), active: "yes" })).toBeNull();
    expect(parseWidgetRow(makeWidget())?.id).toBe(makeWidget().id);
  });

  it("computes countdown parts and expiry", () => {
    const parts = countdownParts("2026-11-17T10:30:45+06:00", NOW);
    expect(parts).toEqual({
      days: 2,
      hours: 2,
      minutes: 30,
      seconds: 45,
      expired: false,
    });
    expect(countdownParts("2026-11-15T07:59:59+06:00", NOW).expired).toBe(true);
    expect(countdownParts("not-a-date", NOW).expired).toBe(true);
  });

  it("resolves theme colors and valid custom colors only", () => {
    const themed = resolveWidgetStyle(makeWidget({ style_theme: "maroon" }));
    expect(themed.background).toBe("#6B0202");
    expect(themed.title).toBe("#FFFFFF");
    const custom = resolveWidgetStyle(
      makeWidget({
        use_theme_color: false,
        background_color: "#123456",
        accent_color: "not-a-color",
      }),
    );
    expect(custom.background).toBe("#123456");
    expect(custom.accent).toBe("#6B0202");
  });
});

describe("redirect rules", () => {
  it("normalizes site-path sources and rejects absolute or protocol-relative ones", () => {
    expect(normalizeRedirectSource("/old-page")).toBe("/old-page");
    expect(normalizeRedirectSource("  /old-page  ")).toBe("/old-page");
    expect(normalizeRedirectSource("old-page")).toBeNull();
    expect(normalizeRedirectSource("//evil.example.com")).toBeNull();
    expect(normalizeRedirectSource("https://example.com/x")).toBeNull();
    expect(normalizeRedirectSource("/has space")).toBeNull();
    expect(normalizeRedirectSource("")).toBeNull();
  });

  it("accepts site paths and absolute https targets, rejects the rest", () => {
    expect(normalizeRedirectTarget("/new-page")).toBe("/new-page");
    expect(normalizeRedirectTarget("https://example.com/new")).toBe(
      "https://example.com/new",
    );
    expect(normalizeRedirectTarget("javascript:alert(1)")).toBeNull();
    expect(normalizeRedirectTarget("//evil.example.com")).toBeNull();
    expect(normalizeRedirectTarget("https://user:pass@example.com/")).toBeNull();
  });

  it("rejects self-redirects and bad codes", () => {
    expect(
      REDIRECT_SCHEMA.safeParse({
        id: null,
        source_path: "/a",
        target_path: "/a",
        code: 301,
        active: true,
      }).success,
    ).toBe(false);
    expect(
      REDIRECT_SCHEMA.safeParse({
        id: null,
        source_path: "/a",
        target_path: "/b",
        code: 307,
        active: true,
      }).success,
    ).toBe(false);
    expect(
      REDIRECT_SCHEMA.safeParse({
        id: null,
        source_path: "/a",
        target_path: "/b",
        code: 302,
        active: true,
      }).success,
    ).toBe(true);
  });
});

describe("site href rule", () => {
  it("accepts site paths and absolute URLs, rejects dangerous values", () => {
    expect(isSiteHref("/shop")).toBe(true);
    expect(isSiteHref("https://attiresarena.com/shop")).toBe(true);
    expect(isSiteHref("//example.com")).toBe(false);
    expect(isSiteHref("javascript:void(0)")).toBe(false);
    expect(isSiteHref("data:text/html,hi")).toBe(false);
    expect(isSiteHref("relative/path")).toBe(false);
    expect(isSiteHref("/has space")).toBe(false);
  });
});

describe("layout settings", () => {
  it("parses each key and rejects malformed values", () => {
    expect(parseLayoutSetting("redirect_auto", true)).toBe(true);
    expect(parseLayoutSetting("redirect_auto", "yes")).toBeNull();
    // The featured-categories count was removed: no storefront section
    // ever read it, so the key is no longer recognised.
    expect(isLayoutSettingKey("featured_categories_count")).toBe(false);
    expect(
      parseLayoutSetting("navigation_links", [
        { label: "Shop", href: "/shop", children: [] },
      ]),
    ).toEqual([{ label: "Shop", href: "/shop", children: [] }]);
    expect(
      parseLayoutSetting("navigation_links", [
        { label: "Shop", href: "javascript:void(0)", children: [] },
      ]),
    ).toBeNull();
    expect(
      parseLayoutSetting("footer_links", [
        { title: "Help", links: [{ label: "Contact", href: "/contact" }] },
      ]),
    ).toEqual([
      { title: "Help", links: [{ label: "Contact", href: "/contact" }] },
    ]);
    expect(
      parseLayoutSetting("error_404", {
        title: "Gone",
        subtitle: "",
        image_url: "",
      }),
    ).toEqual({ title: "Gone", subtitle: "", image_url: "" });
    expect(
      parseLayoutSetting("error_404", { title: "", subtitle: "", image_url: "" }),
    ).toBeNull();
    expect(
      parseLayoutSetting("customize_typography", {
        heading_font: "playfair",
        body_font: "inter",
      }),
    ).toEqual({ heading_font: "playfair", body_font: "inter" });
    expect(
      parseLayoutSetting("customize_typography", {
        heading_font: "comic-sans",
        body_font: "inter",
      }),
    ).toBeNull();
    expect(
      parseLayoutSetting("customize_buttons", {
        style: "outline",
        shape: "pill",
        radius_px: 24,
      }),
    ).toEqual({ style: "outline", shape: "pill", radius_px: 24 });
    expect(
      parseLayoutSetting("customize_buttons", {
        style: "solid",
        shape: "rounded",
        radius_px: 25,
      }),
    ).toBeNull();
    expect(parseLayoutSetting("redirect_auto", null)).toBeNull();
  });

  it("caps navigation and footer link counts", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({
      label: `Link ${i}`,
      href: "/shop",
      children: [],
    }));
    expect(parseLayoutSetting("navigation_links", many)).toBeNull();
  });

  it("returns the built-in 404 copy by reference when nothing is stored", () => {
    expect(resolveErrorPage(null)).toBe(DEFAULT_ERROR_404);
    expect(resolveErrorPage(undefined)).toBe(DEFAULT_ERROR_404);
    expect(resolveErrorPage({ title: 42 })).toBe(DEFAULT_ERROR_404);
    expect(resolveErrorPage(DEFAULT_ERROR_404)).toEqual(DEFAULT_ERROR_404);
    expect(DEFAULT_ERROR_404.title).toBe("Page not found");
    expect(DEFAULT_ERROR_404.subtitle).toBe(
      "The page you're looking for has moved or no longer exists.",
    );
  });

  it("keeps customize defaults identical to the current storefront theme", () => {
    expect(DEFAULT_CUSTOMIZE_TYPOGRAPHY).toEqual({
      heading_font: "cormorant",
      body_font: "inter",
    });
    expect(DEFAULT_CUSTOMIZE_BUTTONS).toEqual({
      style: "solid",
      shape: "rounded",
      radius_px: 6,
    });
    expect(FONT_STACKS.cormorant).toContain("var(--font-cormorant)");
    expect(FONT_STACKS.inter).toContain("var(--font-inter)");
  });
});

describe("role access matrix", () => {
  it("limits matrix roles to moderator, editor and admin", () => {
    expect(isMatrixRole("moderator")).toBe(true);
    expect(isMatrixRole("editor")).toBe(true);
    expect(isMatrixRole("admin")).toBe(true);
    expect(isMatrixRole("owner")).toBe(false);
    expect(isMatrixRole("analyst")).toBe(false);
  });

  it("excludes Settings-and-users for every role and Costs except for admin", () => {
    const moderatorSections = matrixSectionsForRole("moderator").map(
      (g) => g.section,
    );
    expect(moderatorSections).not.toContain("Settings and users");
    expect(moderatorSections).not.toContain("Costs");
    expect(moderatorSections).toContain("Orders");
    const adminSections = matrixSectionsForRole("admin").map((g) => g.section);
    expect(adminSections).toContain("Costs");
    expect(adminSections).not.toContain("Settings and users");
    expect(matrixSectionsForRole("editor").map((g) => g.section)).not.toContain(
      "Costs",
    );
  });

  it("never allows settings, users or moderator/editor cost grants", () => {
    expect(
      matrixGrantViolations("moderator", ["settings.manage", "users.manage"]),
    ).toEqual(["settings.manage", "users.manage"]);
    expect(matrixGrantViolations("moderator", ["costs.read"])).toEqual([
      "costs.read",
    ]);
    expect(matrixGrantViolations("editor", ["costs.read"])).toEqual(["costs.read"]);
    expect(matrixGrantViolations("admin", ["costs.read"])).toEqual([]);
    expect(
      matrixGrantViolations("admin", ["orders.read", "catalogue.manage"]),
    ).toEqual([]);
  });
});

describe("robots preview", () => {
  it("derives the meta directive and robots.txt from the saved toggles", () => {
    expect(robotsPreview({ index: true, follow: true })).toEqual({
      metaRobots: "index, follow",
      robotsTxt: "User-agent: *\nAllow: /",
    });
    expect(robotsPreview({ index: false, follow: false })).toEqual({
      metaRobots: "noindex, nofollow",
      robotsTxt: "User-agent: *\nDisallow: /",
    });
    expect(robotsPreview({ index: true, follow: false }).metaRobots).toBe(
      "index, nofollow",
    );
  });
});

describe("incomplete stats", () => {
  const view = (status: string, valueMinor: number) => ({
    session: { recovery_status: status },
    valueMinor,
  });
  it("counts page rows and totals only recoverable value", () => {
    const stats = incompleteStats(
      [
        view("pending", 100000),
        view("contacted", 50000),
        view("recovered", 200000),
        view("lost", 30000),
      ] as never,
      42,
    );
    expect(stats).toEqual({
      totalAbandoned: 42,
      pendingRecovery: 2,
      recovered: 1,
      potentialRevenueMinor: 150000,
      pageCount: 4,
    });
  });

  it("handles an empty page", () => {
    expect(incompleteStats([], 0)).toEqual({
      totalAbandoned: 0,
      pendingRecovery: 0,
      recovered: 0,
      potentialRevenueMinor: 0,
      pageCount: 0,
    });
  });
});

describe("price filter composition (verified filter/sort/Clear-all behavior)", () => {
  it("keeps sort and category when a price range is applied", () => {
    const next = applyCatalogPatch(
      { categorySlugs: ["shirts"], sort: "newest", page: 3 },
      { minPrice: 500, maxPrice: 2000 },
    );
    expect(next).toEqual({
      categorySlugs: ["shirts"],
      sort: "newest",
      minPrice: 500,
      maxPrice: 2000,
      page: 1,
    });
  });

  it("keeps the price range when sort changes afterwards", () => {
    const withPrice = applyCatalogPatch({}, { minPrice: 500, maxPrice: 2000 });
    const sorted = applyCatalogPatch(withPrice, { sort: "price-asc" });
    expect(sorted.minPrice).toBe(500);
    expect(sorted.maxPrice).toBe(2000);
    expect(sorted.sort).toBe("price-asc");
  });

  it("serializes price with the other filters in the URL", () => {
    const href = catalogHref("/shop", {
      categorySlugs: ["shirts"],
      inStock: true,
      minPrice: 500,
      maxPrice: 2000,
      sort: "newest",
    });
    expect(href).toBe(
      "/shop?category=shirts&available=1&min=500&max=2000&sort=newest",
    );
  });

  it("clears everything including price on Clear all", () => {
    // Reset navigates to the empty query itself (not a patch onto the
    // current query), so the URL carries no filters, sort or price.
    expect(EMPTY_CATALOG_QUERY).toEqual({});
    expect(catalogHref("/shop", EMPTY_CATALOG_QUERY)).toBe("/shop");
  });

  it("removes only the price range when the price chip is removed", () => {
    const next = applyCatalogPatch(
      { categorySlugs: ["shirts"], minPrice: 500, maxPrice: 2000, sort: "newest" },
      { minPrice: undefined, maxPrice: undefined },
    );
    expect(next).toEqual({
      categorySlugs: ["shirts"],
      minPrice: undefined,
      maxPrice: undefined,
      sort: "newest",
      page: 1,
    });
  });
});

describe("price bounds", () => {
  it("parses empty bounds as unset and whole taka amounts as numbers", () => {
    expect(parsePriceBounds("", "")).toEqual({ ok: true });
    expect(parsePriceBounds("500", "")).toEqual({ ok: true, minPrice: 500 });
    expect(parsePriceBounds("", "2000")).toEqual({ ok: true, maxPrice: 2000 });
    expect(parsePriceBounds(" 500 ", "2000")).toEqual({
      ok: true,
      minPrice: 500,
      maxPrice: 2000,
    });
  });

  it("rejects decimals, negatives and non-numbers", () => {
    expect(parsePriceBounds("10.5", "").ok).toBe(false);
    expect(parsePriceBounds("-5", "").ok).toBe(false);
    expect(parsePriceBounds("abc", "").ok).toBe(false);
    expect(parsePriceBounds("1,000", "").ok).toBe(false);
  });

  it("rejects a minimum above the maximum", () => {
    const result = parsePriceBounds("2000", "500");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("more than the maximum");
    }
    expect(parsePriceBounds("500", "500")).toEqual({
      ok: true,
      minPrice: 500,
      maxPrice: 500,
    });
  });
});
