import { serveBrandMedia } from "@/lib/brand-media-delivery";

/**
 * Brand-image delivery (logo / favicon). Thin handler only: it awaits
 * the route param, joins it into the `brand/<file>` storage path, and
 * returns the delivery helper's Response. No other request data is
 * read — query strings, headers, and cookies are all ignored. Only
 * GET is exported; other write methods get an automatic 405, HEAD is
 * served via GET, and OPTIONS gets an automatic Allow response.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  return serveBrandMedia(`brand/${file}`);
}
