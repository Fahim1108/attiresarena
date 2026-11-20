import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveBannerMedia } from "../src/lib/banner-media-delivery";

/**
 * Visible-banner media delivery checks. Mirrors the published-media
 * delivery tests: the helper is tested with an injected fetch stub,
 * so no test here touches the network. Configuration goes through
 * the real publicSupabaseConfiguration via stubbed env.
 */

const STAGING_URL = "https://jwccyndyaamodxjtjtfo.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_test_fixture_key";
const OBJECT_JPG = "66666666-6666-4666-8666-666666666666.jpg";
const OBJECT_PNG = "77777777-7777-4777-8777-777777777777.png";
const OBJECT_WEBP = "88888888-8888-4888-8888-888888888888.webp";
const PATH_JPG = `banners/${OBJECT_JPG}`;
const PATH_PNG = `banners/${OBJECT_PNG}`;
const PATH_WEBP = `banners/${OBJECT_WEBP}`;
const UPSTREAM_JPG = `${STAGING_URL}/storage/v1/object/authenticated/attires-product-drafts/banners/${OBJECT_JPG}`;

function jwtKey(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.test-signature`;
}
const JWT_KEY = jwtKey("anon");

type CapturedCall = { url: string; init: RequestInit | undefined };

function stubFetch(
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { calls: CapturedCall[]; fetchImpl: typeof fetch } {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function okBytes(
  body = "fake-image-bytes",
  contentType = "image/jpeg",
  contentLength?: string,
): Response {
  const headers: Record<string, string> = { "content-type": contentType };
  if (contentLength !== undefined) headers["content-length"] = contentLength;
  return new Response(body, { status: 200, headers });
}

function upstreamError(status: number): Response {
  return new Response("upstream denial body must not leak", {
    status,
    headers: { "content-type": "application/json" },
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("SUPABASE_URL", STAGING_URL);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  errorSpy.mockRestore();
});

describe("path validation happens before any config read or fetch", () => {
  const INVALID_PATHS = [
    "",
    "/",
    "not-a-path",
    "banners/",
    `/banners/${OBJECT_JPG}/extra`,
    `../${OBJECT_JPG}`,
    `banners/../${OBJECT_JPG}`,
    `banners/%2F${OBJECT_JPG}`,
    `banners/66666666-6666-4666-8666-666666666666.gif`,
    `banners/66666666-6666-4666-8666-666666666666.svg`,
    `banners/66666666-6666-4666-8666-666666666666`,
    `banners/66666666-6666-4666-8666-666666666666.JPG`,
    `banners/not-a-uuid.jpg`,
    `55555555-5555-4555-8555-555555555555/${OBJECT_JPG}`,
    `brand/66666666-6666-4666-8666-666666666666.png`,
    "x".repeat(201),
    `${PATH_JPG}?download=1`,
  ];

  it.each(INVALID_PATHS)(
    "rejects %s with an empty no-store 404 and no fetch call",
    async (bad) => {
      const { calls, fetchImpl } = stubFetch(() => okBytes());
      const response = await serveBannerMedia(bad, fetchImpl);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(calls).toHaveLength(0);
    },
  );

  it("lets valid jpg/png/webp banner paths reach the upstream fetch", async () => {
    for (const path of [PATH_JPG, PATH_PNG, PATH_WEBP]) {
      const { calls, fetchImpl } = stubFetch(() => okBytes());
      const response = await serveBannerMedia(path, fetchImpl);
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
    }
  });
});

describe("upstream header construction", () => {
  it("sends apikey always, no Authorization for publishable keys, exact URL, no-store, timeout", async () => {
    const { calls, fetchImpl } = stubFetch(() => okBytes());
    const response = await serveBannerMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(UPSTREAM_JPG);
    expect(call.url).not.toContain(PUBLISHABLE_KEY);
    expect(call.init?.method).toBe("GET");
    expect(call.init?.cache).toBe("no-store");
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    expect(call.init?.headers).toEqual({ apikey: PUBLISHABLE_KEY });
  });

  it("sends Authorization Bearer only when the key is a JWT", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", JWT_KEY);
    const { calls, fetchImpl } = stubFetch(() => okBytes());
    const response = await serveBannerMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.headers).toEqual({
      apikey: JWT_KEY,
      Authorization: `Bearer ${JWT_KEY}`,
    });
  });
});

describe("unconfigured Supabase fails closed without fetching", () => {
  it("returns 404 with no fetch when the key is missing", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    const { calls, fetchImpl } = stubFetch(() => okBytes());
    const response = await serveBannerMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(calls).toHaveLength(0);
  });

  it("returns 404 with no fetch when the JWT role is not anon", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", jwtKey("authenticated"));
    const { calls, fetchImpl } = stubFetch(() => okBytes());
    const response = await serveBannerMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(calls).toHaveLength(0);
  });
});

describe("content-type allowlist and error mapping", () => {
  it("serves the type derived from the extension, not the upstream type", async () => {
    const { fetchImpl } = stubFetch(() => okBytes("bytes", "image/png"));
    const response = await serveBannerMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it.each(["text/html", "image/svg+xml", "application/octet-stream"])(
    "returns an empty no-store 502 for upstream type %s",
    async (contentType) => {
      const { fetchImpl } = stubFetch(() => okBytes("evil", contentType));
      const response = await serveBannerMedia(PATH_JPG, fetchImpl);
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it.each([400, 401, 403, 404, 405, 429])(
    "maps upstream %s to an empty no-store 404",
    async (status) => {
      const { fetchImpl } = stubFetch(() => upstreamError(status));
      const response = await serveBannerMedia(PATH_JPG, fetchImpl);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it.each([500, 502, 503])(
    "maps upstream %s to an empty no-store 502",
    async (status) => {
      const { fetchImpl } = stubFetch(() => upstreamError(status));
      const response = await serveBannerMedia(PATH_JPG, fetchImpl);
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("maps a thrown fetch (network/timeout) to an empty no-store 502", async () => {
    const { fetchImpl } = stubFetch(() => {
      throw new Error("offline");
    });
    const response = await serveBannerMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves success with the 60s cache bound, inline disposition and nosniff", async () => {
    const { fetchImpl } = stubFetch(() => okBytes("bytes", "image/jpeg", "5"));
    const response = await serveBannerMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe("5");
    expect(await response.text()).toBe("bytes");
  });

  it("returns 502 when upstream reports more than the 5 MiB bucket limit", async () => {
    const { fetchImpl } = stubFetch(() =>
      okBytes("x", "image/jpeg", "5242881"),
    );
    const response = await serveBannerMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("");
  });
});

describe("no secret leakage", () => {
  it("never puts the key in a response body or header, on success or denial", async () => {
    const success = await serveBannerMedia(
      PATH_JPG,
      stubFetch(() => okBytes("bytes")).fetchImpl,
    );
    expect(await success.text()).not.toContain(PUBLISHABLE_KEY);
    for (const value of success.headers.values()) {
      expect(value).not.toContain(PUBLISHABLE_KEY);
    }
    const denied = await serveBannerMedia(
      PATH_JPG,
      stubFetch(() => upstreamError(403)).fetchImpl,
    );
    expect(await denied.text()).not.toContain(PUBLISHABLE_KEY);
    for (const value of denied.headers.values()) {
      expect(value).not.toContain(PUBLISHABLE_KEY);
    }
  });

  it("logs path + status-kind only, never keys", async () => {
    await serveBannerMedia(
      PATH_JPG,
      stubFetch(() => upstreamError(403)).fetchImpl,
    );
    await serveBannerMedia(
      "bogus-path",
      stubFetch(() => okBytes()).fetchImpl,
    );
    const logged = errorSpy.mock.calls
      .flat()
      .map((arg: unknown) => String(arg))
      .join("\n");
    expect(logged).toContain("[attiresarena:banner-media]");
    expect(logged).toContain(PATH_JPG);
    expect(logged).toContain("http-403");
    expect(logged).not.toContain(PUBLISHABLE_KEY);
    expect(logged).not.toContain(JWT_KEY);
  });
});

describe("grep pins: no privileged-key references in the banner delivery files", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

  it("has no service-role references in the new banner delivery files", () => {
    const files = [
      "src/app/api/banner-media/[file]/route.ts",
      "src/lib/banner-media-delivery.ts",
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      for (const needle of ["service_role", "service-role"]) {
        if (source.includes(needle)) offenders.push(`${file}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
