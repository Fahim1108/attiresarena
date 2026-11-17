import { z } from "zod";
import type { ActionResult } from "@/types";
import type { CustomerClient } from "./supabase";
import type { CustomerReviewInput } from "./validation";

/**
 * Customer review submission + own-review read against
 * public.product_reviews (migration 20261026000200, extended by
 * 20261117000100).
 *
 * Writes go ONLY through the submit_product_review RPC over the
 * customer JWT client: the table has no INSERT/UPDATE/DELETE grant or
 * policy, so direct table writes cannot work by design. Never a
 * privileged-key client. The RPC is the single validation path (bounds,
 * published check, rate limit, one row per product+customer via the
 * upsert); error codes are mapped to user-facing messages here and
 * database text is never leaked.
 *
 * Reads use the read_own_product_review RPC (migration
 * 20261117000100), which scopes to the caller with auth.uid() inside
 * a SECURITY DEFINER function. Do NOT "simplify" this to a direct
 * table select: the column-list SELECT grant on product_reviews
 * omits customer_id (20261026000200), so filtering on it is denied
 * with 42501 — and dropping the filter is worse, because the
 * approved_reviews SELECT policy (approved + published) combines
 * with the own-row policy under OR, so a product-only filter would
 * return other customers' approved reviews as if they were the
 * caller's own. The RPC is the only read shape that is both
 * permitted by the grant and scoped to the caller. No user id is
 * accepted here: identity comes from the caller's JWT, exactly as
 * with the submit RPC.
 *
 * FALLBACK READ (Q8, approved list only): approvedReviews tries the
 * post-migration column set first and retries once with the
 * pre-migration columns when the first select errors, so one deploy
 * works before AND after the gated migration apply. There is NO
 * pre-migration fallback for the own-review read: before the
 * migration lands the RPC does not exist, the call errors, and
 * readOwnReview returns null (the form simply starts empty, with no
 * prefill). No direct-select fallback exists that is both permitted
 * and correct, so none is attempted.
 */

/** Message returned when the customer session is missing or expired. The review form matches on this exact text to switch back to the sign-in view. */
export const REVIEW_SIGN_IN_EXPIRED_MESSAGE =
  "Your sign-in expired. Please sign in again.";

/** Success message: reviews start pending and need staff approval before they appear. */
export const REVIEW_SUBMITTED_MESSAGE =
  "Thanks — your review is awaiting approval and will appear here once our team approves it.";

export type OwnReviewStatus = "pending" | "approved" | "rejected";

export interface OwnReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  status: OwnReviewStatus;
  verifiedPurchase: boolean;
  createdAt: string;
  updatedAt: string | null;
}

/**
 * Own-review row. verified_purchase / updated_at are optional so a
 * row without them still projects: absent fields default to false /
 * null instead of dropping the row.
 */
export const ownReviewRowSchema = z.object({
  id: z.uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(160),
  body: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  verified_purchase: z.boolean().optional(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }).nullable().optional(),
});

/** Project one own-review row; null when the row fails validation. */
export function projectOwnReview(row: unknown): OwnReview | null {
  const parsed = ownReviewRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    id: data.id,
    rating: data.rating,
    title: data.title,
    body: data.body,
    status: data.status,
    verifiedPurchase: data.verified_purchase ?? false,
    createdAt: data.created_at,
    updatedAt: data.updated_at ?? null,
  };
}

/**
 * The signed-in customer's own review for one product, any status, or
 * null when there is none, the id is not a UUID, or the read fails
 * (including before the migration lands, when the RPC does not exist
 * yet). Failures yield null (the form simply starts empty); they never
 * throw into the product page. Identity comes from the caller's JWT
 * inside the RPC, so no user id is accepted — a caller cannot read
 * as someone else, and the unique constraint guarantees at most one
 * row. The RPC returns a one-row-or-empty array; anything else (a
 * malformed row, a non-array) yields null via the projector's schema.
 */
export async function readOwnReview(
  client: CustomerClient,
  productId: string,
): Promise<OwnReview | null> {
  if (!z.uuid().safeParse(productId).success) return null;
  const result = await client.rpc("read_own_product_review", {
    target_product: productId,
  });
  if (result.error) return null;
  const rows = ownReviewRowSchema.array().safeParse(result.data);
  if (!rows.success) return null;
  const row = rows.data[0];
  return row ? projectOwnReview(row) : null;
}

function mapSubmitError(error: { code?: string | null }): ActionResult<never> {
  switch (error.code) {
    case "42501":
      return {
        ok: false,
        reason: "error",
        message: REVIEW_SIGN_IN_EXPIRED_MESSAGE,
      };
    case "54000":
      return {
        ok: false,
        reason: "error",
        message:
          "You have submitted several reviews recently. Please wait a little while and try again.",
      };
    case "22023":
      return {
        ok: false,
        reason: "validation",
        message: "Check your review details and try again.",
      };
    case "23505":
      // Unreachable once the upsert RPC is live (edits update the one
      // row); kept so the pre-migration insert-only RPC fails with a
      // useful message instead of a generic error.
      return {
        ok: false,
        reason: "validation",
        message:
          "You have already reviewed this product. Edit your existing review instead.",
      };
    default:
      return {
        ok: false,
        reason: "error",
        message: "Your review could not be submitted. Please try again.",
      };
  }
}

/**
 * Submit (or edit) one review through the submit_product_review RPC.
 * Identity comes from the caller's JWT inside the RPC (auth.uid());
 * no user id is accepted here, so a caller cannot submit as someone
 * else. Editing any status returns the review to pending; the RPC
 * enforces that, not this function.
 */
export async function submitCustomerReview(
  client: CustomerClient,
  input: CustomerReviewInput,
): Promise<ActionResult<{ reviewId: string }>> {
  const result = await client.rpc("submit_product_review", {
    target_product: input.productId,
    stars: input.rating,
    review_body: input.body,
    review_title: input.title,
  });
  if (result.error) return mapSubmitError(result.error);
  if (!z.uuid().safeParse(result.data).success) {
    return {
      ok: false,
      reason: "error",
      message: "Your review could not be submitted. Please try again.",
    };
  }
  return {
    ok: true,
    data: { reviewId: result.data as string },
    message: REVIEW_SUBMITTED_MESSAGE,
  };
}
