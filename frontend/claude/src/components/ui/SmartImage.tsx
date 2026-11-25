import Image, { type ImageProps } from "next/image";

/**
 * Same-origin published-media URLs (built by the published-admin
 * projector in lib/catalog-publication.ts, served by the
 * app/api/product-media route) must bypass the image optimizer: the
 * route already serves original product photography with its own
 * cache policy, and routing those bytes through the optimizer would
 * add a second hop (optimizer -> delivery route -> Storage) plus a
 * second cache layer over policy-gated bytes, for no benefit.
 * Served as-is, exactly like the admin side's deliberately
 * unoptimized signed URLs.
 *
 * Only the exact delivery-route prefix matches; every other remote
 * URL still goes through the optimizer and still fails closed per
 * next.config. Local raster photos stay optimized; local SVGs stay
 * unoptimized via the extension check below.
 */
const PUBLISHED_MEDIA_URL = /^\/api\/product-media\//;
const REVIEW_PHOTO_URL = /^\/api\/review-photos\//;

export function isPublishedMediaUrl(src: string): boolean {
  return PUBLISHED_MEDIA_URL.test(src);
}

/** Same bypass as product media: the delivery route serves original bytes with its own cache policy. */
export function isReviewPhotoUrl(src: string): boolean {
  return REVIEW_PHOTO_URL.test(src);
}

/**
 * Wrapper around next/image. Local SVG placeholders are served unoptimized;
 * raster images (real product photography) go through the image optimizer,
 * except published-media delivery URLs (see above).
 */
export function SmartImage(props: ImageProps) {
  const src = typeof props.src === "string" ? props.src : "";
  const unoptimized =
    props.unoptimized ??
    (src.endsWith(".svg") || isPublishedMediaUrl(src) || isReviewPhotoUrl(src));
  // eslint-disable-next-line jsx-a11y/alt-text -- alt is passed through props
  return <Image {...props} unoptimized={unoptimized} />;
}
