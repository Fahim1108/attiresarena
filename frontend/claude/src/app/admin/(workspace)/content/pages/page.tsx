import Link from "next/link";
import { PageHeading, Panel, StatusBadge, Notice } from "@/components/admin/ui";
import { ConfirmSubmit } from "@/components/admin/ui-client";
import { ContentBlockForm } from "@/components/admin/content/forms";
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
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Content"
        title="Pages"
        description="Informational page text. Saved blocks apply on the next page load where the page is wired."
      />
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
          <Panel
            key={managed.slug}
            title={managed.label}
            description={`Storefront page: ${managed.storefront}`}
            actions={
              <StatusBadge tone={managed.wired ? "success" : "warning"}>
                {managed.wired ? "Wired — applies on next load" : "Stored only — page not wired"}
              </StatusBadge>
            }
          >
            <ContentBlockForm
              action={saveContentBlock}
              block={block}
              slug={managed.slug}
              slugLocked
            />
            {block ? (
              <div style={{ marginTop: "1rem" }}>
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
          </Panel>
        );
      })}
    </main>
  );
}
