"use client";

import { Star, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { DemoNotice } from "@/components/ui/DemoNotice";
import { FieldShell, Input, Textarea } from "@/components/ui/Field";
import { compressImageFile } from "@/components/admin/catalog/image-compress";
import { cn } from "@/lib/cn";
import {
  REVIEW_SIGN_IN_EXPIRED_MESSAGE,
  type OwnReview,
} from "@/lib/customer/reviews";
import { MAX_REVIEW_PHOTOS } from "@/lib/customer/review-photos";
import type { FieldErrors } from "@/lib/validation";
import { submitReviewAction, uploadReviewPhotoAction } from "@/services/actions";

/** Draft state, owned by ReviewList and persisted in sessionStorage, so it survives the sign-in step — including navigating sign-in paths. */
export interface ReviewDraft {
  rating: number;
  title: string;
  body: string;
}

export const emptyReviewDraft: ReviewDraft = { rating: 0, title: "", body: "" };

/** Draft seeded from the author's existing review when editing. */
export function draftFromOwnReview(ownReview: OwnReview): ReviewDraft {
  return {
    rating: ownReview.rating,
    title: ownReview.title,
    body: ownReview.body,
  };
}

function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return <DemoNotice force>{message}</DemoNotice>;
}

/** Move keyboard and screen-reader focus to the first invalid field after a failed submit. */
function focusFirstError(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

/**
 * Star-rating input: five real buttons reusing the display Rating's
 * star icon and #C9932E fill. The group itself carries the stable id
 * so a missing rating can receive focus like any other field error.
 */
function RatingInput({
  value,
  onChange,
  error,
}: {
  value: number;
  onChange: (value: number) => void;
  error?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value;
  return (
    <FieldShell
      label="Rating"
      required
      id="review-rating"
      error={error}
      hint="Choose 1 to 5 stars."
    >
      <div
        id="review-rating"
        role="radiogroup"
        aria-label="Rating"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "review-rating-error" : "review-rating-hint"}
        tabIndex={-1}
        className="flex gap-1 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
        onMouseLeave={() => setHovered(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            onClick={() => onChange(star)}
            onMouseEnter={() => setHovered(star)}
            onFocus={() => setHovered(star)}
            onBlur={() => setHovered(null)}
            className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
          >
            <Star
              className={cn(
                "h-6 w-6",
                star <= shown
                  ? "fill-[#C9932E] text-[#C9932E]"
                  : "fill-ink/10 text-ink/10",
              )}
              aria-hidden
            />
          </button>
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        {value > 0 ? `Selected ${value} star${value === 1 ? "" : "s"}` : "No rating selected"}
      </span>
    </FieldShell>
  );
}

/**
 * Review form. Client validation mirrors the server schema and the
 * database CHECKs exactly (rating 1–5, title ≤160, body trimmed
 * 10–3000) for instant feedback; the server action is authoritative.
 * On a sign-in-expired failure the draft is kept by the parent and
 * the modal switches back to the sign-in view.
 */
export function ReviewForm({
  productId,
  initial,
  draft,
  onDraftChange,
  onSubmitted,
  onSignInExpired,
}: {
  productId: string;
  initial: OwnReview | null;
  draft: ReviewDraft;
  onDraftChange: (draft: ReviewDraft) => void;
  onSubmitted: (message: string) => void;
  onSignInExpired: () => void;
}) {
  const [errors, setErrors] = useState<
    FieldErrors<"rating" | "title" | "body">
  >({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editing = initial !== null;
  const bodyLength = draft.body.trim().length;
  // Client feedback item 19: optional photos (max 3), auto-compressed
  // before upload with the same compressor the admin catalogue uses.
  // Photos are form-only state — they are NOT part of the persisted
  // sessionStorage draft (Files cannot be stored there), so navigating
  // away before submitting loses them; the text draft still survives.
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    return () => {
      for (const url of photoPreviews) URL.revokeObjectURL(url);
    };
  }, [photoPreviews]);

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = MAX_REVIEW_PHOTOS - photos.length;
    if (remaining <= 0) {
      setPhotoNote(`You can add up to ${MAX_REVIEW_PHOTOS} photos per review.`);
      return;
    }
    const picked = [...files].slice(0, remaining);
    const compressed: File[] = [];
    const previews: string[] = [];
    let note: string | null = null;
    for (const file of picked) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        note = "Photos must be JPEG, PNG, or WebP.";
        continue;
      }
      const result = await compressImageFile(file);
      if (result.note) note = result.note;
      compressed.push(result.file);
      previews.push(URL.createObjectURL(result.file));
    }
    if (files.length > remaining) {
      note = `You can add up to ${MAX_REVIEW_PHOTOS} photos per review.`;
    }
    setPhotos((prev) => [...prev, ...compressed]);
    setPhotoPreviews((prev) => [...prev, ...previews]);
    setPhotoNote(note);
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed);
      return prev.filter((_, i) => i !== index);
    });
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const errs: typeof errors = {};
        if (draft.rating < 1 || draft.rating > 5)
          errs.rating = "Choose a star rating";
        if (draft.title.trim().length > 160)
          errs.title = "Keep the title to 160 characters or fewer";
        if (bodyLength < 10) errs.body = "Write at least 10 characters";
        else if (bodyLength > 3000)
          errs.body = "Keep your review to 3000 characters or fewer";
        setErrors(errs);
        if (errs.rating) return focusFirstError("review-rating");
        if (errs.title) return focusFirstError("review-title");
        if (errs.body) return focusFirstError("review-body");
        start(async () => {
          try {
            const r = await submitReviewAction({
              productId,
              rating: draft.rating,
              title: draft.title,
              body: draft.body,
            });
            if (r.ok) {
              // Photos upload AFTER the review exists: a photo failure
              // never fails the review itself. The review id comes back
              // from the submit (same id on edit, via the upsert RPC).
              let photoFailures = 0;
              const reviewId = r.data?.reviewId;
              if (reviewId && photos.length > 0) {
                for (let i = 0; i < photos.length; i++) {
                  const file = photos[i];
                  if (!file) continue;
                  const uploaded = await uploadReviewPhotoAction(reviewId, file, i);
                  if (!uploaded.ok) photoFailures += 1;
                }
              }
              const base =
                r.message ??
                "Thanks — your review is awaiting approval and will appear here once our team approves it.";
              onSubmitted(
                photoFailures > 0
                  ? `${base} ${photoFailures === 1 ? "One photo" : `${photoFailures} photos`} could not be saved — you can try again by editing your review.`
                  : base,
              );
            } else if (r.message === REVIEW_SIGN_IN_EXPIRED_MESSAGE) {
              onSignInExpired();
            } else {
              setMessage(r.message);
            }
          } catch {
            setMessage("The request could not be completed. Please try again.");
          }
        });
      }}
    >
      <RatingInput
        value={draft.rating}
        onChange={(rating) => onDraftChange({ ...draft, rating })}
        error={errors.rating}
      />
      <Input
        id="review-title"
        label="Title (optional)"
        maxLength={160}
        placeholder="Sum up your review…"
        value={draft.title}
        onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
        error={errors.title}
      />
      <Textarea
        id="review-body"
        label="Your review"
        required
        maxLength={3000}
        placeholder="How was the fit, fabric, and condition?"
        value={draft.body}
        onChange={(e) => onDraftChange({ ...draft, body: e.target.value })}
        error={errors.body}
        hint={`${bodyLength}/3000 characters · at least 10 characters`}
      />
      <FieldShell
        label="Photos (optional)"
        id="review-photos"
        hint="Up to 3 photos. They are compressed automatically so they stay small."
      >
        <input
          ref={photoInputRef}
          id="review-photos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={(e) => {
            void addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
        {photoPreviews.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-2" aria-label="Selected photos">
            {photoPreviews.map((url, index) => (
              <li key={url} className="relative h-20 w-20 overflow-hidden rounded-lg border border-line bg-[#F4F2F0]">
                {/* eslint-disable-next-line @next/next/no-img-element -- object-URL preview, not a deliverable image */}
                <img src={url} alt={`Selected photo ${index + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  aria-label={`Remove photo ${index + 1}`}
                  className="absolute right-1 top-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full bg-ink/70 text-white"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => photoInputRef.current?.click()}
          disabled={pending || photos.length >= MAX_REVIEW_PHOTOS}
        >
          {photos.length === 0 ? "Add photos" : `Add more (${photos.length}/${MAX_REVIEW_PHOTOS})`}
        </Button>
        {photoNote && <p className="mt-2 text-xs text-ink-muted">{photoNote}</p>}
      </FieldShell>
      <Notice message={message} />
      <Button type="submit" size="lg" fullWidth loading={pending}>
        {editing ? "Update Review" : "Submit Review"}
      </Button>
    </form>
  );
}
