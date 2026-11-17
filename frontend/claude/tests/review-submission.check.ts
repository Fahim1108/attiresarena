import { describe, expect, it, vi, afterEach } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { customerReviewSchema } from "@/lib/customer/validation";
import {
  REVIEW_SIGN_IN_EXPIRED_MESSAGE,
  projectOwnReview,
  readOwnReview,
  submitCustomerReview,
} from "@/lib/customer/reviews";
import type { CustomerClient } from "@/lib/customer/supabase";
import { productJsonLd } from "@/lib/seo";
import {
  clearReviewDraft,
  parseReviewDraft,
  readReviewDraft,
  reviewDraftKey,
  tabSessionStorage,
  writeReviewDraft,
} from "@/lib/review-draft-storage";
import { approvedReviews } from "@/services/adapters/published-thrift";
import { dataSource } from "@/services/adapters";

/**
 * Review submission (customer write + own-review read + approved
 * read + moderation queue contracts). No live Supabase calls: RPCs
 * are faked, PostgREST reads are fetch-stubbed, and UI/source rules
 * are pinned with source guards. No DOM rendering (no Testing
 * Library in dependencies).
 */

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const REVIEW_ID = "33333333-3333-4333-8333-333333333333";
const VARIANT_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";
const MEDIA_PATH =
  "55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666.jpg";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(TESTS_DIR, "..", "src");
const MIGRATION_PATH = join(
  TESTS_DIR,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20261117000100_product_reviews_submission.sql",
);

async function readSrc(relative: string): Promise<string> {
  return readFile(join(SRC_DIR, relative), "utf8");
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    productId: PRODUCT_ID,
    rating: 5,
    title: "Great shirt",
    body: "Fits well and the fabric feels great.",
    ...overrides,
  };
}

describe("customerReviewSchema bounds (mirror the DB CHECKs)", () => {
  it("accepts ratings 1 and 5, rejects 0, 6, non-integers, and strings", () => {
    expect(customerReviewSchema.safeParse(validInput({ rating: 1 })).success).toBe(true);
    expect(customerReviewSchema.safeParse(validInput({ rating: 5 })).success).toBe(true);
    expect(customerReviewSchema.safeParse(validInput({ rating: 0 })).success).toBe(false);
    expect(customerReviewSchema.safeParse(validInput({ rating: 6 })).success).toBe(false);
    expect(customerReviewSchema.safeParse(validInput({ rating: 4.5 })).success).toBe(false);
    expect(customerReviewSchema.safeParse(validInput({ rating: "5" })).success).toBe(false);
  });

  it("trims the body and enforces 10–3000 characters", () => {
    expect(customerReviewSchema.safeParse(validInput({ body: "123456789" })).success).toBe(false);
    const ten = customerReviewSchema.safeParse(validInput({ body: "1234567890" }));
    expect(ten.success).toBe(true);
    expect(customerReviewSchema.safeParse(validInput({ body: "x".repeat(3000) })).success).toBe(true);
    expect(customerReviewSchema.safeParse(validInput({ body: "x".repeat(3001) })).success).toBe(false);
    const padded = customerReviewSchema.safeParse(validInput({ body: "   1234567890   " }));
    expect(padded.success).toBe(true);
    if (padded.success) expect(padded.data.body).toBe("1234567890");
  });

  it("caps the title at 160 characters and allows an empty or absent title", () => {
    expect(customerReviewSchema.safeParse(validInput({ title: "x".repeat(160) })).success).toBe(true);
    expect(customerReviewSchema.safeParse(validInput({ title: "x".repeat(161) })).success).toBe(false);
    expect(customerReviewSchema.safeParse(validInput({ title: "" })).success).toBe(true);
    const { productId, rating, body } = validInput();
    const parsed = customerReviewSchema.safeParse({ productId, rating, body });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.title).toBe("");
  });

  it("rejects a non-UUID product id", () => {
    expect(customerReviewSchema.safeParse(validInput({ productId: "p001" })).success).toBe(false);
    expect(customerReviewSchema.safeParse(validInput({ productId: "" })).success).toBe(false);
  });
});

describe("own-review row projector", () => {
  const fullRow = {
    id: REVIEW_ID,
    rating: 4,
    title: "Good",
    body: "A solid thrift find, as described.",
    status: "pending",
    verified_purchase: true,
    created_at: "2026-11-16T10:00:00.000Z",
    updated_at: "2026-11-16T11:00:00.000Z",
  };

  it("projects a full post-migration row", () => {
    expect(projectOwnReview(fullRow)).toEqual({
      id: REVIEW_ID,
      rating: 4,
      title: "Good",
      body: "A solid thrift find, as described.",
      status: "pending",
      verifiedPurchase: true,
      createdAt: "2026-11-16T10:00:00.000Z",
      updatedAt: "2026-11-16T11:00:00.000Z",
    });
  });

  it("projects a pre-migration row with the badge defaulting to false", () => {
    const legacy = {
      id: fullRow.id,
      rating: fullRow.rating,
      title: fullRow.title,
      body: fullRow.body,
      status: fullRow.status,
      created_at: fullRow.created_at,
    };
    expect(projectOwnReview(legacy)).toEqual({
      id: REVIEW_ID,
      rating: 4,
      title: "Good",
      body: "A solid thrift find, as described.",
      status: "pending",
      verifiedPurchase: false,
      createdAt: "2026-11-16T10:00:00.000Z",
      updatedAt: null,
    });
  });

  it("rejects bad ratings, bad statuses, bad ids, and missing timestamps", () => {
    expect(projectOwnReview({ ...fullRow, rating: 0 })).toBeNull();
    expect(projectOwnReview({ ...fullRow, rating: 6 })).toBeNull();
    expect(projectOwnReview({ ...fullRow, status: "draft" })).toBeNull();
    expect(projectOwnReview({ ...fullRow, id: "not-a-uuid" })).toBeNull();
    const noCreated = {
      id: fullRow.id,
      rating: fullRow.rating,
      title: fullRow.title,
      body: fullRow.body,
      status: fullRow.status,
      verified_purchase: fullRow.verified_purchase,
      updated_at: fullRow.updated_at,
    };
    expect(projectOwnReview(noCreated)).toBeNull();
    expect(projectOwnReview(null)).toBeNull();
  });
});

describe("submitCustomerReview RPC error mapping (never leaks DB text)", () => {
  function rpcClient(result: { data: unknown; error: unknown }) {
    return {
      rpc: async () => result,
    } as unknown as CustomerClient;
  }

  it("returns the review id on success with the pending message", async () => {
    const result = await submitCustomerReview(
      rpcClient({ data: REVIEW_ID, error: null }),
      validInput(),
    );
    expect(result).toEqual({
      ok: true,
      data: { reviewId: REVIEW_ID },
      message: expect.stringContaining("awaiting approval"),
    });
  });

  it("maps 42501 to the sign-in-expired message the form matches on", async () => {
    const result = await submitCustomerReview(
      rpcClient({ data: null, error: { code: "42501", message: "db internals must not leak" } }),
      validInput(),
    );
    expect(result).toEqual({
      ok: false,
      reason: "error",
      message: REVIEW_SIGN_IN_EXPIRED_MESSAGE,
    });
  });

  it("maps 54000 to a rate-limit message", async () => {
    const result = await submitCustomerReview(
      rpcClient({ data: null, error: { code: "54000", message: "secret" } }),
      validInput(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("recently");
      expect(result.message).not.toContain("secret");
    }
  });

  it("maps 22023 to validation and 23505 to the already-reviewed message", async () => {
    const invalid = await submitCustomerReview(
      rpcClient({ data: null, error: { code: "22023", message: "secret" } }),
      validInput(),
    );
    expect(invalid).toMatchObject({ ok: false, reason: "validation" });
    const duplicate = await submitCustomerReview(
      rpcClient({ data: null, error: { code: "23505", message: "secret" } }),
      validInput(),
    );
    expect(duplicate).toMatchObject({ ok: false, reason: "validation" });
    if (!duplicate.ok) expect(duplicate.message).toContain("already reviewed");
  });

  it("maps unknown errors and malformed ids to a generic message", async () => {
    const failed = await submitCustomerReview(
      rpcClient({ data: null, error: { code: "XX000", message: "secret" } }),
      validInput(),
    );
    expect(failed).toMatchObject({ ok: false, reason: "error" });
    if (!failed.ok) expect(failed.message).not.toContain("secret");
    const malformed = await submitCustomerReview(
      rpcClient({ data: "not-a-uuid", error: null }),
      validInput(),
    );
    expect(malformed.ok).toBe(false);
  });

  it("calls the RPC with the existing argument names", async () => {
    const calls: unknown[] = [];
    const client = {
      rpc: async (...args: unknown[]) => {
        calls.push(args);
        return { data: REVIEW_ID, error: null };
      },
    } as unknown as CustomerClient;
    await submitCustomerReview(client, validInput());
    expect(calls).toEqual([
      [
        "submit_product_review",
        {
          target_product: PRODUCT_ID,
          stars: 5,
          review_body: "Fits well and the fabric feels great.",
          review_title: "Great shirt",
        },
      ],
    ]);
  });
});

describe("readOwnReview RPC read (M1: scoped by the RPC, no table select)", () => {
  function rpcClient(
    handler: (name: string, args: unknown) => { data: unknown; error: unknown },
  ) {
    const calls: Array<{ name: string; args: unknown }> = [];
    const client = {
      // Any direct table read is a regression (M1): the fake throws so
      // the test fails loudly instead of passing against a query the
      // database would deny or mis-scope.
      from() {
        throw new Error("readOwnReview must not read product_reviews directly");
      },
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return handler(name, args);
      },
    } as unknown as CustomerClient;
    return { client, calls };
  }

  const ownRow = {
    id: REVIEW_ID,
    rating: 5,
    title: "Great",
    body: "Fits well and the fabric feels great.",
    status: "approved",
    verified_purchase: true,
    created_at: "2026-11-16T10:00:00.000Z",
    updated_at: "2026-11-16T11:00:00.000Z",
  };

  it("calls the own-review RPC once with the product id and projects the row", async () => {
    const { client, calls } = rpcClient(() => ({ data: [ownRow], error: null }));
    const own = await readOwnReview(client, PRODUCT_ID);
    expect(own).toEqual({
      id: REVIEW_ID,
      rating: 5,
      title: "Great",
      body: "Fits well and the fabric feels great.",
      status: "approved",
      verifiedPurchase: true,
      createdAt: "2026-11-16T10:00:00.000Z",
      updatedAt: "2026-11-16T11:00:00.000Z",
    });
    expect(calls).toEqual([
      { name: "read_own_product_review", args: { target_product: PRODUCT_ID } },
    ]);
  });

  it("returns null for an empty result with exactly one call (no retry, no fallback select)", async () => {
    const { client, calls } = rpcClient(() => ({ data: [], error: null }));
    expect(await readOwnReview(client, PRODUCT_ID)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("returns null when the RPC errors (missing pre-migration, or sign-in expired)", async () => {
    const missing = rpcClient(() => ({
      data: null,
      error: { code: "42883", message: "function does not exist" },
    }));
    expect(await readOwnReview(missing.client, PRODUCT_ID)).toBeNull();
    expect(missing.calls).toHaveLength(1);
    const expired = rpcClient(() => ({
      data: null,
      error: { code: "42501", message: "sign in" },
    }));
    expect(await readOwnReview(expired.client, PRODUCT_ID)).toBeNull();
  });

  it("returns null for a malformed row or a non-array result", async () => {
    const malformed = rpcClient(() => ({
      data: [{ ...ownRow, rating: 9 }],
      error: null,
    }));
    expect(await readOwnReview(malformed.client, PRODUCT_ID)).toBeNull();
    const notArray = rpcClient(() => ({ data: ownRow, error: null }));
    expect(await readOwnReview(notArray.client, PRODUCT_ID)).toBeNull();
  });

  it("returns null for a non-UUID product id without calling the RPC", async () => {
    const { client, calls } = rpcClient(() => ({ data: [ownRow], error: null }));
    expect(await readOwnReview(client, "p001")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("review draft sessionStorage persistence (S1)", () => {
  function memoryStore() {
    const map = new Map<string, string>();
    const store = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    };
    return { map, store };
  }

  const draft = {
    rating: 4,
    title: "Almost done",
    body: "A solid thrift find, as described.",
  };
  const OTHER_PRODUCT = "99999999-9999-4999-8999-999999999999";

  it("keys drafts by product id", () => {
    expect(reviewDraftKey(PRODUCT_ID)).toContain(PRODUCT_ID);
    expect(reviewDraftKey(PRODUCT_ID)).not.toBe(reviewDraftKey(OTHER_PRODUCT));
  });

  it("round-trips a draft and stores rating + title + body only", () => {
    const { map, store } = memoryStore();
    writeReviewDraft(store, PRODUCT_ID, draft);
    expect(readReviewDraft(store, PRODUCT_ID)).toEqual(draft);
    const raw = map.get(reviewDraftKey(PRODUCT_ID));
    expect(raw).toBeDefined();
    expect(Object.keys(JSON.parse(raw ?? "{}")).sort()).toEqual([
      "body",
      "rating",
      "title",
    ]);
  });

  it("keeps drafts for different products apart", () => {
    const { store } = memoryStore();
    writeReviewDraft(store, PRODUCT_ID, draft);
    expect(readReviewDraft(store, OTHER_PRODUCT)).toBeNull();
    writeReviewDraft(store, OTHER_PRODUCT, {
      rating: 5,
      title: "Other",
      body: "Another review body here.",
    });
    expect(readReviewDraft(store, PRODUCT_ID)).toEqual(draft);
  });

  it("clear drops the persisted draft", () => {
    const { store } = memoryStore();
    writeReviewDraft(store, PRODUCT_ID, draft);
    clearReviewDraft(store, PRODUCT_ID);
    expect(readReviewDraft(store, PRODUCT_ID)).toBeNull();
  });

  it("rejects malformed, mistyped, and out-of-range stored drafts", () => {
    expect(parseReviewDraft(null)).toBeNull();
    expect(parseReviewDraft("")).toBeNull();
    expect(parseReviewDraft("not json")).toBeNull();
    expect(parseReviewDraft("[1,2]")).toBeNull();
    expect(parseReviewDraft(JSON.stringify({ ...draft, rating: 6 }))).toBeNull();
    expect(parseReviewDraft(JSON.stringify({ ...draft, rating: -1 }))).toBeNull();
    expect(parseReviewDraft(JSON.stringify({ ...draft, rating: 4.5 }))).toBeNull();
    expect(parseReviewDraft(JSON.stringify({ ...draft, rating: "4" }))).toBeNull();
    expect(parseReviewDraft(
      JSON.stringify({ ...draft, title: "x".repeat(161) }),
    )).toBeNull();
    expect(parseReviewDraft(
      JSON.stringify({ ...draft, body: "x".repeat(3001) }),
    )).toBeNull();
    expect(parseReviewDraft(JSON.stringify({ ...draft, body: 42 }))).toBeNull();
    // A draft with no rating yet (0) is valid: the user may not have
    // chosen stars before navigating away.
    expect(parseReviewDraft(JSON.stringify({ ...draft, rating: 0 }))).toEqual({
      ...draft,
      rating: 0,
    });
  });

  it("never throws on a missing store or a throwing store", () => {
    expect(readReviewDraft(null, PRODUCT_ID)).toBeNull();
    expect(readReviewDraft(undefined, PRODUCT_ID)).toBeNull();
    const throwing = {
      getItem: (): string | null => {
        throw new Error("private mode");
      },
      setItem: (): void => {
        throw new Error("quota");
      },
      removeItem: (): void => {
        throw new Error("private mode");
      },
    };
    expect(readReviewDraft(throwing, PRODUCT_ID)).toBeNull();
    expect(() => writeReviewDraft(throwing, PRODUCT_ID, draft)).not.toThrow();
    expect(() => clearReviewDraft(throwing, PRODUCT_ID)).not.toThrow();
  });

  it("has no sessionStorage outside the browser and never throws there", () => {
    // Vitest runs in node: window is undefined, so the accessor
    // degrades to null instead of throwing.
    expect(tabSessionStorage()).toBeNull();
    expect(() => tabSessionStorage()).not.toThrow();
  });
});

describe("approvedReviews fallback read (Q8) + approved-only projection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubConfig() {
    vi.stubEnv("SUPABASE_URL", "https://jwccyndyaamodxjtjtfo.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  }

  function jsonResponse(rows: unknown, status = 200): Response {
    return new Response(JSON.stringify(rows), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const approvedRow = {
    id: REVIEW_ID,
    rating: 5,
    title: "Great",
    body: "Fits well and the fabric feels great.",
    author_display_name: "Tester",
    created_at: "2026-11-16T10:00:00.000Z",
    verified_purchase: true,
  };

  it("reads the verified flag when the column exists, in one request", async () => {
    stubConfig();
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return jsonResponse([approvedRow]);
    });
    const reviews = await approvedReviews(PRODUCT_ID);
    expect(reviews).toEqual([
      {
        id: REVIEW_ID,
        productId: PRODUCT_ID,
        author: "Tester",
        rating: 5,
        title: "Great",
        body: "Fits well and the fabric feels great.",
        createdAt: "2026-11-16T10:00:00.000Z",
        verifiedPurchase: true,
      },
    ]);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("status=eq.approved");
    expect(urls[0]).toContain("verified_purchase");
  });

  it("retries once without the flag pre-migration instead of failing to []", async () => {
    stubConfig();
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.includes("verified_purchase")) return jsonResponse({ message: "column missing" }, 400);
      const legacy = {
        id: approvedRow.id,
        rating: approvedRow.rating,
        title: approvedRow.title,
        body: approvedRow.body,
        author_display_name: approvedRow.author_display_name,
        created_at: approvedRow.created_at,
      };
      return jsonResponse([legacy]);
    });
    const reviews = await approvedReviews(PRODUCT_ID);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.verifiedPurchase).toBe(false);
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes("status=eq.approved"))).toBe(true);
  });

  it("returns [] when both reads fail, and drops invalid rows", async () => {
    stubConfig();
    vi.stubGlobal("fetch", async () => jsonResponse({ message: "down" }, 500));
    expect(await approvedReviews(PRODUCT_ID)).toEqual([]);
    vi.stubGlobal("fetch", async () =>
      jsonResponse([{ ...approvedRow, rating: 6 }, { ...approvedRow, id: REVIEW_ID, rating: 4 }]),
    );
    const reviews = await approvedReviews(PRODUCT_ID);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.rating).toBe(4);
  });
});

describe("getReviews gate: merged published feed, fixtures excluded", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function adminRow(): Record<string, unknown> {
    return {
      id: PRODUCT_ID,
      slug: "sample-oxford-shirt",
      name: "Sample Oxford Shirt",
      description: "A crisp sample shirt for feed tests.",
      category_id: CATEGORY_ID,
      highlights: ["100% cotton"],
      tags: ["cotton"],
      badges: ["New Arrival"],
      created_at: "2026-11-15T00:00:00.000Z",
      published_at: "2026-11-15T01:00:00.000Z",
      variants: [
        { id: VARIANT_ID, size: "M", color: "Navy Blue", price_minor: 250000, sale_price_minor: 200000, available: 3 },
      ],
      media: [{ path: MEDIA_PATH, alt: "Front view" }],
    };
  }

  function stubFeed(reviewRows: unknown[]) {
    vi.stubEnv("SUPABASE_URL", "https://jwccyndyaamodxjtjtfo.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const reviewCalls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("published_thrift_catalogue")) {
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("published_admin_catalogue")) {
        return new Response(JSON.stringify([adminRow()]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("product_reviews")) {
        reviewCalls.push(url);
        return new Response(JSON.stringify(reviewRows), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    return { reviewCalls };
  }

  it("returns approved reviews for an admin-published product id", async () => {
    const { reviewCalls } = stubFeed([
      {
        id: REVIEW_ID,
        rating: 5,
        title: "Great",
        body: "Fits well and the fabric feels great.",
        author_display_name: "Tester",
        created_at: "2026-11-16T10:00:00.000Z",
        verified_purchase: true,
      },
    ]);
    const reviews = await dataSource.getReviews(PRODUCT_ID);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.verifiedPurchase).toBe(true);
    expect(reviewCalls).toHaveLength(1);
  });

  it("returns [] for unknown and fixture ids without reading reviews", async () => {
    const { reviewCalls } = stubFeed([]);
    expect(await dataSource.getReviews("99999999-9999-4999-8999-999999999999")).toEqual([]);
    expect(await dataSource.getReviews("p001")).toEqual([]);
    expect(reviewCalls).toHaveLength(0);
  });
});

describe("SEO invariant: JSON-LD aggregateRating follows the approved array only", () => {
  const base = {
    name: "Sample Oxford Shirt",
    description: "A crisp sample shirt.",
    imageUrls: [] as string[],
    url: "https://example.invalid/product/sample-oxford-shirt",
    price: 2500,
    inStock: true,
  };

  it("emits no aggregateRating for an empty array", () => {
    expect(productJsonLd({ ...base, reviews: [] })).not.toHaveProperty("aggregateRating");
  });

  it("emits the mean and count for approved reviews", () => {
    const data = productJsonLd({ ...base, reviews: [{ rating: 5 }, { rating: 4 }] });
    expect(data.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      reviewCount: 2,
    });
  });
});

describe("source guards: review submission contracts", () => {
  it("ReviewList has no false copy, shows the badge only on proof, and labels the own review", async () => {
    const source = await readSrc("components/product/ReviewList.tsx");
    expect(source).not.toContain("currently unavailable");
    expect(source).not.toContain("stays open");
    expect(source).not.toContain("setLogin");
    expect(source).toContain("Verified purchase");
    expect(source).toContain("verifiedPurchase === true");
    expect(source).toContain("Awaiting approval");
    expect(source).toContain("Not approved");
    expect(source).toContain("onSignedIn");
    expect(source).toContain("Edit Your Review");
  });

  it("ReviewList persists the draft across navigating sign-in paths and clears it on submit/dismissal (S1)", async () => {
    const source = await readSrc("components/product/ReviewList.tsx");
    expect(source).toContain("readReviewDraft");
    expect(source).toContain("writeReviewDraft");
    expect(source).toContain("clearReviewDraft");
    expect(source).toContain("tabSessionStorage");
    expect(source).toContain("handleDraftChange");
  });

  it("ReviewForm validates against the server action and reuses the star-gold token", async () => {
    const source = await readSrc("components/product/ReviewForm.tsx");
    expect(source).toContain("submitReviewAction");
    expect(source).toContain("REVIEW_SIGN_IN_EXPIRED_MESSAGE");
    expect(source).toContain("#C9932E");
    expect(source).toContain("review-rating");
    expect(source).toContain("review-title");
    expect(source).toContain("review-body");
  });

  it("LoginForm keeps its default navigation and gains only an optional callback; RegisterForm is untouched", async () => {
    const source = await readSrc("components/account/AuthForms.tsx");
    expect(source).toContain("onSignedIn?: () => void");
    expect(source).toContain("onSignedIn()");
    expect(source).toContain('router.push(next ?? "/account")');
    expect(source).toContain("export function RegisterForm({ next }: { next?: string })");
  });

  it("approvedReviews keeps the approved-only filter on both fallback selects", async () => {
    const source = await readSrc("services/adapters/published-thrift.ts");
    expect(source).toContain("status=eq.approved");
    expect(source).toContain("verified_purchase");
    expect(source).toContain("REVIEWS_SELECT_WITH_VERIFIED");
  });

  it("the getReviews gate uses the merged feed, not the allowlist alone", async () => {
    const source = await readSrc("services/adapters/owner-catalogue.ts");
    expect(source).toContain("readPublishedFeed");
    expect(source).toContain("mergeStorefrontFeed(feed.allowlist");
    expect(source).not.toContain("publishedShirts()).some");
  });

  it("the product page passes the session signal and keeps the own review out of the approved array", async () => {
    const source = await readSrc("app/(store)/product/[slug]/page.tsx");
    expect(source).toContain("customerSession()");
    expect(source).toContain("readOwnReview");
    expect(source).toContain("ownReview={ownReview}");
    expect(source).toContain("signedIn={session !== null}");
    expect(source).not.toContain("average={product.rating.average}");
    expect(source).toContain("reviews={reviews}");
  });

  it("the own-review read goes through the own-review RPC, never a direct select (M1)", async () => {
    const source = await readSrc("lib/customer/reviews.ts");
    expect(source).toContain('client.rpc("read_own_product_review"');
    expect(source).not.toContain('.from("product_reviews")');
    expect(source).not.toContain('.eq("customer_id"');
    expect(source).not.toContain("readOwnReviewWithColumns");
    expect(source).not.toContain("OWN_REVIEW_COLUMNS");
  });

  it("the review write goes through the RPC on the customer client, never a privileged key", async () => {
    const source = await readSrc("lib/customer/reviews.ts");
    expect(source).toContain('client.rpc("submit_product_review"');
    const dir = join(SRC_DIR, "lib", "customer");
    for (const file of await readdir(dir)) {
      const text = await readFile(join(dir, file), "utf8");
      expect(text).not.toContain("service_role");
      expect(text).not.toContain("SERVICE_ROLE");
      expect(text).not.toContain("serviceRole");
    }
  });

  it("the moderation action mirrors setPaymentStatus and the queue has no sample fallback", async () => {
    const source = await readSrc("lib/admin/reviews.ts");
    expect(source).toContain('requireStaff(areaRoles("catalogue"))');
    expect(source).toContain('revalidatePath("/admin/catalog/reviews")');
    expect(source).toContain('rpc("moderate_product_review"');
    expect(source).toContain('rpc("admin_list_product_reviews"');
    expect(source).not.toContain("SAMPLE_");
    expect(source).not.toContain("resolveDisplayData");
    const page = await readSrc("app/admin/(workspace)/catalog/reviews/page.tsx");
    expect(page).not.toContain("SAMPLE_");
    expect(page).not.toContain("resolveDisplayData");
    expect(page).toContain("Review data is unavailable");
    const shell = await readSrc("components/admin/access/AdminShell.tsx");
    expect(shell).toContain("/admin/catalog/reviews");
  });

  it("the data-source contract carries submitReview on every adapter", async () => {
    expect(await readSrc("services/types.ts")).toContain("submitReview");
    expect(await readSrc("services/adapters/customer.ts")).toContain("submitReview");
    expect(await readSrc("services/adapters/unavailable.ts")).toContain("submitReview");
    expect(await readSrc("services/adapters/mock.ts")).toContain("submitReview");
    expect(await readSrc("services/actions.ts")).toContain("submitReviewAction");
  });

  it("no review path references fixtures or sample review data", async () => {
    for (const relative of [
      "lib/customer/reviews.ts",
      "lib/customer/actions.ts",
      "lib/admin/reviews.ts",
      "components/product/ReviewList.tsx",
      "components/product/ReviewForm.tsx",
      "services/adapters/published-thrift.ts",
      "services/adapters/owner-catalogue.ts",
      "app/admin/(workspace)/catalog/reviews/page.tsx",
    ]) {
      const source = await readSrc(relative);
      expect(source).not.toContain("mockReviewsFor");
      expect(source).not.toContain("SAMPLE_");
    }
  });

  it("the migration is defensive, additive-only, and states its precondition", async () => {
    const sql = await readFile(MIGRATION_PATH, "utf8");
    const lower = sql.toLowerCase();
    expect(lower).toContain("add column if not exists");
    expect(lower).toContain("create index if not exists");
    expect(lower).toContain("drop trigger if exists");
    expect(lower).toContain("create or replace function public.submit_product_review");
    expect(lower).toContain("create or replace function public.moderate_product_review");
    expect(lower).toContain("create or replace function public.read_own_product_review");
    expect(lower).toContain("grant execute on function public.read_own_product_review(uuid) to authenticated");
    expect(lower).toContain("revoke all on function public.read_own_product_review(uuid) from public, anon");
    expect(lower).toContain("admin_list_product_reviews");
    expect(lower).toContain("precondition");
    // N11: the header must not assert the precondition as verified —
    // it states the assumption honestly and mandates the drift check.
    expect(sql).not.toContain("IS in the verified applied-migration history");
    expect(sql).toContain("MUST confirm the objects exist");
    // Comment lines excluded: the header itself names the forbidden
    // statements it does not contain.
    const statements = lower
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toContain("create table");
    expect(statements).not.toContain("drop table");
  });
});
