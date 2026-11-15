import Image, { type ImageProps } from "next/image";

/**
 * Supabase Storage public-object URLs (built by the published-admin
 * projector in lib/catalog-publication.ts) must bypass the image
 * optimizer: next.config has no remotePatterns entry for Supabase
 * hosts, so the optimizer rejects them (HTTP 400 in production, a
 * thrown "not configured" error in development) and admin-published
 * product photos would never render on the storefront. Served as-is,
 * exactly like the admin side's deliberately unoptimized signed URLs.
 *
 * Only the exact Storage public-object shape matches; every other
 * remote URL still goes through the optimizer and still fails closed
 * per next.config. Adding the Supabase host to remotePatterns remains
 * the preferred long-term fix (coordinator-owned config); this keeps
 * the gallery working without a config change.
 */
const SUPABASE_STORAGE_PUBLIC_URL =
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\//;

export function isSupabaseStoragePublicUrl(src: string): boolean {
  return SUPABASE_STORAGE_PUBLIC_URL.test(src);
}

/**
 * Wrapper around next/image. Local SVG placeholders are served unoptimized;
 * raster images (real product photography) go through the image optimizer,
 * except Supabase Storage public URLs (see above).
 */
export function SmartImage(props: ImageProps) {
  const src = typeof props.src === "string" ? props.src : "";
  const unoptimized =
    props.unoptimized ??
    (src.endsWith(".svg") || isSupabaseStoragePublicUrl(src));
  // eslint-disable-next-line jsx-a11y/alt-text -- alt is passed through props
  return <Image {...props} unoptimized={unoptimized} />;
}
