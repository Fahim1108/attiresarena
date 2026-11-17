/**
 * Review-draft persistence across navigating sign-in paths.
 *
 * The draft lives in ReviewList state while the modal stays mounted,
 * which covers the password sign-in view switch — but Google sign-in,
 * "Create an account", and "Forgot password?" all navigate away and
 * unmount the modal, losing the typed review. Persisting the draft in
 * sessionStorage (keyed by product) survives those navigations within
 * the tab and dies with the tab. Callers clear it on successful submit
 * and on modal dismissal; navigation itself never clears it, because
 * the modal's onClose only fires for explicit dismissal (Escape,
 * overlay click, close button), never for unmount-on-navigate.
 *
 * Only rating + title + body are stored — exactly what the user typed
 * into the form, nothing else. The shape mirrors ReviewDraft in
 * components/product/ReviewForm.tsx; keep the two in sync.
 *
 * Never throws: SSR (no window), private-mode storage access, quota
 * errors, and malformed stored JSON all degrade to null / no-op,
 * following the safe-storage convention in lib/storage.ts. The store
 * is injected so the helpers are unit-testable without a DOM.
 */

export interface ReviewDraftData {
  rating: number;
  title: string;
  body: string;
}

export type ReviewDraftStore = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

/** Storage key for one product's draft. The product id scopes drafts apart. */
export function reviewDraftKey(productId: string): string {
  return `aa-review-draft:${productId}`;
}

/**
 * Parse and validate stored JSON. Null for anything malformed: bad
 * JSON, a non-object, a non-integer or out-of-range rating (0 means
 * "no rating chosen yet"), or title/body beyond the form's caps.
 */
export function parseReviewDraft(raw: string | null): ReviewDraftData | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const { rating, title, body } = parsed as Record<string, unknown>;
  if (
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 0 ||
    rating > 5
  ) {
    return null;
  }
  if (typeof title !== "string" || title.length > 160) return null;
  if (typeof body !== "string" || body.length > 3000) return null;
  return { rating, title, body };
}

/** Read one product's persisted draft, or null when there is none. */
export function readReviewDraft(
  store: ReviewDraftStore | null | undefined,
  productId: string,
): ReviewDraftData | null {
  if (!store) return null;
  try {
    return parseReviewDraft(store.getItem(reviewDraftKey(productId)));
  } catch {
    return null;
  }
}

/** Persist one product's draft (rating + title + body only). */
export function writeReviewDraft(
  store: ReviewDraftStore | null | undefined,
  productId: string,
  draft: ReviewDraftData,
): void {
  if (!store) return;
  try {
    store.setItem(
      reviewDraftKey(productId),
      JSON.stringify({
        rating: draft.rating,
        title: draft.title,
        body: draft.body,
      }),
    );
  } catch {
    /* ignore: persistence is best-effort, the in-memory draft survives */
  }
}

/** Drop one product's persisted draft (submit success / dismissal). */
export function clearReviewDraft(
  store: ReviewDraftStore | null | undefined,
  productId: string,
): void {
  if (!store) return;
  try {
    store.removeItem(reviewDraftKey(productId));
  } catch {
    /* ignore */
  }
}

/**
 * The tab's sessionStorage, or null outside the browser / when access
 * itself throws (private mode in some browsers).
 */
export function tabSessionStorage(): ReviewDraftStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
