import type { Metadata } from "next";
import { HelpAside, PolicyArticle } from "@/components/info/InfoPage";
import { policyPages } from "@/content/policies";
import { getVisibleContentBlocks, resolvePolicyPage } from "@/lib/store-settings";

const page = policyPages["privacy-policy"]!;

export const metadata: Metadata = { title: page.title, description: page.intro };

export default async function Page() {
  // Fallback-safe: without a visible stored block this renders the static
  // page exactly as before.
  const resolved = resolvePolicyPage(page, await getVisibleContentBlocks());
  return <PolicyArticle page={resolved} aside={<HelpAside />} />;
}
