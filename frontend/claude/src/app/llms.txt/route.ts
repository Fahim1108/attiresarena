import { llmsResponse } from "@/lib/llms";

/**
 * Live llms.txt (AI-search discovery file). Dynamic on purpose: it must
 * reflect the stored indexing toggle and the live catalogue on every
 * fetch. Preview/dev or indexing off serves a minimal no-content
 * response; production + indexing on lists the real published
 * catalogue. See src/lib/llms.ts for the shared loader (llms-full.txt
 * shares it with full: true).
 */
// The route must re-evaluate per request; the feed/settings reads are
// cache:"no-store", and this flag keeps Next from serving a build-time copy.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return llmsResponse(false);
}
