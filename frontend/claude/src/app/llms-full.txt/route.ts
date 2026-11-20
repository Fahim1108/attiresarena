import { llmsResponse } from "@/lib/llms";

/**
 * Live llms-full.txt: the full AI-search discovery file — same gating,
 * same feed, and same minimal off-state as /llms.txt, plus each
 * product's real description line. See src/lib/llms.ts for the shared
 * loader.
 */
// The route must re-evaluate per request; the feed/settings reads are
// cache:"no-store", and this flag keeps Next from serving a build-time copy.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return llmsResponse(true);
}
