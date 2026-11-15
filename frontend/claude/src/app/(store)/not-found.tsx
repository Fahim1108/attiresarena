import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getErrorPage404 } from "@/lib/store-settings";

/**
 * Storefront 404 page. Title/subtitle come from the stored error_404
 * layout setting when one exists; when nothing is stored the reader
 * returns the built-in default, so this renders byte-identically to the
 * previous static copy.
 */
export default async function NotFound() {
  const page = await getErrorPage404();
  return (
    <div className="container py-10">
      <EmptyState icon={<Compass className="h-7 w-7" aria-hidden />} headingLevel="h1" title={page.title} description={page.subtitle} action={<ButtonLink href="/shop">Continue Shopping</ButtonLink>} />
    </div>
  );
}
