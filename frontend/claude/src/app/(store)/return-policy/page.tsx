import type { Metadata } from "next";
import { logo, site } from "@/config";
import { HelpAside, PolicyArticle } from "@/components/info/InfoPage";
import { buildPageMetadata, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";
import { policyPages } from "@/content/policies";
import { getStorefrontContent, getVisibleContentBlocks, resolvePolicyPage } from "@/lib/store-settings";

const page = policyPages["return-policy"]!;

export async function generateMetadata(): Promise<Metadata> {
  const content = await getStorefrontContent();
  return buildPageMetadata({ siteName: site.name, path: "/return-policy", title: page.title, description: page.intro, defaultImage: resolveDefaultOgImage(content?.settings, logo.badge, site.name), twitterCard: resolveTwitterCard(content?.settings) ?? "summary_large_image" });
}

export default async function Page() {
  // Fallback-safe: without a visible stored block this renders the static
  // page exactly as before.
  const resolved = resolvePolicyPage(page, await getVisibleContentBlocks());
  return <PolicyArticle page={resolved} aside={<HelpAside />} />;
}
