import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  AI_SEARCH_BOT_USER_AGENTS,
  buildLlmsTxt,
  buildRobots,
  buildSitemapEntries,
  LLMS_TXT_OFF_TEXT,
  organizationJsonLd,
  resolveIndexingPolicy,
  SEO_PRIVATE_ROBOTS_DISALLOW,
} from "../src/lib/seo";
import {
  SEO_EXTENDED_SCHEMA,
  SETTING_KEYS,
  isSettingKey,
} from "../src/lib/admin/settings-shared";
import {
  resolveSeoDefaultDescription,
  resolveSeoDefaultTitle,
} from "../src/lib/store-settings";
import { site } from "../src/config/brand";
import { faqs } from "../src/content/policies";
import { DIVISIONS } from "../src/data/bangladesh";

/**
 * SEO follow-ups (M-A, M-B, AI-search readiness). Pure-builder and schema
 * tests plus source guards for the save/form wiring, mirroring
 * seo-pages.check.ts: importing the admin server actions would drag in
 * the whole server tree, so the save path is pinned in source.
 */

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function validExtendedSeo(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    seo_keywords: "",
    seo_og_title: "",
    seo_og_description: "",
    seo_og_image_url: "",
    seo_twitter_card: "summary_large_image",
    seo_canonical_base_url: "",
    seo_robots: { index: false, follow: false },
    seo_sitemap: {
      includeShop: false,
      includeCategories: false,
      includePolicies: false,
      includeProducts: false,
    },
    google_search_console_verification: "",
    ...overrides,
  };
}

describe("sitemap lastModified prefers updated_at (M-A)", () => {
  const toggles = {
    includeShop: true,
    includeCategories: true,
    includePolicies: true,
    includeProducts: true,
  };

  it("uses updated_at for products when parsable, else the creation date", () => {
    const entries = buildSitemapEntries({
      baseUrl: "https://attiresarena.com",
      toggles,
      products: [
        {
          slug: "fresh-shirt",
          createdAt: "2026-11-15T00:00:00.000Z",
          updatedAt: "2026-11-18T10:00:00.000Z",
        },
        {
          slug: "old-shirt",
          createdAt: "2026-11-15T00:00:00.000Z",
        },
      ],
      categories: [],
      policySlugs: [],
    });
    const fresh = entries.find(
      (entry) => entry.url === "https://attiresarena.com/product/fresh-shirt",
    );
    const old = entries.find(
      (entry) => entry.url === "https://attiresarena.com/product/old-shirt",
    );
    expect(fresh?.lastModified).toBe("2026-11-18T10:00:00.000Z");
    expect(old?.lastModified).toBe("2026-11-15T00:00:00.000Z");
  });

  it("falls back to the creation date for a malformed updated_at, and omits lastModified when neither parses", () => {
    const entries = buildSitemapEntries({
      baseUrl: "https://attiresarena.com",
      toggles,
      products: [
        {
          slug: "weird-shirt",
          createdAt: "2026-11-15T00:00:00.000Z",
          updatedAt: "not-a-date",
        },
        { slug: "dateless-shirt", createdAt: "not-a-date" },
      ],
      categories: [],
      policySlugs: [],
    });
    expect(
      entries.find(
        (entry) => entry.url === "https://attiresarena.com/product/weird-shirt",
      )?.lastModified,
    ).toBe("2026-11-15T00:00:00.000Z");
    expect(
      entries.find(
        (entry) =>
          entry.url === "https://attiresarena.com/product/dateless-shirt",
      )?.lastModified,
    ).toBeUndefined();
  });

  it("uses updated_at for categories when present, else omits lastModified", () => {
    const entries = buildSitemapEntries({
      baseUrl: "https://attiresarena.com",
      toggles,
      products: [],
      categories: [
        { slug: "shirts", available: true, updatedAt: "2026-11-18T10:00:00.000Z" },
        { slug: "pants", available: true },
      ],
      policySlugs: [],
    });
    expect(
      entries.find(
        (entry) => entry.url === "https://attiresarena.com/category/shirts",
      )?.lastModified,
    ).toBe("2026-11-18T10:00:00.000Z");
    expect(
      entries.find(
        (entry) => entry.url === "https://attiresarena.com/category/pants",
      )?.lastModified,
    ).toBeUndefined();
  });
});

describe("Search Console verification save path (M-B)", () => {
  it("is a recognised setting key", () => {
    expect(
      (SETTING_KEYS as readonly string[]).includes(
        "google_search_console_verification",
      ),
    ).toBe(true);
    expect(isSettingKey("google_search_console_verification")).toBe(true);
  });

  it("accepts a valid token through the extended-SEO schema", () => {
    const parsed = SEO_EXTENDED_SCHEMA.safeParse(
      validExtendedSeo({
        google_search_console_verification: "dBw5X7aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890",
      }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.google_search_console_verification).toBe(
        "dBw5X7aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890",
      );
    }
  });

  it("accepts an empty token (clears the stored value)", () => {
    const parsed = SEO_EXTENDED_SCHEMA.safeParse(validExtendedSeo());
    expect(parsed.success).toBe(true);
  });

  it("rejects tokens with whitespace, markup, or over 500 chars — the same rules as the render path", () => {
    for (const bad of [
      "token with spaces",
      "token\nnewline",
      "<script>alert(1)</script>",
      'quote"token',
      "x".repeat(501),
    ]) {
      const parsed = SEO_EXTENDED_SCHEMA.safeParse(
        validExtendedSeo({ google_search_console_verification: bad }),
      );
      expect(parsed.success).toBe(false);
    }
    // Exactly 500 chars is still legal (same cap as parseGoogleVerification).
    expect(
      SEO_EXTENDED_SCHEMA.safeParse(
        validExtendedSeo({ google_search_console_verification: "x".repeat(500) }),
      ).success,
    ).toBe(true);
  });

  it("saveSeoExtendedSettings parses and saves the key (source guard)", () => {
    const src = read("../src/lib/admin/settings.ts");
    const start = src.indexOf("export async function saveSeoExtendedSettings");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start);
    expect(body).toContain("google_search_console_verification: formText(");
    expect(body).toContain('"google_search_console_verification",');
    expect(body).toContain("parsed.data.google_search_console_verification");
  });

  it("the extended SEO form carries the verification field (source guard)", () => {
    const src = read("../src/components/admin/marketing/forms.tsx");
    expect(src).toContain('name="google_search_console_verification"');
    expect(src).toContain(
      'defaultValue={settingString(settings, "google_search_console_verification")}',
    );
    expect(src).toContain("google-site-verification");
  });
});

describe("AI-crawler robots.txt group", () => {
  it("lists exactly the verified AI tokens — no invented bot names", () => {
    expect([...AI_SEARCH_BOT_USER_AGENTS]).toEqual([
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "Claude-SearchBot",
      "Claude-User",
      "PerplexityBot",
      "Perplexity-User",
      "Google-Extended",
      "Applebot-Extended",
      "CCBot",
      "meta-externalagent",
      "Meta-WebIndexer",
      "meta-externalfetcher",
    ]);
  });

  it("production + toggle ON adds an AI group with Allow and the SAME private disallows", () => {
    const robots = buildRobots({
      policy: resolveIndexingPolicy({
        isProduction: true,
        robots: { index: true, follow: true },
      }),
      baseUrl: "https://attiresarena.com",
    });
    expect(Array.isArray(robots.rules)).toBe(true);
    const rules = robots.rules as Array<{
      userAgent: string | string[];
      allow?: string;
      disallow?: string | string[];
    }>;
    expect(rules).toHaveLength(2);
    expect(rules[0]?.userAgent).toBe("*");
    expect(rules[0]?.allow).toBe("/");
    const ai = rules[1];
    expect(ai?.userAgent).toEqual([...AI_SEARCH_BOT_USER_AGENTS]);
    expect(ai?.allow).toBe("/");
    // The AI group MUST repeat the private disallows: a bot matching
    // its own group uses only that group's rules, so an Allow-only AI
    // group would accidentally open /admin etc. to AI crawlers.
    expect(ai?.disallow).toEqual([...SEO_PRIVATE_ROBOTS_DISALLOW]);
    expect(robots.sitemap).toBe("https://attiresarena.com/sitemap.xml");
  });

  it("disallow-all stays a single group covering AI bots too (no AI carve-out)", () => {
    for (const policy of [
      resolveIndexingPolicy({ isProduction: false, robots: { index: true, follow: true } }),
      resolveIndexingPolicy({ isProduction: true, robots: { index: false, follow: false } }),
    ]) {
      const robots = buildRobots({ policy, baseUrl: "https://attiresarena.com" });
      expect(robots.rules).toEqual({ userAgent: "*", disallow: "/" });
      expect(robots).not.toHaveProperty("sitemap");
    }
  });
});

describe("llms.txt builder", () => {
  const products = [
    {
      slug: "casual-shirt",
      name: "Casual shirt",
      price: 450,
      description: "A relaxed everyday shirt.",
    },
    {
      slug: "aa-shirt-001",
      name: "Fixture shirt",
      price: 550,
      description: "Design-review copy.",
      reviewOnly: true,
    },
  ];
  const categories = [
    { slug: "shirts", name: "Shirts", available: true },
    { slug: "pants", name: "Pants", available: false },
  ];

  it("minimal response when indexing is off: store name + statement, no links, no products", () => {
    const text = buildLlmsTxt({
      baseUrl: "https://attiresarena.com",
      allowed: false,
      products,
      categories,
    });
    expect(text).toBe(LLMS_TXT_OFF_TEXT);
    expect(text).toContain("Attires Arena");
    expect(text).toContain("Search indexing is off");
    expect(text).not.toContain("http");
    expect(text).not.toContain("Casual shirt");
  });

  it("lists real products and available categories only, on the apex base, with BDT prices", () => {
    const text = buildLlmsTxt({
      baseUrl: "https://attiresarena.com",
      allowed: true,
      products,
      categories,
    });
    expect(text).toContain("# Attires Arena");
    expect(text).toContain(
      "> Best thrift collection in Bangladesh. Individual thrift shirts at reasonable prices, delivered across Bangladesh.",
    );
    expect(text).toContain(
      "Delivery is available across Bangladesh, including Barishal division, with Cash on Delivery.",
    );
    expect(text).toContain("- [Home](https://attiresarena.com/)");
    expect(text).toContain("- [Shop](https://attiresarena.com/shop)");
    expect(text).toContain("- [Shirts](https://attiresarena.com/category/shirts)");
    expect(text).toContain(
      "- [Casual shirt](https://attiresarena.com/product/casual-shirt) — BDT 450",
    );
    // Fixtures and coming-soon categories are never advertised.
    expect(text).not.toContain("aa-shirt-001");
    expect(text).not.toContain("Fixture shirt");
    expect(text).not.toContain("/category/pants");
    // No invented copy: the brand.ts default description never appears.
    expect(text).not.toContain("Premium menswear");
    // No Preview branch URL can occur (same apex rule as canonicals).
    expect(text).not.toContain("vercel.app");
  });

  it("full variant adds real product descriptions and nothing else new", () => {
    const summary = buildLlmsTxt({
      baseUrl: "https://attiresarena.com",
      allowed: true,
      products,
      categories,
    });
    const full = buildLlmsTxt({
      baseUrl: "https://attiresarena.com",
      allowed: true,
      products,
      categories,
      full: true,
    });
    expect(summary).not.toContain("A relaxed everyday shirt.");
    expect(full).toContain("  A relaxed everyday shirt.");
    expect(full).not.toContain("Design-review copy.");
  });

  it("includeProducts off lists no products but keeps categories (review fix S1)", () => {
    const text = buildLlmsTxt({
      baseUrl: "https://attiresarena.com",
      allowed: true,
      products,
      categories,
      includeProducts: false,
    });
    expect(text).not.toContain("## Products");
    expect(text).not.toContain("Casual shirt");
    expect(text).not.toContain("/product/casual-shirt");
    expect(text).toContain("## Categories");
    expect(text).toContain("- [Shirts](https://attiresarena.com/category/shirts)");
  });

  it("includeCategories off lists no categories but keeps products (review fix S1)", () => {
    const text = buildLlmsTxt({
      baseUrl: "https://attiresarena.com",
      allowed: true,
      products,
      categories,
      includeCategories: false,
    });
    expect(text).not.toContain("## Categories");
    expect(text).not.toContain("/category/shirts");
    expect(text).toContain("## Products");
    expect(text).toContain(
      "- [Casual shirt](https://attiresarena.com/product/casual-shirt) — BDT 450",
    );
  });

  it("both toggles off lists neither section but keeps the pages", () => {
    const text = buildLlmsTxt({
      baseUrl: "https://attiresarena.com",
      allowed: true,
      products,
      categories,
      includeProducts: false,
      includeCategories: false,
    });
    expect(text).not.toContain("## Products");
    expect(text).not.toContain("## Categories");
    expect(text).not.toContain("Casual shirt");
    expect(text).not.toContain("/category/shirts");
    expect(text).toContain("- [Home](https://attiresarena.com/)");
  });
});

describe("Organization JSON-LD description (AI-search completeness)", () => {
  it("omits description when no stored default exists", () => {
    expect(
      organizationJsonLd({
        name: "Attires Arena",
        url: "https://attiresarena.com/",
        logoUrl: "https://attiresarena.com/brand/logo-maroon.png",
        sameAs: [],
      }),
    ).not.toHaveProperty("description");
  });

  it("emits a stored default description and keeps sameAs", () => {
    const data = organizationJsonLd({
      name: "Attires Arena",
      url: "https://attiresarena.com/",
      logoUrl: "https://attiresarena.com/brand/logo-maroon.png",
      sameAs: ["https://www.facebook.com/attiresarena"],
      description: "Individual thrift shirts in Bangladesh.",
    });
    expect(data.description).toBe("Individual thrift shirts in Bangladesh.");
    expect(data.sameAs).toEqual(["https://www.facebook.com/attiresarena"]);
  });
});

describe("llms.txt route wiring (source guards)", () => {
  it("both llms routes are force-dynamic and gate on the environment before any feed read", () => {
    for (const path of ["../src/app/llms.txt/route.ts", "../src/app/llms-full.txt/route.ts"]) {
      const src = read(path);
      expect(src).toContain('export const dynamic = "force-dynamic"');
      expect(src).toContain("llmsResponse(");
    }
    const loader = read("../src/lib/llms.ts");
    // Gate ordering is asserted inside the loader function body only
    // (the import block at the top of the file names the same tokens).
    const body = loader.slice(loader.indexOf("async function loadLlmsText"));
    const gate = body.indexOf("if (!isProductionStorefront())");
    expect(gate).toBeGreaterThan(0);
    for (const token of ["browsableShirts(", "getCategories()", "resolveIndexingPolicy", "buildLlmsTxt"]) {
      expect(body.indexOf(token)).toBeGreaterThan(gate);
    }
    expect(body).toContain("browsableShirts({ liveReview: false })");
    // Review fix S1: the loader reads the sitemap toggles (same keys
    // as src/app/sitemap.ts) and passes them into buildLlmsTxt, so an
    // owner-off toggle omits that section from llms.txt too.
    expect(body).toContain('parseSeoSitemap(content?.settings?.["seo_sitemap"])');
    expect(body).toContain("includeProducts: toggles?.includeProducts ?? false");
    expect(body).toContain("includeCategories: toggles?.includeCategories ?? false");
    expect(loader).toContain("export async function llmsResponse");
  });
});

describe("owner target search phrases (Fahim, 2026-11-19)", () => {
  it("home default title keeps the live wording (Fahim's call, 2026-11-20)", () => {
    expect(resolveSeoDefaultTitle("Attires Arena", null)).toBe(
      "Attires Arena — Thrift Shirts in Bangladesh",
    );
    expect(resolveSeoDefaultTitle("Attires Arena", { seo_default_title: "Custom" })).toBe("Custom");
  });

  it("site description carries the phrases and drops the old menswear line", () => {
    expect(site.description).toBe(
      "Best thrift collection in Bangladesh — individual thrift shirts at reasonable prices, delivered across Bangladesh.",
    );
    expect(site.description).not.toContain("Premium menswear");
    expect(resolveSeoDefaultDescription(site.description, null)).toBe(site.description);
  });

  it("FAQ answers the three intents factually — 'best' lives in the question only", () => {
    const all = faqs.flatMap((group) => group.items);
    expect(all).toHaveLength(11);
    const find = (q: string) => all.find((item) => item.q === q)?.a ?? "";
    const collection = find("Where can I find the best thrift collection in Bangladesh?");
    expect(collection).toContain("individual thrift shirts, carefully selected");
    expect(collection).toContain("Cash on Delivery");
    const price = find("How much do thrift shirts cost?");
    expect(price).toContain("৳450");
    expect(price).toContain("৳499");
    const barishal = find("Can I order a thrift shirt in Barishal?");
    expect(barishal).toContain("We deliver across Bangladesh");
    expect(barishal).toContain("3–5 working days");
    expect(barishal).toContain("৳130");
    // No answer asserts "best" as a verified fact; the word appears
    // only in the collection question targeting the search intent.
    for (const answer of [collection, price, barishal]) {
      expect(answer.toLowerCase()).not.toContain("best");
    }
    // No answer claims a Barishal shop or store location.
    for (const answer of [collection, price, barishal]) {
      expect(answer.toLowerCase()).not.toContain("our barishal store");
      expect(answer.toLowerCase()).not.toContain("shop in barishal");
    }
  });

  it("every Barishal district named in the FAQ answer is in the real checkout address data", () => {
    const all = faqs.flatMap((group) => group.items);
    const barishal = all.find(
      (item) => item.q === "Can I order a thrift shirt in Barishal?",
    )?.a ?? "";
    // The answer must name exactly the division's districts from
    // src/data/bangladesh.ts — nothing invented, nothing missing.
    const barishalDistricts = DIVISIONS.Barishal ?? [];
    expect(barishalDistricts).toHaveLength(6);
    for (const district of barishalDistricts) {
      expect(barishal).toContain(district);
    }
  });

  it("Organization JSON-LD falls back to the owner-approved site description (source guard)", () => {
    const src = read("../src/components/seo/JsonLd.tsx");
    expect(src).toContain('?? site.description');
  });
});
