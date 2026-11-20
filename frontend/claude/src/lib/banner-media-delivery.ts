import "server-only";
import { PRODUCT_MEDIA_BUCKET } from "@/lib/admin/constants";
import {
  MAX_IMAGE_BYTES,
} from "@/lib/admin/catalog-variants";
import { publicSupabaseConfiguration } from "@/lib/supabase-public";
import { BANNER_STORAGE_PATH_PATTERN } from "@/lib/store-settings";

/**
 * Visible-banner image delivery.
 *
 * Banner images live in the same private bucket as product photos,
 * under the `banners/` prefix, and reach browsers through the
 * anonymous route app/api/banner-media/[file], which calls
 * serveBannerMedia below. The helper fetches bytes server-side from
 * the Storage endpoint that evaluates access policies, using the
 * existing public anon configuration — the same credential shape the
 * storefront feed reads use. The applied visible-banner-only SELECT
 * policy (migration 20261119000300, definer function
 * is_visible_banner_media) re-checks, per request, that the object
 * is linked to a banner that is currently visible; hidden banners,
 * unlinked objects, and anything outside the banners/ prefix are
 * denied by the database and surface here as 404. Until that
 * migration is applied there is no anon policy for banners/ objects,
 * so every banner image 404s here — and the homepage probe
 * (resolveBannerImageUrls) skips those banners, so the storefront
 * keeps its static slides instead of showing broken images. The
 * bucket's public URL endpoint never evaluates policies and cannot
 * serve a private bucket, so it is never used.
 *
 * Defense in depth, in order: (1) the storage-path shape is
 * validated BEFORE any config read or fetch; (2) the database policy
 * re-checks visibility per request; (3) the upstream content type
 * must be in the image allowlist and the served type is derived from
 * the validated extension only; (4) errors are normalized so nothing
 * about existence, configuration, or upstream state leaks. The route
 * adds transport only: it cannot serve anything an anonymous Storage
 * request could not already obtain through the policy-evaluating
 * endpoint, because <img> tags cannot send Authorization headers.
 *
 * No credential beyond the public anon configuration is used, no
 * request data (cookies, headers, query) is ever forwarded, and no
 * image bytes are buffered: the upstream body streams straight
 * through.
 */

/** Stable server-log prefix for delivery failures (path + reason only). */
export const BANNER_MEDIA_DIAGNOSTIC_PREFIX = "[attiresarena:banner-media]";

/** Success cache bound: a holder of a direct URL may receive a cached copy for at most 60s after a banner is hidden. No stale-while-revalidate. */
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

function logFailure(storagePath: string, reason: string): void {
  // Path (truncated: invalid input can be arbitrarily long; control
  // characters stripped so attacker input cannot forge log lines)
  // + status kind only — never keys, bodies, or row contents.
  const safePath = storagePath
    .slice(0, 200)
    .replace(/[\u0000-\u001f\u007f]/g, "");
  console.error(`${BANNER_MEDIA_DIAGNOSTIC_PREFIX} ${safePath} ${reason}`);
}

function emptyResponse(status: number): Response {
  // Denials and upstream failures are never cached: a banner that
  // later becomes visible must become loadable immediately.
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Serve one visible banner image, or a normalized empty error.
 * `storagePath` is the `banners/<uuid>.<ext>` path from the banner row.
 * `fetchImpl` exists for tests; production always uses global fetch.
 *
 * Error mapping: invalid path shape, unconfigured Supabase, or an
 * upstream 4xx (denied or missing) -> 404; upstream 5xx, network
 * error, or timeout -> 502. Bodies are always empty on errors.
 */
export async function serveBannerMedia(
  storagePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  // Cheap condition first: reject everything that is not a banner
  // image path before any config read or network call. This single
  // rule rejects traversal, extra segments, wrong extensions,
  // uppercase hex, product/brand prefixes, and over-long input.
  if (!BANNER_STORAGE_PATH_PATTERN.test(storagePath)) {
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
  const file = storagePath.slice("banners/".length);
  if (!file) {
    // Unreachable: the path check above guarantees a file segment.
    logFailure(storagePath, "invalid-path");
    return emptyResponse(404);
  }

  const configuration = publicSupabaseConfiguration();
  if (!configuration) {
    logFailure(storagePath, "not-configured");
    return emptyResponse(404);
  }

  const upstreamUrl =
    `${configuration.url}/storage/v1/object/authenticated/` +
    `${PRODUCT_MEDIA_BUCKET}/banners/${encodeURIComponent(file)}`;
  let upstream: Response;
  try {
    upstream = await fetchImpl(upstreamUrl, {
      method: "GET",
      headers: {
        apikey: configuration.key,
        // Mirror the feed reads exactly: Bearer only for JWT keys.
        ...(configuration.key.startsWith("eyJ")
          ? { Authorization: `Bearer ${configuration.key}` }
          : {}),
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
