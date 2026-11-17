import Link from "next/link";
import { formatDateTime } from "@/lib/admin/format";
import {
  moderateReview,
  readReviews,
  type AdminReviewRow,
  type AdminReviewStatus,
} from "@/lib/admin/reviews";
import {
  EmptyState,
  Notice,
  StatusBadge,
  hrefWithParams,
} from "@/components/admin/ui";
import { ReviewRowActions } from "@/components/admin/catalog/ReviewRowActions";
import { Card, CardContent } from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";

export const metadata = { title: "Reviews" };

const FILTERS: { value: AdminReviewStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function statusTone(status: AdminReviewStatus): "warning" | "success" | "neutral" {
  if (status === "pending") return "warning";
  if (status === "approved") return "success";
  return "neutral";
}

function statusLabel(status: AdminReviewStatus): string {
  if (status === "pending") return "Pending";
  if (status === "approved") return "Approved";
  return "Rejected";
}

function authorName(review: AdminReviewRow): string {
  return review.author_display_name.trim() || "Customer";
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const result = await readReviews(params);

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="Reviews"
          description="Customer reviews start pending and appear on the storefront only after approval. Editing a review returns it to pending."
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Catalog
          </p>
        </PageHeader>

        <nav aria-label="Filter reviews by status" className="aa-tabs">
          {FILTERS.map((filter) => {
            const active = (result?.status ?? null) === filter.value;
            return (
              <Link
                key={filter.label}
                href={hrefWithParams("/admin/catalog/reviews", params, {
                  status: filter.value ?? undefined,
                })}
                aria-current={active ? "page" : undefined}
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>

        {result === null ? (
          <Notice kind="error">
            Review data is unavailable — the reviews could not be read. No
            reviews are shown, and no changes can be made.
          </Notice>
        ) : result.reviews.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                title="No reviews"
                description={
                  result.status
                    ? `No ${result.status} reviews.`
                    : "No customer reviews have been submitted yet."
                }
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <div className="aa-table-scroll">
                <table className="aa-table">
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">Author</th>
                      <th scope="col">Rating</th>
                      <th scope="col">Review</th>
                      <th scope="col">Verified</th>
                      <th scope="col">Submitted</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span>Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.reviews.map((review) => (
                      <tr key={review.id}>
                        <th scope="row">
                          <Link
                            href={`/admin/catalog/products/${review.product_id}`}
                            className="aa-cell-main"
                          >
                            {review.product_name}
                          </Link>
                        </th>
                        <td data-label="Author">{authorName(review)}</td>
                        <td data-label="Rating">
                          {review.rating} out of 5
                        </td>
                        <td data-label="Review">
                          {review.title ? (
                            <span className="aa-cell-main">{review.title}</span>
                          ) : null}
                          <span className="aa-cell-sub">{review.body}</span>
                        </td>
                        <td data-label="Verified">
                          {review.verified_purchase ? (
                            <StatusBadge tone="success">Verified purchase</StatusBadge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td data-label="Submitted">
                          {formatDateTime(review.created_at)}
                        </td>
                        <td data-label="Status">
                          <StatusBadge tone={statusTone(review.status)}>
                            {statusLabel(review.status)}
                          </StatusBadge>
                        </td>
                        <td data-label="Actions" className="aa-cell-actions">
                          <ReviewRowActions
                            reviewId={review.id}
                            author={authorName(review)}
                            moderateAction={moderateReview}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
