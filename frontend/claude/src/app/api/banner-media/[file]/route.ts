import { serveBannerMedia } from "@/lib/banner-media-delivery";

/**
 * Anonymous visible-banner image delivery. Thin handler only: it
 * takes the file segment, joins it into a `banners/` storage path,
 * and returns the delivery helper's Response. No other request data
 * is read — query strings, headers, and cookies are all ignored.
 * Only GET is exported; other write methods get an automatic 405,
 * HEAD is served via GET, and OPTIONS gets an automatic Allow
 * response. Hidden or unlinked banner images 404 by database policy.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  return serveBannerMedia(`banners/${file}`);
}
