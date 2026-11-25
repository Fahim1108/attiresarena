import { serveReviewPhoto } from "@/lib/review-photo-delivery";

/**
 * Approved review-photo delivery. Thin handler only: it awaits
 * the route params, joins them into a storage path, and returns the
 * delivery helper's Response. No other request data is read — query
 * strings, headers, and cookies are all ignored. Only GET is
 * exported; other write methods get an automatic 405, HEAD is
 * served via GET, and OPTIONS gets an automatic Allow response.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ owner: string; file: string }> },
): Promise<Response> {
  const { owner, file } = await params;
  return serveReviewPhoto(`${owner}/${file}`);
}
