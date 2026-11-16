import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { servePublishedMedia } from "../src/lib/published-media-delivery";

/**
 * Published-media delivery checks (Approach B). The helper is tested
 * with an injected fetch stub, so no test here touches the network:
 * every upstream response is fabricated, and the "fetch not invoked"
 * assertions prove validation-before-fetch. Configuration goes
 * through the real publicSupabaseConfiguration via stubbed env, so
 * the exact-ref and anon-role gates are exercised, not mocked away.
 */

const STAGING_URL = "https://jwccyndyaamodxjtjtfo.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_test_fixture_key";
const OWNER = "55555555-5555-4555-8555-555555555555";
const OBJECT_JPG = "66666666-6666-4666-8666-666666666666.jpg";
const OBJECT_PNG = "77777777-7777-4777-8777-777777777777.png";
const OBJECT_WEBP = "88888888-8888-4888-8888-888888888888.webp";
const PATH_JPG = `${OWNER}/${OBJECT_JPG}`;
const PATH_PNG = `${OWNER}/${OBJECT_PNG}`;
const PATH_WEBP = `${OWNER}/${OBJECT_WEBP}`;
const UPSTREAM_JPG = `${STAGING_URL}/storage/v1/object/authenticated/attires-product-drafts/${OWNER}/${OBJECT_JPG}`;

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
    `${OWNER}/`,
    `/${OBJECT_JPG}`,
    `${OWNER}/${OBJECT_JPG}/extra`,
    `../${OBJECT_JPG}`,
    `${OWNER}/../${OBJECT_JPG}`,
    `${OWNER}/%2F${OBJECT_JPG}`,
    `${OWNER}/66666666-6666-4666-8666-666666666666.gif`,
    `${OWNER}/66666666-6666-4666-8666-666666666666.svg`,
    `${OWNER}/66666666-6666-4666-8666-666666666666.txt`,
    `${OWNER}/66666666-6666-4666-8666-666666666666`,
    `${OWNER}/66666666-6666-4666-8666-666666666666.JPG`,
    "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA/66666666-6666-4666-8666-666666666666.jpg",
    `banners/66666666-6666-4666-8666-666666666666.jpg`,
    `brand/66666666-6666-4666-8666-666666666666.png`,
    "x".repeat(201),
    `${PATH_JPG}?download=1`,
  ];

  it.each(INVALID_PATHS)(
    "rejects %s with an empty no-store 404 and no fetch call",
    async (bad) => {
      const { calls, fetchImpl } = stubFetch(() => okBytes());
      const response = await servePublishedMedia(bad, fetchImpl);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(calls).toHaveLength(0);
    },
  );

  it("lets valid jpg/png/webp paths reach the upstream fetch", async () => {
    for (const path of [PATH_JPG, PATH_PNG, PATH_WEBP]) {
      const { calls, fetchImpl } = stubFetch(() => okBytes());
      const response = await servePublishedMedia(path, fetchImpl);
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
    }
  });
});

describe("upstream header construction", () => {
  it("sends apikey always, no Authorization for publishable keys, exact URL, no-store, timeout", async () => {
    const { calls, fetchImpl } = stubFetch(() => okBytes());
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(UPSTREAM_JPG);
    expect(call.url).not.toContain(PUBLISHABLE_KEY);
    expect(call.init?.method).toBe("GET");
    expect(call.init?.cache).toBe("no-store");
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    // The ~8s abort duration (AbortSignal.timeout) is deliberately not
    // asserted: it is not observable through the public AbortSignal
    // API without fake timers, so only signal presence is assertable
    // here. The duration stays a code-reading fact, not a test claim.
    // Exactly one header: nothing else (no Cookie, no Content-Type)
    // is forwarded or invented.
    expect(call.init?.headers).toEqual({ apikey: PUBLISHABLE_KEY });
  });

  it("sends Authorization Bearer only when the key is a JWT", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", JWT_KEY);
    const { calls, fetchImpl } = stubFetch(() => okBytes());
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
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
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(calls).toHaveLength(0);
  });

  it("returns 404 with no fetch when the URL is not the expected project ref", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.invalid");
    const { calls, fetchImpl } = stubFetch(() => okBytes());
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("returns 404 with no fetch when the JWT role is not anon", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", jwtKey("authenticated"));
    const { calls, fetchImpl } = stubFetch(() => okBytes());
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe("content-type allowlist", () => {
  it("serves the type derived from the extension, not the upstream type", async () => {
    const { fetchImpl } = stubFetch(() => okBytes("bytes", "image/png"));
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("serves png and webp with their own types", async () => {
    const png = await servePublishedMedia(
      PATH_PNG,
      stubFetch(() => okBytes("bytes", "image/png")).fetchImpl,
    );
    expect(png.headers.get("content-type")).toBe("image/png");
    const webp = await servePublishedMedia(
      PATH_WEBP,
      stubFetch(() => okBytes("bytes", "image/webp")).fetchImpl,
    );
    expect(webp.headers.get("content-type")).toBe("image/webp");
  });

  it("accepts an allowlisted media type with parameters", async () => {
    const { fetchImpl } = stubFetch(() =>
      okBytes("bytes", "image/jpeg; charset=binary"),
    );
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it.each(["text/html", "image/svg+xml", "application/octet-stream"])(
    "returns an empty no-store 502 for upstream type %s",
    async (contentType) => {
      const { fetchImpl } = stubFetch(() => okBytes("evil", contentType));
      const response = await servePublishedMedia(PATH_JPG, fetchImpl);
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("returns 502 when upstream sends no content type", async () => {
    const upstream = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: new Headers(),
    });
    expect(upstream.headers.get("content-type")).toBe(null);
    const { fetchImpl } = stubFetch(() => upstream);
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("");
  });
});

describe("error mapping and success headers", () => {
  it.each([400, 401, 403, 404, 405, 429])(
    "maps upstream %s to an empty no-store 404",
    async (status) => {
      const { fetchImpl } = stubFetch(() => upstreamError(status));
      const response = await servePublishedMedia(PATH_JPG, fetchImpl);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it.each([500, 502, 503])(
    "maps upstream %s to an empty no-store 502",
    async (status) => {
      const { fetchImpl } = stubFetch(() => upstreamError(status));
      const response = await servePublishedMedia(PATH_JPG, fetchImpl);
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("maps a thrown fetch (network/timeout) to an empty no-store 502", async () => {
    const { fetchImpl } = stubFetch(() => {
      throw new Error("offline");
    });
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves success with the 60s cache bound, inline disposition and nosniff", async () => {
    const { fetchImpl } = stubFetch(() => okBytes("bytes", "image/jpeg", "5"));
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe("5");
    expect(await response.text()).toBe("bytes");
  });

  it("streams the upstream body without buffering (same stream object)", async () => {
    const upstream = okBytes("streamed-bytes");
    const { fetchImpl } = stubFetch(() => upstream);
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(response.body).toBe(upstream.body);
    expect(await response.text()).toBe("streamed-bytes");
  });
});

describe("size guard", () => {
  it("returns 502 when upstream reports more than the 5 MiB bucket limit", async () => {
    const { fetchImpl } = stubFetch(() =>
      okBytes("x", "image/jpeg", "5242881"),
    );
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("");
  });

  it("serves exactly at the limit and forwards the length", async () => {
    const { fetchImpl } = stubFetch(() =>
      okBytes("x", "image/jpeg", "5242880"),
    );
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("5242880");
  });

  it("serves without a length header when upstream sends none", async () => {
    const upstream = new Response("bytes", {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
    expect(upstream.headers.get("content-length")).toBe(null);
    const { fetchImpl } = stubFetch(() => upstream);
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(null);
  });

  it("returns 502 for an unparseable length header", async () => {
    const { fetchImpl } = stubFetch(() =>
      okBytes("x", "image/jpeg", "not-a-number"),
    );
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(502);
  });

  it("returns 502 for a negative length header", async () => {
    const { fetchImpl } = stubFetch(() =>
      okBytes("x", "image/jpeg", "-5"),
    );
    const response = await servePublishedMedia(PATH_JPG, fetchImpl);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("");
  });

  it.each([
    ["1e3", "1000"],
    ["0x10", "16"],
  ])(
    "serves non-decimal-but-numeric length %s as normalized decimal %s",
    async (upstreamLength, servedLength) => {
      const { fetchImpl } = stubFetch(() =>
        okBytes("x", "image/jpeg", upstreamLength),
      );
      const response = await servePublishedMedia(PATH_JPG, fetchImpl);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe(servedLength);
    },
  );
});

describe("no secret leakage", () => {
  it("never puts the key in a response body or header, on success or denial", async () => {
    const success = await servePublishedMedia(
      PATH_JPG,
      stubFetch(() => okBytes("bytes")).fetchImpl,
    );
    expect(await success.text()).not.toContain(PUBLISHABLE_KEY);
    for (const value of success.headers.values()) {
      expect(value).not.toContain(PUBLISHABLE_KEY);
    }
    const denied = await servePublishedMedia(
      PATH_JPG,
      stubFetch(() => upstreamError(403)).fetchImpl,
    );
    expect(await denied.text()).not.toContain(PUBLISHABLE_KEY);
    for (const value of denied.headers.values()) {
      expect(value).not.toContain(PUBLISHABLE_KEY);
    }
  });

  it("never puts a JWT key in a response body or header", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", JWT_KEY);
    const success = await servePublishedMedia(
      PATH_JPG,
      stubFetch(() => okBytes("bytes")).fetchImpl,
    );
    expect(await success.text()).not.toContain(JWT_KEY);
    for (const value of success.headers.values()) {
      expect(value).not.toContain(JWT_KEY);
    }
  });

  it("logs path + status-kind only, never keys", async () => {
    await servePublishedMedia(
      PATH_JPG,
      stubFetch(() => upstreamError(403)).fetchImpl,
    );
    await servePublishedMedia(
      "bogus-path",
      stubFetch(() => okBytes()).fetchImpl,
    );
    const logged = errorSpy.mock.calls
      .flat()
      .map((arg: unknown) => String(arg))
      .join("\n");
    expect(logged).toContain("[attiresarena:published-media]");
    expect(logged).toContain(PATH_JPG);
    expect(logged).toContain("http-403");
    expect(logged).not.toContain(PUBLISHABLE_KEY);
    expect(logged).not.toContain(JWT_KEY);
  });

  it("strips control characters from the logged path", async () => {
    await servePublishedMedia(
      "bogus\npath\rwith\u0000controls",
      stubFetch(() => okBytes()).fetchImpl,
    );
    const logged = errorSpy.mock.calls
      .flat()
      .map((arg: unknown) => String(arg))
      .join("\n");
    // No raw control character from the input path may reach the log
    // (log-forging defense); the sanitized path is logged instead.
    expect(logged).not.toContain("bogus\npath");
    expect(logged).not.toContain("\r");
    expect(logged).not.toContain("\u0000");
    expect(logged).toContain("boguspathwithcontrols");
  });
});

describe("grep pins: no stale delivery references in src", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(join(root, dir))) {
      const p = `${dir}/${entry}`;
      if (statSync(join(root, p)).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
    }
    return out;
  }

  it("has zero references to the old delivery path anywhere in src", () => {
    // The old names/strings must not survive in code OR comments: a
    // future reader must not "restore" the broken design from them.
    // (These literals live in this test file only, under tests/.)
    const forbidden = [
      "object/public",
      "getPublicUrl",
      "publishedMediaPublicUrl",
      "isSupabaseStoragePublicUrl",
    ];
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const source = readFileSync(join(root, file), "utf8");
      for (const needle of forbidden) {
        if (source.includes(needle)) offenders.push(`${file}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no privileged-key references in the new/changed delivery files", () => {
    // Scoped to the delivery files on purpose: pre-existing admin
    // code elsewhere in src legitimately names the key it lacks.
    const files = [
      "src/app/api/product-media/[owner]/[file]/route.ts",
      "src/lib/published-media-delivery.ts",
      "src/lib/catalog-publication.ts",
      "src/components/ui/SmartImage.tsx",
      "src/services/adapters/published-thrift.ts",
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
