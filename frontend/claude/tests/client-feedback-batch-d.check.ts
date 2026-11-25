import { describe, expect, it, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StorefrontProvider } from "@/context/StorefrontContext";
import { Footer } from "@/components/layout/Footer";
import { OrderDetail } from "@/components/account/OrderDetail";
import { ReviewList } from "@/components/product/ReviewList";
import { developerContact } from "@/config/contact";
import { footer as staticFooter, SAMPLE_STORE_PHONE } from "@/config/footer";
import {
  CUSTOMER_ORDER_MEDIA_RPC,
  mergeOrderMedia,
  projectCustomerOrder,
  projectOrderMediaRows,
  readCustomerOrders,
  readOrderMedia,
} from "@/lib/customer/orders";
import type { CustomerClient } from "@/lib/customer/supabase";
import {
  MAX_REVIEW_PHOTOS,
  projectReviewPhotoRow,
  reviewPhotoUrl,
  uploadReviewPhoto,
} from "@/lib/customer/review-photos";
import { trackGuestOrderByPhone } from "@/lib/customer/tracking";
import { approvedReviews } from "@/services/adapters/published-thrift";
import type { Order, StorefrontSettings } from "@/types";

/**
 * Client feedback batch D: footer phone + credit (items 8, 9),
 * order-history photos (item 14), account reviews + photos
 * (item 19). No live Supabase calls: clients and fetch are stubbed.
 */

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(TESTS_DIR, "..", "src");
const MIGRATIONS_DIR = join(TESTS_DIR, "..", "..", "..", "supabase", "migrations");

async function readSrc(relative: string): Promise<string> {
  return readFile(join(SRC_DIR, relative), "utf8");
}

const ORDER_ID = "11111111-2222-4333-8444-555555555555";
const PRODUCT_ID = "22222222-3333-4444-8555-666666666666";
const VARIANT_ID = "33333333-4444-4555-8666-777777777777";
const USER_ID = "44444444-5555-4666-8777-888888888888";
const REVIEW_ID = "55555555-6666-4777-8888-999999999999";
const MEDIA_PATH =
  "66666666-7777-4888-8999-aaaaaaaaaaaa/77777777-8888-4999-8aaa-bbbbbbbbbbbb.jpg";
const PHOTO_PATH =
  "88888888-9999-4aaa-8bbb-cccccccccccc/99999999-aaaa-4bbb-8ccc-dddddddddddd.webp";

function footerHtml(phone: string): string {
  const settings = {
    siteName: "Attires Arena",
    logo: { primary: "/brand/logo-maroon.png", inverse: "/brand/logo-white.png", badge: "/brand/logo-maroon.png" },
    footer: { ...staticFooter, contact: { ...staticFooter.contact, phone } },
  } as unknown as StorefrontSettings;
  return renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop -- createElement in a .ts test file: children must ride in props for the typecheck
    createElement(StorefrontProvider, {
      settings,
      children: createElement(Footer),
    }),
  );
}

describe("footer credit (item 9)", () => {
  it("credits WebCanvasBD and keeps the WhatsApp number, with the message addressed to WebCanvasBD", () => {
    expect(developerContact.name).toBe("WebCanvasBD");
    expect(developerContact.whatsappUrl).toContain("https://wa.me/8801632915921?text=");
    const text = decodeURIComponent(developerContact.whatsappUrl.split("text=")[1] ?? "");
    expect(text).toContain("Hello WebCanvasBD");
    expect(text).not.toContain("Firoj Ahamed Fahim");
    expect(developerContact.whatsappUrl).not.toContain("Firoj");
  });
});

describe("footer phone (item 8)", () => {
  it("renders a real phone as a tel: link below the social icons", () => {
    const html = footerHtml("01886456664");
    expect(html).toContain('href="tel:01886456664"');
    expect(html).toContain(">01886456664<");
  });

  it("never renders the config placeholder phone", () => {
    const html = footerHtml("+880 1XXX-XXXXXX");
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("1XXX-XXXXXX");
  });

  it("uses a clearly-marked sample number, wired to Preview only in the layout", async () => {
    expect(SAMPLE_STORE_PHONE).toBe("+880 1700-000000");
    const layout = await readSrc("app/layout.tsx");
    expect(layout).toContain('process.env.VERCEL_ENV === "preview"');
    expect(layout).toContain("SAMPLE_STORE_PHONE");
    expect(layout).not.toContain("SAMPLE_STORE_PHONE = ");
  });
});

describe("order media RPC projection (item 14)", () => {
  const row = {
    product_id: PRODUCT_ID,
    slug: "check-shirt",
    image_src: `/api/product-media/${MEDIA_PATH}`,
    image_alt: "Check shirt",
  };

  it("projects valid rows and skips malformed ones", () => {
    const map = projectOrderMediaRows([row, { product_id: "nope" }, "junk"]);
    expect(map.size).toBe(1);
    expect(map.get(PRODUCT_ID)).toEqual({
      slug: "check-shirt",
      image: { src: `/api/product-media/${MEDIA_PATH}`, alt: "Check shirt" },
    });
    expect(projectOrderMediaRows(null).size).toBe(0);
    expect(projectOrderMediaRows({}).size).toBe(0);
  });

  it("merges RPC media under the feed map: the feed always wins", () => {
    const feed = new Map([
      [PRODUCT_ID, { slug: "feed-slug", image: { src: "/feed.jpg", alt: "Feed" } }],
    ]);
    const resolved = new Map([
      [PRODUCT_ID, { slug: "rpc-slug", image: { src: "/rpc.jpg", alt: "RPC" } }],
      [VARIANT_ID, { slug: "rpc-only", image: { src: "/rpc2.jpg", alt: "RPC 2" } }],
    ]);
    const merged = mergeOrderMedia(feed, resolved);
    expect(merged.get(PRODUCT_ID)?.slug).toBe("feed-slug");
    expect(merged.get(VARIANT_ID)?.slug).toBe("rpc-only");
  });

  it("calls the RPC only for products missing from the feed, and fails closed to an empty map", async () => {
    const calls: string[] = [];
    const client = {
      rpc: async (name: string) => {
        calls.push(name);
        return { data: [row], error: null };
      },
    } as unknown as CustomerClient;
    const feed = new Map();
    const resolved = await readOrderMedia(client, [ORDER_ID], feed, [PRODUCT_ID]);
    expect(calls).toEqual([CUSTOMER_ORDER_MEDIA_RPC]);
    expect(resolved.get(PRODUCT_ID)?.slug).toBe("check-shirt");

    // Nothing missing: no RPC call at all.
    calls.length = 0;
    const covered = new Map([
      [PRODUCT_ID, { slug: "check-shirt", image: { src: "/x.jpg", alt: "x" } }],
    ]);
    expect(await readOrderMedia(client, [ORDER_ID], covered, [PRODUCT_ID])).toEqual(new Map());
    expect(calls).toEqual([]);

    // RPC error (including the pre-migration missing function): empty map, never a throw.
    const failing = {
      rpc: async () => ({ data: null, error: { code: "PGRST202" } }),
    } as unknown as CustomerClient;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await readOrderMedia(failing, [ORDER_ID], feed, [PRODUCT_ID])).toEqual(new Map());
    } finally {
      errorSpy.mockRestore();
    }
  });
});

function stubQuery(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

const orderRow = {
  id: ORDER_ID,
  order_number: 12345,
  customer_name: "Fahim",
  phone: "01700000000",
  email: null,
  division: "Dhaka",
  district: "Dhaka",
  area: "Dhanmondi",
  address_line: "House 1",
  payment_method: "cod",
  payment_status: "paid",
  status: "delivered",
  subtotal_minor: 150000,
  delivery_charge_minor: 6000,
  discount_minor: 0,
  total_minor: 156000,
  placed_at: "2026-11-16T10:00:00.000Z",
};
const itemRow = {
  id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
  order_id: ORDER_ID,
  product_id: PRODUCT_ID,
  variant_id: VARIANT_ID,
  product_name: "Check shirt",
  size: "M",
  color: "Blue",
  unit_price_minor: 150000,
  quantity: 1,
  line_total_minor: 150000,
  created_at: "2026-11-16T10:00:00.000Z",
};
const mediaRow = {
  product_id: PRODUCT_ID,
  slug: "check-shirt",
  image_src: `/api/product-media/${MEDIA_PATH}`,
  image_alt: "Check shirt",
};

describe("order history shows the ordered product's photo (item 14)", () => {
  it("resolves an unpublished product's photo + slug through the RPC instead of the logo", async () => {
    const rpcCalls: string[] = [];
    const client = {
      from: (table: string) =>
        stubQuery(
          table === "orders"
            ? { data: [orderRow], error: null }
            : { data: [itemRow], error: null },
        ),
      rpc: async (name: string) => {
        rpcCalls.push(name);
        return { data: [mediaRow], error: null };
      },
    } as unknown as CustomerClient;
    const orders = await readCustomerOrders(client, USER_ID, new Map());
    expect(rpcCalls).toEqual([CUSTOMER_ORDER_MEDIA_RPC]);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.lines[0]?.image).toEqual({
      src: `/api/product-media/${MEDIA_PATH}`,
      alt: "Check shirt",
    });
    expect(orders[0]?.lines[0]?.productSlug).toBe("check-shirt");
  });

  it("keeps the logo fallback when the RPC has no photo for the product", async () => {
    const client = {
      from: (table: string) =>
        stubQuery(
          table === "orders"
            ? { data: [orderRow], error: null }
            : { data: [itemRow], error: null },
        ),
      rpc: async () => ({ data: [], error: null }),
    } as unknown as CustomerClient;
    const orders = await readCustomerOrders(client, USER_ID, new Map());
    expect(orders[0]?.lines[0]?.image.src).toBe("/brand/logo-maroon.png");
    expect(orders[0]?.lines[0]?.productSlug).toBe("");
  });

  it("guest tracking resolves the same RPC media for the looked-up order", async () => {
    const rpcCalls: string[] = [];
    const rpc = (async <T>(name: string): Promise<{ ok: true; data: T } | { ok: false; code: string }> => {
      rpcCalls.push(name);
      if (name === "customer_track_order_by_phone") {
        return { ok: true, data: { order: orderRow, items: [itemRow] } as T };
      }
      return { ok: true, data: [mediaRow] as T };
    });
    const order = await trackGuestOrderByPhone(rpc, 12345, "01700000000", new Map());
    expect(rpcCalls).toEqual(["customer_track_order_by_phone", CUSTOMER_ORDER_MEDIA_RPC]);
    expect(order?.lines[0]?.image.src).toBe(`/api/product-media/${MEDIA_PATH}`);
    expect(order?.lines[0]?.productSlug).toBe("check-shirt");
  });

  it("projectCustomerOrder still falls back to the logo without any media (existing contract)", () => {
    const order = projectCustomerOrder(orderRow, [itemRow], new Map());
    expect(order?.lines[0]?.image.src).toBe("/brand/logo-maroon.png");
  });
});

describe("review photo URLs + rows (item 19)", () => {
  it("builds the delivery URL only for valid review-photo paths", () => {
    expect(reviewPhotoUrl(PHOTO_PATH)).toBe(
      "/api/review-photos/88888888-9999-4aaa-8bbb-cccccccccccc/99999999-aaaa-4bbb-8ccc-dddddddddddd.webp",
    );
    expect(reviewPhotoUrl("../../etc/passwd")).toBeNull();
    expect(reviewPhotoUrl(`${PHOTO_PATH}/extra`)).toBeNull();
    expect(reviewPhotoUrl(PHOTO_PATH.replace(".webp", ".gif"))).toBeNull();
  });

  it("projects valid photo rows and skips malformed ones", () => {
    const row = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      review_id: REVIEW_ID,
      storage_path: PHOTO_PATH,
      position: 0,
    };
    expect(projectReviewPhotoRow(row)).toEqual({
      reviewId: REVIEW_ID,
      storagePath: PHOTO_PATH,
      position: 0,
    });
    expect(projectReviewPhotoRow({ ...row, position: 3 })).toEqual({
      reviewId: REVIEW_ID,
      storagePath: PHOTO_PATH,
      position: 3,
    });
    expect(projectReviewPhotoRow({ review_id: REVIEW_ID })).toBeNull();
    expect(projectReviewPhotoRow(null)).toBeNull();
  });

  it("caps photos at 3 per review", () => {
    expect(MAX_REVIEW_PHOTOS).toBe(3);
  });
});

function stubStorageClient(options: {
  uploadError?: { message: string } | null;
  rpcError?: { code: string } | null;
  rpcData?: unknown;
}) {
  const removed: string[][] = [];
  const client = {
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: "x" }, error: options.uploadError ?? null }),
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { data: null, error: null };
        },
      }),
    },
    rpc: async () => ({ data: options.rpcData ?? "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", error: options.rpcError ?? null }),
  } as unknown as CustomerClient;
  return { client, removed };
}

describe("review photo upload validation (item 19)", () => {
  const file = (type = "image/jpeg", size = 1000) =>
    new File([new Uint8Array(size)], "photo.jpg", { type });

  it("rejects non-image files, oversized files, bad positions, and bad ids", async () => {
    const { client } = stubStorageClient({});
    expect((await uploadReviewPhoto(client, USER_ID, REVIEW_ID, file("image/gif"), 0)).ok).toBe(false);
    expect((await uploadReviewPhoto(client, USER_ID, REVIEW_ID, file("image/jpeg", 6 * 1024 * 1024), 0)).ok).toBe(false);
    expect((await uploadReviewPhoto(client, USER_ID, REVIEW_ID, file(), 3)).ok).toBe(false);
    expect((await uploadReviewPhoto(client, USER_ID, "not-a-uuid", file(), 0)).ok).toBe(false);
    expect((await uploadReviewPhoto(client, "not-a-uuid", REVIEW_ID, file(), 0)).ok).toBe(false);
  });

  it("uploads then attaches, and removes orphan bytes when the attach RPC fails", async () => {
    const { client, removed } = stubStorageClient({ rpcError: { code: "42501" } });
    const failed = await uploadReviewPhoto(client, USER_ID, REVIEW_ID, file(), 0);
    expect(failed.ok).toBe(false);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.[0]).toContain(`${USER_ID}/`);

    const ok = stubStorageClient({});
    const result = await uploadReviewPhoto(ok.client, USER_ID, REVIEW_ID, file("image/webp"), 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.photoId).toBe("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff");
    expect(ok.removed).toEqual([]);
  });

  it("fails closed when the storage upload itself fails", async () => {
    const { client } = stubStorageClient({ uploadError: { message: "bucket missing" } });
    const result = await uploadReviewPhoto(client, USER_ID, REVIEW_ID, file(), 0);
    expect(result.ok).toBe(false);
  });
});

function testOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    orderNumber: "12345",
    placedAt: "2026-11-16T10:00:00.000Z",
    status: "delivered",
    paymentMethod: "cod",
    paymentStatus: "paid",
    lines: [
      {
        productId: PRODUCT_ID,
        productSlug: "check-shirt",
        name: "Check shirt",
        image: { src: "/img/check.jpg", alt: "Check shirt" },
        colorName: "Blue",
        size: "M",
        quantity: 1,
        unitPrice: 1500,
      },
    ],
    summary: { itemCount: 1, subtotal: 1500, discount: 0, deliveryCharge: 60, total: 1560 },
    shippingAddress: {
      label: "",
      fullName: "Fahim",
      phone: "01700000000",
      division: "Dhaka",
      district: "Dhaka",
      area: "Dhanmondi",
      addressLine: "House 1",
    },
    timeline: [
      { status: "pending", label: "Pending", at: "2026-11-16T10:00:00.000Z" },
      { status: "delivered", label: "Delivered" },
    ],
    ...overrides,
  } as Order;
}

describe("review from the account (item 19)", () => {
  it("adds a Write a review link per order line, deep-linking to the product's reviews", () => {
    const html = renderToStaticMarkup(createElement(OrderDetail, { order: testOrder() }));
    expect(html).toContain('href="/product/check-shirt#reviews"');
    expect(html).toContain("Write a review");
  });

  it("shows no review link for a line whose product left the feed (no slug)", () => {
    const order = testOrder({
      lines: [{ ...testOrder().lines[0]!, productSlug: "" }],
    });
    const html = renderToStaticMarkup(createElement(OrderDetail, { order }));
    expect(html).not.toContain("Write a review");
  });
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/product/check-shirt",
}));

describe("approved review photos render (item 19)", () => {
  it("renders photo thumbnails under the review body", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewList, {
        reviews: [
          {
            id: REVIEW_ID,
            productId: PRODUCT_ID,
            author: "Tester",
            rating: 5,
            title: "Great",
            body: "Fits well.",
            createdAt: "2026-11-16T10:00:00.000Z",
            verifiedPurchase: true,
            photos: [{ src: reviewPhotoUrl(PHOTO_PATH)!, alt: "Customer review photo" }],
          },
        ],
        signedIn: true,
        ownReview: null,
        productId: PRODUCT_ID,
      }),
    );
    expect(html).toContain("/api/review-photos/88888888-9999-4aaa-8bbb-cccccccccccc/99999999-aaaa-4bbb-8ccc-dddddddddddd.webp");
    expect(html).toContain("Customer review photo");
  });

  it("renders no photo markup when a review has no photos", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewList, {
        reviews: [
          {
            id: REVIEW_ID,
            productId: PRODUCT_ID,
            author: "Tester",
            rating: 5,
            title: "Great",
            body: "Fits well.",
            createdAt: "2026-11-16T10:00:00.000Z",
            verifiedPurchase: true,
          },
        ],
        signedIn: true,
        ownReview: null,
        productId: PRODUCT_ID,
      }),
    );
    expect(html).not.toContain("review-photos");
    expect(html).not.toContain("Review photos");
  });
});

describe("approvedReviews attaches photos (item 19)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function jsonResponse(rows: unknown, status = 200): Response {
    return new Response(JSON.stringify(rows), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("attaches the approved review's photos in position order", async () => {
    vi.stubEnv("SUPABASE_URL", "https://jwccyndyaamodxjtjtfo.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const photoRows = [
      { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", review_id: REVIEW_ID, storage_path: PHOTO_PATH, position: 0 },
    ];
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("product_review_photos")) return jsonResponse(photoRows);
      return jsonResponse([
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
    });
    const reviews = await approvedReviews(PRODUCT_ID);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.photos).toEqual([
      { src: reviewPhotoUrl(PHOTO_PATH), alt: "Customer review photo" },
    ]);
  });

  it("keeps reviews photo-less when the photo read fails (pre-migration)", async () => {
    vi.stubEnv("SUPABASE_URL", "https://jwccyndyaamodxjtjtfo.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("product_review_photos")) return jsonResponse({ message: "no table" }, 404);
      return jsonResponse([
        {
          id: REVIEW_ID,
          rating: 5,
          title: "Great",
          body: "Fits well.",
          author_display_name: "Tester",
          created_at: "2026-11-16T10:00:00.000Z",
          verified_purchase: false,
        },
      ]);
    });
    const reviews = await approvedReviews(PRODUCT_ID);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.photos).toBeUndefined();
  });
});

describe("review photo migration (item 19)", () => {
  it("creates the bucket, table, attach RPC, and approved-only read policies", async () => {
    const sql = await readFile(
      join(MIGRATIONS_DIR, "20261124000300_product_review_photos.sql"),
      "utf8",
    );
    expect(sql).toContain("review-photos");
    expect(sql).toContain("create table public.product_review_photos");
    expect(sql).toContain("attach_product_review_photo");
    expect(sql).toContain("Maximum 3 photos per review");
    expect(sql).toContain("review_photos_approved_read");
    expect(sql).toContain("is_approved_review_photo");
    expect(sql).toContain("grant execute on function public.attach_product_review_photo(uuid,text,integer) to authenticated");
  });

  it("the order-media migration resolves cover photos for the caller's own orders only", async () => {
    const sql = await readFile(
      join(MIGRATIONS_DIR, "20261124000200_customer_order_media.sql"),
      "utf8",
    );
    expect(sql).toContain("customer_order_media");
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("service_role");
    expect(sql).toContain("grant execute on function public.customer_order_media(uuid[]) to authenticated, service_role");
  });
});
