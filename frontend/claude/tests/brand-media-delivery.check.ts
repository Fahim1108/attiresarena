import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  brandMediaConfiguration,
  brandMediaUrl,
  isBrandStoragePath,
  serveBrandMedia,
} from "../src/lib/brand-media-delivery";

/**
 * Brand-media delivery checks. The helper is tested with an injected
 * fetch stub, so no test here touches the network: every upstream
 * response is fabricated, and the "fetch not invoked" assertions prove
 * validation-before-fetch. Configuration goes through the real
 * brandMediaConfiguration via stubbed env, so the exact-ref and
 * service-key gates are exercised, not mocked away.
 */

const STAGING_URL = "https://jwccyndyaamodxjtjtfo.supabase.co";
const SERVICE_KEY = "sb_service_role_test_fixture_key_long";
const FILE_JPG = "11111111-1111-4111-8111-111111111111.jpg";
const FILE_PNG = "22222222-2222-4222-8222-222222222222.png";
const PATH_JPG = `brand/${FILE_JPG}`;
const UPSTREAM_JPG = `${STAGING_URL}/storage/v1/object/authenticated/attires-product-drafts/brand/${FILE_JPG}`;

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
    headers: { "content-type": "text/plain" },
  });
}

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("SUPABASE_URL", STAGING_URL);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_fixture_key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("brandMediaConfiguration", () => {
  it("returns the pinned staging URL and service key", () => {
    expect(brandMediaConfiguration()).toEqual({
      url: STAGING_URL,
      serviceKey: SERVICE_KEY,
    });
  });

  it("fails closed without a real service key", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "short");
    expect(brandMediaConfiguration()).toBe(null);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(brandMediaConfiguration()).toBe(null);
  });

  it("fails closed when the service key equals the publishable key", () => {
    vi.stubEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      "sb_publishable_test_fixture_key",
    );
    expect(brandMediaConfiguration()).toBe(null);
  });

  it("fails closed on the wrong project URL", () => {
    vi.stubEnv("SUPABASE_URL", "https://example.invalid");
    expect(brandMediaConfiguration()).toBe(null);
  });
});

describe("isBrandStoragePath / brandMediaUrl", () => {
  it("accepts only brand/<uuid>.<ext> paths", () => {
    expect(isBrandStoragePath(PATH_JPG)).toBe(true);
    expect(isBrandStoragePath(`brand/${FILE_PNG}`)).toBe(true);
    expect(isBrandStoragePath("brand/33333333-3333-4333-8333-333333333333.webp")).toBe(true);
    expect(isBrandStoragePath("banners/winter.jpg")).toBe(false);
    expect(
      isBrandStoragePath(
        "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg",
      ),
    ).toBe(false);
    expect(isBrandStoragePath("brand/../secret.jpg")).toBe(false);
    expect(isBrandStoragePath("brand/logo.svg")).toBe(false);
    expect(isBrandStoragePath("brand/LOGO.JPG")).toBe(false);
    expect(isBrandStoragePath(`brand/${"a".repeat(200)}.jpg`)).toBe(false);
  });

  it("maps a valid path to the same-origin route, and nothing else", () => {
    expect(brandMediaUrl(PATH_JPG)).toBe(`/api/brand-media/${FILE_JPG}`);
    expect(brandMediaUrl("banners/winter.jpg")).toBe(null);
    expect(brandMediaUrl(null)).toBe(null);
    expect(brandMediaUrl(undefined)).toBe(null);
  });
});

describe("serveBrandMedia", () => {
  it("streams upstream bytes with the extension content type", async () => {
    const { calls, fetchImpl } = stubFetch(() => okBytes());
    const response = await serveBrandMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await response.text()).toBe("fake-image-bytes");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(UPSTREAM_JPG);
    expect(calls[0]?.init?.headers).toEqual({
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    });
  });

  it("never fetches for an invalid path", async () => {
    const { calls, fetchImpl } = stubFetch(() => okBytes());
    for (const bad of [
      "banners/winter.jpg",
      "brand/../secret.jpg",
      "brand/logo.svg",
      "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg",
      "",
    ]) {
      const response = await serveBrandMedia(bad, fetchImpl);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
    expect(calls).toHaveLength(0);
  });

  it("never fetches when the service key is unconfigured", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { calls, fetchImpl } = stubFetch(() => okBytes());
    const response = await serveBrandMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("maps upstream denials to an empty 404 and failures to an empty 502", async () => {
    const denied = stubFetch(() => upstreamError(403));
    const missing = stubFetch(() => upstreamError(404));
    const broken = stubFetch(() => upstreamError(500));
    const failed = stubFetch(() => {
      throw new Error("network down");
    });
    expect((await serveBrandMedia(PATH_JPG, denied.fetchImpl)).status).toBe(404);
    expect(await (await serveBrandMedia(PATH_JPG, denied.fetchImpl)).text()).toBe("");
    expect((await serveBrandMedia(PATH_JPG, missing.fetchImpl)).status).toBe(404);
    expect((await serveBrandMedia(PATH_JPG, broken.fetchImpl)).status).toBe(502);
    expect((await serveBrandMedia(PATH_JPG, failed.fetchImpl)).status).toBe(502);
  });

  it("rejects a wrong upstream content type and oversize bodies", async () => {
    const wrongType = stubFetch(() => okBytes("x", "text/html"));
    expect((await serveBrandMedia(PATH_JPG, wrongType.fetchImpl)).status).toBe(502);
    const oversize = stubFetch(() =>
      okBytes("x", "image/jpeg", String(6 * 1024 * 1024)),
    );
    expect((await serveBrandMedia(PATH_JPG, oversize.fetchImpl)).status).toBe(502);
  });
});
