import "server-only";
import { publicSupabaseConfiguration } from "@/lib/supabase-public";

/**
 * Approved review-photo delivery (client feedback item 19).
 *
 * Mirrors published-media-delivery (Approach B): the review-photos
 * bucket stays private. Approved photos reach browsers through the
 * anonymous route app/api/review-photos/[owner]/[file], which calls
 * serveReviewPhoto below. The helper fetches bytes server-side from
 * the Storage endpoint that evaluates access policies, using the
 * existing public anon configuration. The applied approved-only
 * SELECT policy (migration 20261124000300, definer function
 * is_approved_review_photo) re-checks, per request, that the object
 * is linked to an approved review's photo on a published product;
 * pending/rejected photos, unlinked objects, and unpublished
 * products are denied by the database and surface here as 404.
 *
 * Defense in depth, in order: (1) the storage-path shape is
 * validated BEFORE any config read or network call; (2) the database
 * policy re-checks approval per request; (3) the upstream content
 * type must be in the image allowlist and the served type is derived
 * from the validated extension only; (4) errors are normalized so
 * nothing about existence, configuration, or upstream state leaks.
 * No credential beyond the public anon configuration is used, no
 * request data (cookies, headers, query) is ever forwarded, and no
 * image bytes are buffered: the upstream body streams straight
 * through.
 */

import { REVIEW_PHOTO_BUCKET } from "./customer/review-photos";

/** Stable server-log prefix for delivery failures (path + reason only). */
export const REVIEW_PHOTO_DIAGNOSTIC_PREFIX =
  "[attiresarena:review-photo]";

/** Success cache bound: a holder of a direct URL may receive a cached copy for at most 60s after unpublish. No stale-while-revalidate. */
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

/** Review-photo bytes are capped at 5 MB, same as the bucket limit. */
const MAX_REVIEW_PHOTO_BYTES = 5 * 1024 * 1024;

function logFailure(storagePath: string, reason: string): void {
  const safePath = storagePath
    .slice(0, 200)
    .replace(/[\u0000-\u001f\u007f]/g, "");
  console.error(`${REVIEW_PHOTO_DIAGNOSTIC_PREFIX} ${safePath} ${reason}`);
}

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Serve one approved review photo, or a normalized empty error.
 * `storagePath` is the `<owner>/<object>` pair from the route params.
 * `fetchImpl` exists for tests; production always uses global fetch.
 *
 * Error mapping: invalid path shape, unconfigured Supabase, or an
 * upstream 4xx (denied or missing) -> 404; upstream 5xx, network
 * error, or timeout -> 502. Bodies are always empty on errors.
 */
export async function serveReviewPhoto(
  storagePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  // Cheap condition first: reject everything that is not a
  // review-photo path before any config read or network call. This
  // single rule rejects traversal, extra segments, wrong extensions,
  // uppercase hex, and over-long input.
  if (
    storagePath.length > 200 ||
    !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(storagePath)
  ) {
    logFailure(storagePath, "invalid-path");
    return emptyResponse(404);
  }
  const extension = storagePath.slice(storagePath.lastIndexOf(".") + 1);
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension];
  if (!contentType) {
    logFailure(storagePath, "invalid-path");
    return emptyResponse(404);
  }
  const [owner, object] = storagePath.split("/");
  if (!owner || !object) {
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
    `${REVIEW_PHOTO_BUCKET}/${encodeURIComponent(owner)}/${encodeURIComponent(object)}`;
  let upstream: Response;
  try {
    upstream = await fetchImpl(upstreamUrl, {
      method: "GET",
      headers: {
        apikey: configuration.key,
        // Mirror the feed reads exactly: Bearer <redacted> for JWT keys.
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
      length > MAX_REVIEW_PHOTO_BYTES
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
