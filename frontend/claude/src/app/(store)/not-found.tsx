import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <div className="container py-10">
      <EmptyState icon={<Compass className="h-7 w-7" aria-hidden />} headingLevel="h1" title="Page not found" description="The page you're looking for has moved or no longer exists." action={<ButtonLink href="/shop">Continue Shopping</ButtonLink>} />
    </div>
  );
}
