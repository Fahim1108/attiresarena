import "server-only";
import { PRODUCT_MEDIA_BUCKET } from "@/lib/admin/constants";
import {
  MAX_IMAGE_BYTES,
  isCatalogStoragePath,
} from "@/lib/admin/catalog-variants";
import { publicSupabaseConfiguration } from "@/lib/supabase-public";

/**
 * Published product-photo delivery (Approach B).
 *
 * The drafts bucket stays private. Published photos reach browsers
 * through the anonymous route app/api/product-media/[owner]/[file],
 * which calls servePublishedMedia below. The helper fetches bytes
 * server-side from the Storage endpoint that evaluates access
 * policies, using the existing public anon configuration — the same
 * credential shape the storefront feed reads use. The applied
 * published-only SELECT policy (migration 20261115000800, definer
 * function is_published_admin_product_media) re-checks, per request,
 * that the object is linked to a product that is currently published;
 * drafts, unlinked objects, and unpublished products are denied by
 * the database and surface here as 404. The bucket's public URL
 * endpoint never evaluates policies and cannot serve a private
 * bucket, so it is never used.
 *
 * Defense in depth, in order: (1) the storage-path shape is
 * validated BEFORE any config read or fetch; (2) the database policy
 * re-checks publication per request; (3) the upstream content type
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
 * through. No pre-check RPC call is made in this build: production
 * promotion is gated instead on inspecting the orphan policy
 * `product_media_published_bytes` (check `pg_policies` for
 * `storage.objects` and confirm it is no broader than
 * published-only) plus live negative tests (draft, unlinked, and
 * unpublished paths must all 404).
 */

/** Stable server-log prefix for delivery failures (path + reason only). */
export const MEDIA_DIAGNOSTIC_PREFIX = "[attiresarena:published-media]";

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

function logFailure(storagePath: string, reason: string): void {
  // Path (truncated: invalid input can be arbitrarily long; control
  // characters stripped so attacker input cannot forge log lines)
  // + status kind only — never keys, bodies, or row contents.
  const safePath = storagePath
    .slice(0, 200)
    .replace(/[\u0000-\u001f\u007f]/g, "");
  console.error(`${MEDIA_DIAGNOSTIC_PREFIX} ${safePath} ${reason}`);
}

function emptyResponse(status: number): Response {
  // Denials and upstream failures are never cached: a draft that later
  // publishes must become loadable immediately.
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Serve one published product image, or a normalized empty error.
 * `storagePath` is the `<owner>/<object>` pair from the route params.
 * `fetchImpl` exists for tests; production always uses global fetch.
 *
 * Error mapping: invalid path shape, unconfigured Supabase, or an
 * upstream 4xx (denied or missing) -> 404; upstream 5xx, network
 * error, or timeout -> 502. Bodies are always empty on errors.
 */
export async function servePublishedMedia(
  storagePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  // Cheap condition first: reject everything that is not a
  // product-media path before any config read or network call. This
  // single rule rejects traversal, extra segments, wrong extensions,
  // uppercase hex, banners/brand prefixes, and over-long input.
  if (!isCatalogStoragePath(storagePath)) {
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
  const [owner, object] = storagePath.split("/");
  if (!owner || !object) {
    // Unreachable: the path check above guarantees both segments.
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
    `${PRODUCT_MEDIA_BUCKET}/${encodeURIComponent(owner)}/${encodeURIComponent(object)}`;
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
