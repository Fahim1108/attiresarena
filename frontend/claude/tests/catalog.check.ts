import { describe, it, expect } from "vitest";
import { canViewProductCosts } from "../src/lib/admin/authorization";
import {
  aggregateVariantStock,
  buildCategoryTree,
  categoryLevel,
  categoryLevelName,
  classifyStock,
  collectDescendantIds,
  deriveCategoryPair,
  eligibleParents,
  isCatalogStoragePath,
  isNormalizedOrder,
  isValidSlug,
  MAX_COMPRESSIBLE_IMAGE_BYTES,
  moveIdInOrder,
  parseTagsInput,
  primaryCategories,
  publicationVisibility,
  remainingImageSlots,
  secondaryCategoriesFor,
  siblingOrderGroups,
  suggestUniqueSlug,
  validCatalogImageBytes,
  validateCategoryAssignment,
  validateCategoryLevelChoice,
  validateImageCount,
  validateImageFileMeta,
  validateReorderOrder,
  validateVariantList,
  variantInputSchema,
  variantPriceErrors,
  type CategoryFlat,
} from "../src/lib/admin/catalog-variants";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
);
const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0]);
const webp = Uint8Array.from([
  ...[82, 73, 70, 70, 20, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32],
]);

describe("slug suggestions", () => {
  it("returns the base slug when free and suffixes taken slugs", () => {
    expect(suggestUniqueSlug("Cotton Shirt", new Set())).toBe("cotton-shirt");
    expect(
      suggestUniqueSlug("Cotton Shirt", ["cotton-shirt", "cotton-shirt-2"]),
    ).toBe("cotton-shirt-3");
    expect(suggestUniqueSlug("!!!", [])).toBe("product");
  });
  it("validates the database slug pattern", () => {
    expect(isValidSlug("cotton-shirt-2")).toBe(true);
    expect(isValidSlug("Cotton Shirt")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("trailing-")).toBe(false);
    expect(isValidSlug("double--hyphen")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });
});

describe("variant price validation", () => {
  it("rejects sale prices above the regular price", () => {
    expect(
      variantInputSchema.safeParse({
        size: "M",
        color: "Red",
        price_minor: 1000,
        sale_price_minor: 1200,
        cost_price_minor: null,
        stock: 1,
        active: true,
      }).success,
    ).toBe(false);
    expect(
      variantPriceErrors({
        price_minor: 1000,
        sale_price_minor: 1200,
        cost_price_minor: null,
        active: true,
      }),
    ).toContain("Sale price cannot exceed the regular price.");
  });
  it("accepts equal sale/regular prices and requires a price when active", () => {
    expect(
      variantInputSchema.safeParse({
        size: "M",
        color: "Red",
        price_minor: 1000,
        sale_price_minor: 1000,
        cost_price_minor: 400,
        stock: 1,
        active: true,
      }).success,
    ).toBe(true);
    expect(
      variantInputSchema.safeParse({
        size: "M",
        color: "Red",
        price_minor: 0,
        sale_price_minor: null,
        cost_price_minor: null,
        stock: 1,
        active: true,
      }).success,
    ).toBe(false);
    expect(
      variantInputSchema.safeParse({
        size: "M",
        color: "Red",
        price_minor: 0,
        sale_price_minor: null,
        cost_price_minor: null,
        stock: 1,
        active: false,
      }).success,
    ).toBe(true);
  });
  it("rejects placeholder sizes and negative costs", () => {
    expect(
      variantInputSchema.safeParse({
        size: "N/A",
        color: "Red",
        price_minor: 100,
        sale_price_minor: null,
        cost_price_minor: null,
        stock: 1,
        active: false,
      }).success,
    ).toBe(false);
    expect(
      variantPriceErrors({
        price_minor: 100,
        sale_price_minor: null,
        cost_price_minor: -5,
        active: false,
      }).length,
    ).toBeGreaterThan(0);
  });
  it("rejects duplicate size/color pairs and enforces the cap", () => {
    const base = {
      size: "M",
      color: "Red",
      price_minor: 100,
      sale_price_minor: null,
      cost_price_minor: null,
      stock: 1,
      active: true,
    };
    expect(validateVariantList([base, { ...base }])).toMatch(/Duplicate/);
    expect(validateVariantList([base, { ...base, size: "L" }])).toBe(null);
    const many = Array.from({ length: 101 }, (_, i) => ({
      ...base,
      size: `S${i}`,
    }));
    expect(validateVariantList(many)).toMatch(/at most 100/);
  });
});

describe("stock aggregation", () => {
  it("sums inventory, uses effective prices and flags partial data", () => {
    const aggregate = aggregateVariantStock([
      {
        price_minor: 2000,
        sale_price_minor: 1500,
        active: true,
        inventory: {
          on_hand: 10,
          reserved: 2,
          available: 8,
          low_stock_threshold: 5,
        },
      },
      {
        price_minor: 3000,
        sale_price_minor: null,
        active: true,
        inventory: {
          on_hand: 3,
          reserved: 0,
          available: 3,
          low_stock_threshold: 5,
        },
      },
      {
        price_minor: 999,
        sale_price_minor: null,
        active: false,
        inventory: null,
      },
    ]);
    expect(aggregate.onHand).toBe(13);
    expect(aggregate.reserved).toBe(2);
    expect(aggregate.available).toBe(11);
    expect(aggregate.minPriceMinor).toBe(999);
    expect(aggregate.maxPriceMinor).toBe(3000);
    expect(aggregate.hasLowVariant).toBe(true);
    expect(aggregate.partial).toBe(true);
    expect(aggregate.variantCount).toBe(3);
  });
  it("classifies in-stock, low-stock and out-of-stock", () => {
    expect(
      classifyStock({
        onHand: 10,
        reserved: 0,
        available: 10,
        minPriceMinor: 100,
        maxPriceMinor: 100,
        variantCount: 1,
        hasLowVariant: false,
        partial: false,
      }),
    ).toBe("in-stock");
    expect(
      classifyStock({
        onHand: 4,
        reserved: 0,
        available: 4,
        minPriceMinor: 100,
        maxPriceMinor: 100,
        variantCount: 1,
        hasLowVariant: false,
        partial: false,
      }),
    ).toBe("low-stock");
    expect(
      classifyStock({
        onHand: 0,
        reserved: 0,
        available: 0,
        minPriceMinor: 100,
        maxPriceMinor: 100,
        variantCount: 1,
        hasLowVariant: false,
        partial: false,
      }),
    ).toBe("out-of-stock");
  });
});

describe("reorder validation", () => {
  it("requires every id exactly once", () => {
    expect(validateReorderOrder(["a", "b"], ["a", "b"])).toBe(null);
    expect(validateReorderOrder(["a"], ["a", "b"])).toMatch(/exactly once/);
    expect(validateReorderOrder(["a", "a"], ["a", "b"])).toMatch(/duplicate/);
    expect(validateReorderOrder(["a", "c"], ["a", "b"])).toMatch(/unknown/);
  });
  it("moves ids within bounds and leaves out-of-range moves alone", () => {
    expect(moveIdInOrder(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveIdInOrder(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveIdInOrder(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveIdInOrder(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveIdInOrder(["a", "b"], "z", 1)).toEqual(["a", "b"]);
  });
});

describe("image file validation", () => {
  it("accepts real JPEG/PNG/WebP bytes and rejects spoofed MIME types", () => {
    expect(validCatalogImageBytes(png, "image/png")).toBe(true);
    expect(validCatalogImageBytes(jpeg, "image/jpeg")).toBe(true);
    expect(validCatalogImageBytes(webp, "image/webp")).toBe(true);
    expect(validCatalogImageBytes(png, "image/jpeg")).toBe(false);
    expect(validCatalogImageBytes(new Uint8Array(), "image/png")).toBe(false);
    expect(
      validCatalogImageBytes(
        new TextEncoder().encode("<svg/>"),
        "image/svg+xml",
      ),
    ).toBe(false);
  });
  it("enforces type and 5 MB size limits", () => {
    expect(validateImageFileMeta({ type: "image/png", size: 1024 })).toBe(null);
    expect(validateImageFileMeta({ type: "image/gif", size: 1024 })).toMatch(
      /JPEG, PNG and WebP/,
    );
    expect(
      validateImageFileMeta({ type: "image/jpeg", size: 5 * 1024 * 1024 + 1 }),
    ).toMatch(/5 MB/);
    expect(validateImageFileMeta({ type: "image/png", size: 0 })).toMatch(
      /empty/,
    );
  });
  it("enforces the 20-image cap", () => {
    expect(remainingImageSlots(18)).toBe(2);
    expect(remainingImageSlots(20)).toBe(0);
    expect(remainingImageSlots(25)).toBe(0);
    expect(validateImageCount(19, 1)).toBe(null);
    expect(validateImageCount(19, 2)).toMatch(/at most 20/);
    expect(validateImageCount(20, 1)).toMatch(/at most 20/);
  });
  it("allows larger originals when a compressor will shrink them", () => {
    const big = { type: "image/jpeg", size: 12 * 1024 * 1024 };
    expect(validateImageFileMeta(big)).toMatch(/5 MB/);
    expect(
      validateImageFileMeta(big, { maxBytes: MAX_COMPRESSIBLE_IMAGE_BYTES }),
    ).toBe(null);
    expect(
      validateImageFileMeta(
        { type: "image/jpeg", size: MAX_COMPRESSIBLE_IMAGE_BYTES + 1 },
        { maxBytes: MAX_COMPRESSIBLE_IMAGE_BYTES },
      ),
    ).toMatch(/20 MB/);
  });
});

describe("tags and categories", () => {
  it("parses comma-separated tags, trimming and de-duplicating", () => {
    expect(parseTagsInput("Cotton,  , summer,COTTON")).toEqual([
      "Cotton",
      "summer",
    ]);
    expect(parseTagsInput("")).toEqual([]);
  });
  it("builds trees, collects descendants and excludes ineligible parents", () => {
    const flat: CategoryFlat[] = [
      category("root", null, "Root"),
      category("child", "root", "Child"),
      category("grand", "child", "Grandchild"),
      category("other", null, "Other"),
    ];
    const tree = buildCategoryTree(flat);
    expect(tree.map((n) => n.name)).toEqual(["Root", "Other"]);
    expect(tree[0]?.children[0]?.children[0]?.name).toBe("Grandchild");
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(3);
    expect([...collectDescendantIds(flat, "root")].sort()).toEqual([
      "child",
      "grand",
    ]);
    expect(eligibleParents(flat, "child").map((c) => c.id).sort()).toEqual([
      "other",
      "root",
    ]);
    expect(eligibleParents(flat, null)).toHaveLength(4);
  });
});

describe("category hierarchy levels", () => {
  const flat: CategoryFlat[] = [
    category("root", null, "Root"),
    category("child", "root", "Child"),
    category("grand", "child", "Grandchild"),
    category("other", null, "Other"),
    category("orphan", "missing", "Orphan"),
  ];
  it("derives primary/secondary/sub-category levels from the parent chain", () => {
    expect(categoryLevel(flat, "root")).toBe(1);
    expect(categoryLevel(flat, "child")).toBe(2);
    expect(categoryLevel(flat, "grand")).toBe(3);
    expect(categoryLevel(flat, "missing")).toBe(null);
    expect(categoryLevel(flat, "orphan")).toBe(2);
    expect(categoryLevelName(1)).toBe("Primary category");
    expect(categoryLevelName(2)).toBe("Secondary category");
    expect(categoryLevelName(3)).toBe("Sub-category");
    expect(categoryLevelName(9)).toBe("Sub-category");
  });
  it("returns null for a cyclic parent chain", () => {
    const cyclic: CategoryFlat[] = [
      category("a", "b", "A"),
      category("b", "a", "B"),
    ];
    expect(categoryLevel(cyclic, "a")).toBe(null);
  });
  it("works on minimal id/parent_id nodes (form option lists)", () => {
    const nodes = [
      { id: "root", parent_id: null },
      { id: "child", parent_id: "root" },
      { id: "grand", parent_id: "child" },
    ];
    expect(categoryLevel(nodes, "grand")).toBe(3);
    expect(primaryCategories(nodes).map((c) => c.id)).toEqual(["root"]);
    expect(secondaryCategoriesFor(nodes, "root").map((c) => c.id)).toEqual([
      "child",
    ]);
    expect(validateCategoryAssignment("root", "child", nodes)).toBe(null);
    expect(validateCategoryLevelChoice("secondary", "root", nodes)).toBe(null);
  });
  it("lists primaries and secondaries of one primary", () => {
    expect(primaryCategories(flat).map((c) => c.id)).toEqual(["root", "other"]);
    expect(secondaryCategoriesFor(flat, "root").map((c) => c.id)).toEqual([
      "child",
    ]);
    expect(secondaryCategoriesFor(flat, "other")).toEqual([]);
  });
  it("validates primary + secondary product assignment", () => {
    expect(validateCategoryAssignment(null, null, flat)).toBe(null);
    expect(validateCategoryAssignment("root", null, flat)).toBe(null);
    expect(validateCategoryAssignment("root", "child", flat)).toBe(null);
    expect(validateCategoryAssignment(null, "child", flat)).toMatch(
      /primary category/,
    );
    expect(validateCategoryAssignment("other", "child", flat)).toMatch(
      /must belong/,
    );
    expect(validateCategoryAssignment("root", "grand", flat)).toMatch(
      /must belong/,
    );
    expect(validateCategoryAssignment("child", "grand", flat)).toMatch(
      /top-level/,
    );
    expect(validateCategoryAssignment("root", "missing", flat)).toMatch(
      /no longer exists/,
    );
  });
  it("validates primary/secondary/sub level choices against parents", () => {
    expect(validateCategoryLevelChoice("primary", null, flat)).toBe(null);
    expect(validateCategoryLevelChoice("primary", "root", flat)).toMatch(
      /no parent/,
    );
    expect(validateCategoryLevelChoice("secondary", "root", flat)).toBe(null);
    expect(validateCategoryLevelChoice("secondary", null, flat)).toMatch(
      /needs a primary/,
    );
    expect(validateCategoryLevelChoice("secondary", "child", flat)).toMatch(
      /must be a primary/,
    );
    expect(validateCategoryLevelChoice("sub", null, flat)).toBe(null);
    expect(validateCategoryLevelChoice("sub", "root", flat)).toBe(null);
    expect(validateCategoryLevelChoice("sub", "child", flat)).toBe(null);
    expect(validateCategoryLevelChoice("sub", "grand", flat)).toMatch(
      /another sub-category/,
    );
  });
  it("derives the form pair from a stored assignment", () => {
    expect(deriveCategoryPair(flat, null, null)).toEqual({
      primaryId: null,
      secondaryId: null,
      replacedId: null,
    });
    expect(deriveCategoryPair(flat, "root", "child")).toEqual({
      primaryId: "root",
      secondaryId: "child",
      replacedId: null,
    });
    // A depth-2 category_id survives as the secondary.
    expect(deriveCategoryPair(flat, "child", null)).toEqual({
      primaryId: "root",
      secondaryId: "child",
      replacedId: null,
    });
    // A depth-3 assignment keeps its top two links; the leaf is replaced.
    expect(deriveCategoryPair(flat, "grand", null)).toEqual({
      primaryId: "root",
      secondaryId: "child",
      replacedId: "grand",
    });
    // Inconsistent stored pairs are repaired, reporting the dropped id.
    expect(deriveCategoryPair(flat, "root", "grand")).toEqual({
      primaryId: "root",
      secondaryId: null,
      replacedId: "grand",
    });
    expect(deriveCategoryPair(flat, null, "child")).toEqual({
      primaryId: null,
      secondaryId: null,
      replacedId: "child",
    });
    expect(deriveCategoryPair(flat, "missing", null)).toEqual({
      primaryId: null,
      secondaryId: null,
      replacedId: "missing",
    });
  });
  it("groups siblings in display order for normalization", () => {
    const nodes = [
      { id: "b", parent_id: null, sort_position: 5 },
      { id: "a", parent_id: null, sort_position: 2 },
      { id: "c2", parent_id: "a", sort_position: 3 },
      { id: "c1", parent_id: "a", sort_position: 1 },
    ];
    expect(siblingOrderGroups(nodes)).toEqual([
      ["a", "b"],
      ["c1", "c2"],
    ]);
    expect(siblingOrderGroups([])).toEqual([]);
    expect(isNormalizedOrder(nodes, ["a", "b"])).toBe(false);
    expect(
      isNormalizedOrder(
        [
          { id: "a", parent_id: null, sort_position: 0 },
          { id: "b", parent_id: null, sort_position: 1 },
        ],
        ["a", "b"],
      ),
    ).toBe(true);
  });
});

describe("publication visibility and cost visibility", () => {
  it("requires both publication signals for storefront visibility", () => {
    expect(publicationVisibility("published", true)).toBe("visible");
    expect(publicationVisibility("published", false)).toBe("hidden");
    expect(publicationVisibility("archived", false)).toBe("hidden");
    expect(publicationVisibility("archived", true)).toBe("paused");
    expect(publicationVisibility("draft", true)).toBe("paused");
  });
  it("shows costs only to cost-viewing roles, never to moderators alone", () => {
    // Single rule lives in authorization.ts and matches the database
    // costs.read permission's union semantics: any cost-viewing role
    // grants visibility, so a combined owner+moderator session may view
    // costs (the database has_permission check agrees).
    expect(canViewProductCosts({ roles: ["owner"] })).toBe(true);
    expect(canViewProductCosts({ roles: ["product_manager"] })).toBe(true);
    expect(canViewProductCosts({ roles: ["admin"] })).toBe(true);
    expect(canViewProductCosts({ roles: ["owner", "analyst"] })).toBe(true);
    expect(canViewProductCosts({ roles: ["owner", "moderator"] })).toBe(true);
    expect(canViewProductCosts({ roles: ["analyst"] })).toBe(false);
    expect(canViewProductCosts({ roles: ["order_manager"] })).toBe(false);
    expect(canViewProductCosts({ roles: ["moderator"] })).toBe(false);
    expect(canViewProductCosts({ roles: ["editor"] })).toBe(false);
    expect(canViewProductCosts({ roles: [] })).toBe(false);
  });
  it("validates catalog storage paths", () => {
    const good =
      "55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666.webp";
    expect(isCatalogStoragePath(good)).toBe(true);
    expect(isCatalogStoragePath("/inventory/x.jpg")).toBe(false);
    expect(isCatalogStoragePath("a/b.gif")).toBe(false);
    expect(isCatalogStoragePath("../escape.jpg")).toBe(false);
    expect(isCatalogStoragePath("")).toBe(false);
  });
});

function category(
  id: string,
  parent_id: string | null,
  name: string,
): CategoryFlat {
  return {
    id,
    parent_id,
    name,
    slug: name.toLowerCase(),
    published: true,
    description: "",
    image_storage_path: null,
    banner_storage_path: null,
    seo_title: null,
    seo_description: null,
    sort_position: 0,
    updated_at: "2026-11-15T00:00:00.000Z",
  };
}
