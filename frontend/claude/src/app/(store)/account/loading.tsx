import { Skeleton } from "@/components/ui/LoadingSkeleton";

/** Account-shaped loading state, so account routes no longer fall back to the
 * storefront product-grid skeleton while the account layout resolves. */
export default function AccountLoading() {
  return (
    <div className="container py-6 sm:py-10" role="status" aria-label="Loading account" aria-busy="true">
      <span className="sr-only">Loading account</span>
      <div aria-hidden>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-10 w-64 max-w-full" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr] lg:gap-10">
          <div className="hidden space-y-2 lg:block">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-card" />
            <Skeleton className="h-64 w-full rounded-card" />
          </div>
        </div>
      </div>
    </div>
  );
}
