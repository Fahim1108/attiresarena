import Link from "next/link";
import { StatusBadge, Notice } from "@/components/admin/ui";
import { ConfirmSubmit } from "@/components/admin/ui-client";
import { ContentBlockForm } from "@/components/admin/content/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";
import {
  MANAGED_BLOCKS,
  deleteContentBlock,
  getContentBlocks,
  saveContentBlock,
} from "@/lib/admin/content";

export default async function ContentPagesPage() {
  const blocks = await getContentBlocks();
  const bySlug = new Map((blocks ?? []).map((block) => [block.slug, block]));

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Pages"
          description="Informational page text. Saved blocks apply on the next page load where the page is wired."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Content
          </p>
        </PageHeader>
        <Notice kind="info">
          Privacy, Terms, Return and Shipping overrides apply on the next page
          load. The About block is stored but the About page is hard-coded, so
          its override does not render yet. Contact details are edited under{" "}
          <Link href="/admin/settings/store">Store Settings</Link>.
        </Notice>
        {blocks === null ? (
          <Notice kind="warning">
            Content blocks could not be loaded. Try again later.
          </Notice>
        ) : null}
        {MANAGED_BLOCKS.map((managed) => {
          const block = bySlug.get(managed.slug);
          return (
            <Card key={managed.slug}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle headingLevel="h2">{managed.label}</CardTitle>
                  <CardDescription className="mt-1">
                    {`Storefront page: ${managed.storefront}`}
                  </CardDescription>
                </div>
                <StatusBadge tone={managed.wired ? "success" : "warning"}>
                  {managed.wired ? "Wired — applies on next load" : "Stored only — page not wired"}
                </StatusBadge>
              </CardHeader>
              <CardContent>
                <ContentBlockForm
                  action={saveContentBlock}
                  block={block}
                  slug={managed.slug}
                  slugLocked
                />
                {block ? (
                  <div className="mt-4">
                    <ConfirmSubmit
                      action={deleteContentBlock}
                      fields={{ slug: managed.slug }}
                      buttonLabel="Delete saved block"
                      confirmTitle="Delete this content block?"
                      confirmBody="The saved override is removed and the page returns to its built-in text."
                      confirmLabel="Delete block"
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
