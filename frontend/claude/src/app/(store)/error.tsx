"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function StoreError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container py-10" role="alert">
      <EmptyState icon={<TriangleAlert className="h-7 w-7" aria-hidden />} headingLevel="h1" title="Something went wrong" description="We couldn't load this page. Please try again." action={<Button onClick={reset}>Try again</Button>} />
    </div>
  );
}
