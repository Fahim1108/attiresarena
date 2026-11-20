import "server-only";

import projects from "@/config/supabase-projects.json";
import { MAX_IMAGE_BYTES } from "@/lib/admin/catalog-variants";
import { PRODUCT_MEDIA_BUCKET } from "@/lib/admin/constants";
import { isProductionStorefront } from "./storefront-policy";

/**
 * Brand-image delivery (logo / favicon).
 *
 * Brand images are uploaded by owners through the admin theme page into
 * the private bucket under `brand/` (see uploadStorageImage in
 * lib/admin/settings). They are public brand assets — the logo and the
 * favicon are meant to be seen by every visitor — but the bucket stays
 * private and no anonymous Storage policy reads `brand/` objects, so
 * the product-media route (anonymous + published-only policy) cannot
 * serve them: it would 404 every brand image.
 *
 * Delivery therefore mirrors the product-media pattern with one
 * deliberate difference: the upstream fetch authenticates with the
 * server-only service-role key instead of the anonymous key. The
 * route adds transport only, and the path allowlist below is the
 * access control: only `brand/<uuid>.<ext>` paths are ever fetched,
 * so the key can never serve a draft product photo, a banner, or any
 * other object. No credential beyond the service key is used, no
 * request data (cookies, headers, query) is ever forwarded, and no
 * image bytes are buffered: the upstream body streams straight
 * through. `env` exists for testability (pure given an env record);
 * production code uses process.env.
 *
 * No public bucket is created and no Storage policy changes: if the
 * service key is unset or the project URL does not match the pinned
 * project for this environment, delivery fails closed (404) and the
 * storefront keeps its static brand files.
 */

/** Stable server-log prefix for delivery failures (path + reason only). */
export const BRAND_MEDIA_DIAGNOSTIC_PREFIX = "[attiresarena:brand-media]";

/** Success cache bound: a holder of a direct URL may receive a cached copy for at most 60s after the image is replaced. No stale-while-revalidate. */
const SUCCESS_CACHE_CONTROL = "public, max-age=60";

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const ALLOWED_UPSTREAM_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Stored brand-image paths are always `brand/<object-uuid>.<ext>`.
 * A path that does not match is never trusted as a storage reference.
 */
export const BRAND_STORAGE_PATH_PATTERN =
  /^brand\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function isBrandStoragePath(path: string): boolean {
  return path.length <= 200 && BRAND_STORAGE_PATH_PATTERN.test(path);
}

/**
 * Same-origin route URL for a stored brand image, or null when the
 * value is not a brand-image path. The route streams the bytes, so
 * next/image needs no remotePatterns entry for the Storage host.
 */
export function brandMediaUrl(
  storagePath: string | null | undefined,
): string | null {
  if (!storagePath || !isBrandStoragePath(storagePath)) return null;
  const file = storagePath.slice("brand/".length);
  return `/api/brand-media/${encodeURIComponent(file)}`;
}

export interface BrandMediaConfiguration {
  url: string;
  serviceKey: string;
}

/**
 * Server-only service-role configuration for brand delivery. Fails
 * closed (null) unless the URL matches the pinned project for this
 * environment and the service key is a real key (at least 20 chars,
 * different from the publishable key) — the same guards the checkout
 * configuration uses.
 */
export function brandMediaConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): BrandMediaConfiguration | null {
  const url = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL)?.replace(
    /\/$/,
    "",
  );
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (serviceKey.length < 20) return null;
  if (serviceKey === env.SUPABASE_PUBLISHABLE_KEY) return null;
  const ref = isProductionStorefront()
    ? projects.production
    : projects.staging;
  if (url !== `https://${ref}.supabase.co`) return null;
  return { url, serviceKey };
}

function logFailure(storagePath: string, reason: string): void {
  // Path (truncated: invalid input can be arbitrarily long; control
  // characters stripped so attacker input cannot forge log lines)
  // + status kind only — never keys, bodies, or row contents.
  console.error(
    `${BRAND_MEDIA_DIAGNOSTIC_PREFIX} ${storagePath
      .slice(0, 200)
      .replace(/[\u0000-\u001f\u007f]/g, "")} ${reason}`,
  );
}

function emptyResponse(status: number): Response {
  // Denials and upstream failures are never cached: a replaced logo
  // must become loadable immediately.
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Serve one stored brand image, or a normalized empty error.
 * `storagePath` is the full `brand/<file>` path from the setting.
 * `fetchImpl` exists for tests; production always uses global fetch.
 *
 * Error mapping: invalid path shape, unconfigured service key, or an
 * upstream 4xx (denied or missing) -> 404; upstream 5xx, network
 * error, or timeout -> 502. Bodies are always empty on errors.
 */
export async function serveBrandMedia(
  storagePath: string,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  // Cheap condition first: reject everything that is not a brand path
  // before any config read or network call. This single rule rejects
  // traversal, extra segments, wrong extensions, uppercase hex, and
  // product/banner paths.
  if (!isBrandStoragePath(storagePath)) {
    logFailure(storagePath, "invalid-path");
    return emptyResponse(404);
  }
  const extension = storagePath.slice(storagePath.lastIndexOf(".") + 1);
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension];
  if (!contentType) {
    // Unreachable: the path check above admits only jpg/png/webp.
    logFailure(storagePath, "invalid-path");
    return emptyResponse(404);
  }
  const file = storagePath.slice("brand/".length);

  const configuration = brandMediaConfiguration(env);
  if (!configuration) {
    logFailure(storagePath, "not-configured");
    return emptyResponse(404);
  }

  const upstreamUrl =
    `${configuration.url}/storage/v1/object/authenticated/` +
    `${PRODUCT_MEDIA_BUCKET}/brand/${encodeURIComponent(file)}`;
  let upstream: Response;
  try {
    upstream = await fetchImpl(upstreamUrl, {
      method: "GET",
      headers: {
        apikey: configuration.serviceKey,
        Authorization: `Bearer ${configuration.serviceKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    logFailure(storagePath, "request-failed");
    return emptyResponse(502);
  }

  if (!upstream.ok) {
    const reason = `http-${upstream.status}`;
    logFailure(storagePath, reason);
    return emptyResponse(upstream.status >= 500 ? 502 : 404);
  }

  // The served type comes from the validated extension only; the
  // upstream type must independently be in the allowlist.
  const upstreamType =
    upstream.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() ?? "";
  if (!ALLOWED_UPSTREAM_TYPES.has(upstreamType)) {
    logFailure(storagePath, "invalid-content-type");
    return emptyResponse(502);
  }

  const lengthHeader = upstream.headers.get("content-length");
  let contentLength: string | undefined;
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_IMAGE_BYTES
    ) {
      logFailure(storagePath, "oversize");
      return emptyResponse(502);
    }
    contentLength = String(length);
  }

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": SUCCESS_CACHE_CONTROL,
  };
  if (contentLength !== undefined) headers["Content-Length"] = contentLength;
  // Stream the upstream body directly — no buffering of image bytes.
  return new Response(upstream.body, { status: 200, headers });
}
