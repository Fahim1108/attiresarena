import { afterEach, describe, expect, it, vi } from "vitest";
import { isProductionStorefront } from "../src/lib/storefront-policy";
import {
  buildRobots,
  buildSeoHeaders,
  buildSeoRedirects,
  canonicalUrl,
  isProductionBuildEnv,
  isProductionEnv,
  resolveCanonicalBase,
  resolveIndexingPolicy,
  resolveSeoBaseUrl,
  SEO_PRIVATE_HEADER_SOURCES,
  SEO_PRIVATE_ROBOTS_DISALLOW,
} from "../src/lib/seo";

describe("isProductionEnv", () => {
  it("is production on VERCEL_ENV=production regardless of NODE_ENV", () => {
    expect(isProductionEnv({ VERCEL_ENV: "production", NODE_ENV: "development" })).toBe(true);
    expect(isProductionEnv({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("is production for a production Node run with no VERCEL_ENV", () => {
    expect(isProductionEnv({ NODE_ENV: "production" })).toBe(true);
  });

  it("is not production for preview, development, test, or unset env", () => {
    expect(isProductionEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
    expect(isProductionEnv({ VERCEL_ENV: "development" })).toBe(false);
    expect(isProductionEnv({ NODE_ENV: "test" })).toBe(false);
    expect(isProductionEnv({})).toBe(false);
  });

  it("never consults fixture flags or request data", () => {
    // CLAUDE_DESIGN_PREVIEW / host / cookies are not even parameters: the
    // type only carries VERCEL_ENV + NODE_ENV, so they cannot influence it.
    expect(isProductionEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
  });
});

describe("isProductionEnv ≡ isProductionStorefront equivalence (S6)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    { vercelEnv: "production", nodeEnv: "development", expected: true },
    { vercelEnv: "production", nodeEnv: "production", expected: true },
    { vercelEnv: "production", nodeEnv: "test", expected: true },
    { vercelEnv: "preview", nodeEnv: "production", expected: false },
    { vercelEnv: "development", nodeEnv: "production", expected: false },
    { vercelEnv: "staging", nodeEnv: "production", expected: false },
    { vercelEnv: "", nodeEnv: "production", expected: true },
    { vercelEnv: "", nodeEnv: "development", expected: false },
    { vercelEnv: "", nodeEnv: "test", expected: false },
    { vercelEnv: "preview", nodeEnv: "development", expected: false },
  ])(
    "VERCEL_ENV=$vercelEnv NODE_ENV=$nodeEnv → $expected",
    ({ vercelEnv, nodeEnv, expected }) => {
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      vi.stubEnv("NODE_ENV", nodeEnv);
      // Both predicates read the same process.env values; the pure form
      // must agree with the sanctioned form in every case ("" is falsy
      // like an unset variable in both predicates).
      expect(isProductionStorefront()).toBe(expected);
      expect(
        isProductionEnv({
          VERCEL_ENV: process.env.VERCEL_ENV,
          NODE_ENV: process.env.NODE_ENV,
        }),
      ).toBe(expected);
    },
  );
});

describe("resolveIndexingPolicy environment matrix", () => {
  const on = { index: true, follow: true };
  const off = { index: false, follow: false };

  it("Preview + toggle ON still yields noindex/nofollow + disallow-all + empty sitemap", () => {
    const policy = resolveIndexingPolicy({ isProduction: false, robots: on });
    expect(policy.metaRobots).toEqual({ index: false, follow: false });
    expect(policy.robotsTxt).toBe("disallow-all");
    expect(policy.sitemapAllowed).toBe(false);
  });

  it("Preview + toggle OFF yields noindex/nofollow + disallow-all + empty sitemap", () => {
    const policy = resolveIndexingPolicy({ isProduction: false, robots: off });
    expect(policy.metaRobots).toEqual({ index: false, follow: false });
    expect(policy.robotsTxt).toBe("disallow-all");
    expect(policy.sitemapAllowed).toBe(false);
  });

  it("Preview + unset/malformed toggle fails closed", () => {
    const policy = resolveIndexingPolicy({ isProduction: false, robots: null });
    expect(policy.metaRobots).toEqual({ index: false, follow: false });
    expect(policy.robotsTxt).toBe("disallow-all");
    expect(policy.sitemapAllowed).toBe(false);
  });

  it("Production + toggle ON yields index/follow + allow + sitemap", () => {
    const policy = resolveIndexingPolicy({ isProduction: true, robots: on });
    expect(policy.metaRobots).toEqual({ index: true, follow: true });
    expect(policy.robotsTxt).toBe("allow");
    expect(policy.sitemapAllowed).toBe(true);
  });

  it("Production + toggle OFF fails closed: noindex + disallow-all + empty sitemap", () => {
    const policy = resolveIndexingPolicy({ isProduction: true, robots: off });
    expect(policy.metaRobots).toEqual({ index: false, follow: false });
    expect(policy.robotsTxt).toBe("disallow-all");
    expect(policy.sitemapAllowed).toBe(false);
  });

  it("Production + unset/malformed toggle fails closed", () => {
    const policy = resolveIndexingPolicy({ isProduction: true, robots: null });
    expect(policy.metaRobots).toEqual({ index: false, follow: false });
    expect(policy.robotsTxt).toBe("disallow-all");
    expect(policy.sitemapAllowed).toBe(false);
  });

  it("Production follows index/follow independently", () => {
    expect(
      resolveIndexingPolicy({ isProduction: true, robots: { index: true, follow: false } }),
    ).toEqual({
      metaRobots: { index: true, follow: false },
      robotsTxt: "allow",
      sitemapAllowed: true,
    });
    expect(
      resolveIndexingPolicy({ isProduction: true, robots: { index: false, follow: true } }),
    ).toEqual({
      metaRobots: { index: false, follow: true },
      robotsTxt: "disallow-all",
      sitemapAllowed: false,
    });
  });
});

describe("buildSeoHeaders", () => {
  const robotsTag = (entry: { headers: Array<{ key: string; value: string }> }) =>
    entry.headers.find((header) => header.key === "X-Robots-Tag")?.value;

  it("Preview build keeps the global noindex header byte-identically", () => {
    const entries = buildSeoHeaders({ VERCEL_ENV: "preview", NODE_ENV: "production" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.source).toBe("/:path*");
    expect(entries[0]?.headers).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ]);
  });

  it("unset/unknown build env fails closed to the global noindex header", () => {
    for (const env of [{}, { NODE_ENV: "development" }, { NODE_ENV: "test" }, { VERCEL_ENV: "staging" }]) {
      const entries = buildSeoHeaders(env);
      expect(entries).toHaveLength(1);
      expect(robotsTag(entries[0]!)).toBe("noindex, nofollow");
    }
  });

  it("NODE_ENV=production without VERCEL_ENV fails closed (build-time VERCEL_ENV-only rule)", () => {
    // Next forces NODE_ENV=production during every build, so NODE_ENV
    // cannot distinguish a Preview build from a production build. Only an
    // explicit VERCEL_ENV=production scopes the header.
    const entries = buildSeoHeaders({ NODE_ENV: "production" });
    expect(entries).toHaveLength(1);
    expect(robotsTag(entries[0]!)).toBe("noindex, nofollow");
    expect(isProductionBuildEnv({ NODE_ENV: "production" })).toBe(false);
    expect(isProductionBuildEnv({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionBuildEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
  });

  it("production build scopes X-Robots-Tag to private paths only", () => {
    const entries = buildSeoHeaders({ VERCEL_ENV: "production" });
    const [global, ...privates] = entries;
    expect(global?.source).toBe("/:path*");
    expect(robotsTag(global!)).toBeUndefined();
    expect(global?.headers).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ]);
    expect(privates.map((entry) => entry.source)).toEqual([...SEO_PRIVATE_HEADER_SOURCES]);
    for (const entry of privates) {
      expect(entry.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
    }
  });

  it("private header sources cover the whole private set", () => {
    expect([...SEO_PRIVATE_HEADER_SOURCES]).toEqual([
      "/admin/:path*",
      "/account/:path*",
      "/auth/:path*",
      "/cart",
      "/checkout",
      "/wishlist",
      "/track-order",
      "/motion-preview",
      "/loader-preview",
    ]);
  });
});

describe("buildSeoRedirects", () => {
  it("always keeps the legacy taxonomy redirect", () => {
    for (const env of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, {}]) {
      expect(buildSeoRedirects(env)).toContainEqual({
        source: "/admin/taxonomy",
        destination: "/admin/catalogue",
        permanent: true,
      });
    }
  });

  it("production build adds a host-scoped www-to-apex permanent redirect", () => {
    const redirects = buildSeoRedirects({ VERCEL_ENV: "production" });
    expect(redirects).toContainEqual({
      source: "/:path*",
      destination: "https://attiresarena.com/:path*",
      permanent: true,
      has: [{ type: "host", value: "www.attiresarena.com" }],
    });
  });

  it("Preview/dev/unset builds never include the www redirect", () => {
    for (const env of [{ VERCEL_ENV: "preview" }, { NODE_ENV: "development" }, {}, { VERCEL_ENV: "staging" }, { NODE_ENV: "production" }]) {
      expect(buildSeoRedirects(env)).toHaveLength(1);
    }
  });

  it("sets no trailing-slash rule", () => {
    const redirects = buildSeoRedirects({ VERCEL_ENV: "production" });
    expect(redirects.every((entry) => !entry.destination.endsWith("/"))).toBe(true);
  });
});

describe("canonical base resolution", () => {
  it("uses the stored base when it is a valid absolute http(s) URL", () => {
    expect(resolveCanonicalBase("https://shop.example.com", "https://attiresarena.com")).toBe(
      "https://shop.example.com",
    );
    expect(resolveCanonicalBase("https://shop.example.com/", "https://attiresarena.com")).toBe(
      "https://shop.example.com",
    );
    expect(resolveCanonicalBase("https://example.com/store/", "https://attiresarena.com")).toBe(
      "https://example.com/store",
    );
  });

  it("falls back to the apex base for invalid, relative, or absent values", () => {
    for (const stored of [null, "", "not a url", "/relative/path", "ftp://example.com", "https://"]) {
      expect(resolveCanonicalBase(stored, "https://attiresarena.com")).toBe("https://attiresarena.com");
    }
  });

  it("resolves from a settings record with trimming", () => {
    expect(
      resolveSeoBaseUrl({ seo_canonical_base_url: "  https://shop.example.com/ " }, "https://attiresarena.com"),
    ).toBe("https://shop.example.com");
    expect(resolveSeoBaseUrl({}, "https://attiresarena.com")).toBe("https://attiresarena.com");
    expect(resolveSeoBaseUrl(null, "https://attiresarena.com")).toBe("https://attiresarena.com");
    expect(resolveSeoBaseUrl({ seo_canonical_base_url: 42 }, "https://attiresarena.com")).toBe(
      "https://attiresarena.com",
    );
  });

  it("canonicalUrl joins base + clean path with exactly one slash and no query", () => {
    expect(canonicalUrl("https://attiresarena.com", "/shop")).toBe("https://attiresarena.com/shop");
    expect(canonicalUrl("https://attiresarena.com/", "/")).toBe("https://attiresarena.com/");
    expect(canonicalUrl("https://attiresarena.com", "shop")).toBe("https://attiresarena.com/shop");
    expect(canonicalUrl("https://attiresarena.com", "/product/aa-shirt-001")).toBe(
      "https://attiresarena.com/product/aa-shirt-001",
    );
  });

  it("canonicals never use a Preview branch URL", () => {
    // The base resolver only ever sees the stored value or the apex
    // fallback — VERCEL_BRANCH_URL is not an input anywhere in this module.
    expect(canonicalUrl(resolveCanonicalBase(null, "https://attiresarena.com"), "/shop")).not.toContain(
      "vercel.app",
    );
  });
});

describe("buildRobots", () => {
  const allow = resolveIndexingPolicy({ isProduction: true, robots: { index: true, follow: true } });
  const disallow = resolveIndexingPolicy({ isProduction: false, robots: { index: true, follow: true } });

  it("Preview + toggle ON yields Disallow:/ with no sitemap reference", () => {
    const robots = buildRobots({ policy: disallow, baseUrl: "https://attiresarena.com" });
    expect(robots.rules).toEqual({ userAgent: "*", disallow: "/" });
    expect(robots).not.toHaveProperty("sitemap");
  });

  it("production + toggle OFF yields Disallow:/ with no sitemap reference", () => {
    const policy = resolveIndexingPolicy({ isProduction: true, robots: { index: false, follow: false } });
    const robots = buildRobots({ policy, baseUrl: "https://attiresarena.com" });
    expect(robots.rules).toEqual({ userAgent: "*", disallow: "/" });
    expect(robots).not.toHaveProperty("sitemap");
  });

  it("production + toggle ON yields Allow + private disallows + sitemap ref", () => {
    const robots = buildRobots({ policy: allow, baseUrl: "https://attiresarena.com" });
    expect(robots.rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: [...SEO_PRIVATE_ROBOTS_DISALLOW],
    });
    expect(robots.sitemap).toBe("https://attiresarena.com/sitemap.xml");
  });

  it("private robots disallow set covers admin, account, auth, cart, checkout, wishlist, track-order, previews", () => {
    const joined = [...SEO_PRIVATE_ROBOTS_DISALLOW].join("\n");
    for (const path of ["/admin", "/account", "/auth", "/cart", "/checkout", "/wishlist", "/track-order", "/motion-preview", "/loader-preview"]) {
      expect(joined).toContain(path);
    }
  });
});
