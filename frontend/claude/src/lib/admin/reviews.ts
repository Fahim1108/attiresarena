import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  requireStaff,
  actionOk,
  actionError,
  toActionError,
  type AdminActionResult,
} from "./authorization";
import { areaRoles } from "./constants";

/**
 * Review moderation queue (catalogue area). Reads go through the
 * admin_list_product_reviews RPC (migration 20261117000100), gated in
 * the database on catalogue.manage; writes go through
 * moderate_product_review. No sample fallback anywhere: when the
 * listing RPC is missing (migration unapplied) or a read fails, the
 * loader returns null and the page renders an honest unavailable
 * state with no rows — invented review rows must never appear in a
 * moderation queue.
 */

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

export type AdminReviewStatus = (typeof REVIEW_STATUSES)[number];

export const reviewRowSchema = z.object({
  id: z.uuid(),
  product_id: z.uuid(),
  product_name: z.string(),
  customer_id: z.uuid(),
  author_display_name: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string(),
  body: z.string(),
  status: z.enum(REVIEW_STATUSES),
  verified_purchase: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export type AdminReviewRow = z.infer<typeof reviewRowSchema>;

/** Status filter from search params: an unknown value lists everything. */
export function parseReviewStatusFilter(
  value: unknown,
): AdminReviewStatus | null {
  if (
    value === "pending" ||
    value === "approved" ||
    value === "rejected"
  ) {
    return value;
  }
  return null;
}

const REVIEW_LIST_LIMIT = 200;

/**
 * Reads return null when the live data is UNAVAILABLE (missing RPC,
 * failed query, or malformed rows) so the page degrades honestly.
 * A live empty result is still returned as an empty list.
 */
export async function readReviews(
  params: Record<string, string | string[] | undefined>,
): Promise<{ reviews: AdminReviewRow[]; status: AdminReviewStatus | null } | null> {
  const session = await requireStaff(areaRoles("catalogue"));
  const status = parseReviewStatusFilter(params.status);
  const result = await session.client.rpc("admin_list_product_reviews", {
    p_status: status,
    p_limit: REVIEW_LIST_LIMIT,
  });
  if (result.error) return null;
  const parsed = reviewRowSchema.array().safeParse(result.data);
  if (!parsed.success) return null;
  return { reviews: parsed.data, status };
}

const moderateSchema = z.object({
  id: z.uuid(),
  approved: z.enum(["true", "false"]).transform((value) => value === "true"),
});

/**
 * Approve/reject one review via moderate_product_review. Mirrors
 * setPaymentStatus: zod-validate → requireStaff(catalogue) → RPC →
 * revalidatePath → actionOk/actionError, never leaking DB errors.
 * Re-moderation re-sets the status and appends another audit row;
 * the RPC has no optimistic-concurrency parameter.
 */
export async function moderateReview(
  _prev: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  "use server";
  const parsed = moderateSchema.safeParse({
    id: formData.get("id"),
    approved: formData.get("approved"),
  });
  if (!parsed.success) {
    return actionError("Enter a valid review and decision. Reload and try again.");
  }
  const session = await requireStaff(areaRoles("catalogue"));
  const result = await session.client.rpc("moderate_product_review", {
    target_review: parsed.data.id,
    approved: parsed.data.approved,
  });
  if (result.error) {
    return actionError(
      toActionError(
        result.error,
        "Review moderation failed. Check your access and try again.",
      ),
    );
  }
  revalidatePath("/admin/catalog/reviews");
  return actionOk(
    parsed.data.approved ? "Review approved." : "Review rejected.",
  );
}
