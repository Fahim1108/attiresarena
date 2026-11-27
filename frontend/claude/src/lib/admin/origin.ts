import { customerAuthOrigin } from "@/lib/customer/origin";

/**
 * Origin for staff-auth email links (password recovery). The link must
 * land on this same deployment, so the rule is shared with customer
 * auth: a Vercel Preview branch URL when VERCEL_ENV is preview, else
 * SITE_URL. Delegating to the single resolver — instead of copying its
 * validation — keeps both flows landing on the same host. Pure given
 * an env record, so the decision is testable without process state.
 */
export function staffAuthOrigin(env: {
  SITE_URL?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  VERCEL_BRANCH_URL?: string;
}): string | null {
  return customerAuthOrigin(env);
}

export function getStaffAuthOrigin(): string | null {
  return staffAuthOrigin(process.env);
}
