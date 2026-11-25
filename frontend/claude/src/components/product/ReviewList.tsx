'use client';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LoginForm } from '@/components/account/AuthForms';
import { Badge, Button, DemoNotice, Modal, Rating } from '@/components/ui';
import { SmartImage } from '@/components/ui/SmartImage';
import type { OwnReview } from '@/lib/customer/reviews';
import { clearReviewDraft, readReviewDraft, tabSessionStorage, writeReviewDraft } from '@/lib/review-draft-storage';
import type { Review } from '@/types';
import { ReviewForm, draftFromOwnReview, emptyReviewDraft, type ReviewDraft } from './ReviewForm';

/**
 * Approved reviews only — the adapter must return approved reviews
 * and nothing else. Never render fixture identities or inferred
 * purchase badges: the verified badge renders only when
 * verifiedPurchase === true.
 *
 * The author's own review (any status) renders in a separate block
 * above the public list with a status label. It never enters the
 * public list markup, counts, average, or JSON-LD — those use the
 * approved `reviews` array only.
 *
 * Session-aware: the server page passes `signedIn` + `ownReview`.
 * Signed-out customers get the sign-in view; signing in inside the
 * modal switches to the form without leaving the page (password
 * sign-in) or shows the form on return (Google sign-in returns to
 * /account, then the customer comes back to a session-aware page).
 * The draft is also persisted in sessionStorage keyed by product, so
 * navigating sign-in paths (Google, "Create an account", "Forgot
 * password?") do not lose the typed review; it is cleared on submit
 * and on dismissal.
 */
const OWN_STATUS_LABEL: Record<OwnReview['status'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  approved: { label: 'Approved', tone: 'success' },
  pending: { label: 'Awaiting approval', tone: 'warning' },
  rejected: { label: 'Not approved', tone: 'neutral' },
};

function VerifiedBadge() {
  return (
    <Badge tone="success">
      <Check className="h-3 w-3" aria-hidden /> Verified purchase
    </Badge>
  );
}

export function ReviewList({ reviews, signedIn, ownReview, productId }: { reviews: Review[]; signedIn: boolean; ownReview: OwnReview | null; productId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'signin' | 'form'>('signin');
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const effectiveDraft = draft ?? (ownReview ? draftFromOwnReview(ownReview) : emptyReviewDraft);
  const ownStatus = ownReview ? OWN_STATUS_LABEL[ownReview.status] : null;

  const openModal = () => {
    setNotice(null);
    // Restore a draft persisted across a navigating sign-in path
    // (Google / register / forgot-password unmounted the modal).
    // An in-memory draft always wins; otherwise the persisted draft
    // wins over re-seeding from the author's review.
    if (draft === null) {
      const restored = readReviewDraft(tabSessionStorage(), productId);
      if (restored) setDraft(restored);
    }
    setView(signedIn ? 'form' : 'signin');
    setOpen(true);
  };
  const closeModal = () => {
    // A dismissed draft does not survive: the next open re-seeds from
    // the author's review. Clear the persisted copy too — dismissal
    // is explicit (Escape / overlay / close button), while navigation
    // away never calls onClose, so navigating sign-in paths keep
    // their persisted draft.
    setDraft(null);
    clearReviewDraft(tabSessionStorage(), productId);
    setOpen(false);
  };
  const handleDraftChange = (next: ReviewDraft) => {
    setDraft(next);
    writeReviewDraft(tabSessionStorage(), productId, next);
  };

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-28">
      <div className="flex items-center justify-between gap-4">
        <h2 id="reviews-heading" className="font-serif text-3xl">Customer Reviews</h2>
        <Button variant="outline" size="sm" onClick={openModal}>{ownReview ? 'Edit Your Review' : 'Write a Review'}</Button>
      </div>
      {notice && <div className="mt-5"><DemoNotice force>{notice}</DemoNotice></div>}
      {ownReview && ownStatus && (
        <div className="mt-5 rounded-lg border border-line bg-white p-4" aria-label="Your review">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-medium">Your review</p>
            <Badge tone={ownStatus.tone}>{ownStatus.label}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Rating value={ownReview.rating} />
            {ownReview.verifiedPurchase === true && <VerifiedBadge />}
          </div>
          {ownReview.title && <h3 className="mt-2 font-medium">{ownReview.title}</h3>}
          <p className="mt-2 break-words text-sm">{ownReview.body}</p>
          <time dateTime={ownReview.createdAt} className="mt-2 block text-xs text-ink-muted">{new Date(ownReview.createdAt).toLocaleDateString('en-BD')}</time>
        </div>
      )}
      {reviews.length ? (
        <ul className="mt-5 space-y-4">
          {reviews.map((r) => (
            <li key={r.id} className="break-words rounded-lg border border-line bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{r.author}</p>
                {r.verifiedPurchase === true && <VerifiedBadge />}
              </div>
              <Rating value={r.rating} />
              {r.title && <h3 className="mt-2 font-medium">{r.title}</h3>}
              <p className="mt-2 text-sm">{r.body}</p>
              {r.photos && r.photos.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Review photos">
                  {r.photos.map((photo, index) => (
                    <li key={photo.src} className="relative h-20 w-20 overflow-hidden rounded-lg border border-line bg-[#F4F2F0]">
                      <SmartImage src={photo.src} alt={photo.alt || `Review photo ${index + 1}`} fill sizes="80px" className="object-cover" />
                    </li>
                  ))}
                </ul>
              )}
              <time dateTime={r.createdAt} className="mt-2 block text-xs text-ink-muted">{new Date(r.createdAt).toLocaleDateString('en-BD')}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-ink-muted">No reviews yet. Be the first to review this product.</p>
      )}
      <Modal
        open={open}
        onClose={closeModal}
        title={view === 'signin' ? 'Sign in to write a review' : ownReview ? 'Edit your review' : 'Write a review'}
        description="Your review will be checked by our team before it appears."
      >
        {view === 'signin' ? (
          <div className="space-y-4">
            <LoginForm
              onSignedIn={() => {
                setView('form');
                router.refresh();
              }}
            />
            <p className="text-center text-sm text-ink-muted">
              New here?{' '}
              <Link href="/account/register" className="text-primary hover:underline">
                Create an account
              </Link>
            </p>
          </div>
        ) : (
          <ReviewForm
            productId={productId}
            initial={ownReview}
            draft={effectiveDraft}
            onDraftChange={handleDraftChange}
            onSubmitted={(message) => {
              setDraft(null);
              clearReviewDraft(tabSessionStorage(), productId);
              setOpen(false);
              setNotice(message);
              router.refresh();
            }}
            onSignInExpired={() => setView('signin')}
          />
        )}
      </Modal>
    </section>
  );
}
