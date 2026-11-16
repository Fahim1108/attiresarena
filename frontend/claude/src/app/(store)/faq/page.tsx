import type { Metadata } from "next";
import { logo, site } from "@/config";
import { HelpAside, InfoHeader } from "@/components/info/InfoPage";
import { FaqJsonLd } from "@/components/seo/JsonLd";
import { Accordion } from "@/components/ui";
import { faqs } from "@/content/policies";
import { getStorefrontContent } from "@/lib/store-settings";
import { buildPageMetadata, resolveDefaultOgImage, resolveTwitterCard } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getStorefrontContent();
  return buildPageMetadata({
    siteName: site.name,
    path: "/faq",
    title: "FAQ",
    // Description reuses the page's own intro copy verbatim.
    description: "Quick answers about orders, delivery, returns and sizing.",
    defaultImage: resolveDefaultOgImage(content?.settings, logo.badge, site.name),
    twitterCard: resolveTwitterCard(content?.settings) ?? "summary_large_image",
  });
}

export default function FaqPage() {
  return (
    <>
      <FaqJsonLd />
      <InfoHeader title="Frequently Asked Questions" eyebrow="Help Centre" intro="Quick answers about orders, delivery, returns and sizing." />
      <div className="container grid gap-10 py-10 lg:grid-cols-[1fr_300px]">
        <div className="max-w-3xl space-y-10">
          {faqs.map((group) => (
            <section key={group.category}>
              <h2 className="mb-2 font-serif text-2xl text-ink sm:text-3xl">{group.category}</h2>
              <Accordion items={group.items.map((f, i) => ({ id: `${group.category}-${i}`, title: f.q, content: <p>{f.a}</p> }))} allowMultiple={false} />
            </section>
          ))}
        </div>
        <HelpAside />
      </div>
    </>
  );
}
