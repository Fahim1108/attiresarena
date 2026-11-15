"use client";

import { Play } from "lucide-react";
import { useState } from "react";
import { isYoutubeVideoId, youtubeEmbedUrl } from "@/lib/youtube-video";

/**
 * Click-to-load YouTube player. Before activation it renders only a
 * styled button — no iframe and no request to any third party (not
 * even a thumbnail fetch). Activation (click, Enter or Space on the
 * native button) swaps in the privacy-enhanced youtube-nocookie embed
 * with no autoplay. Honors reduced motion by having no auto-motion at
 * all. Renders nothing for an invalid video ID.
 *
 * The facade fills its parent: callers control the aspect ratio
 * (gallery slide: 4/5; admin preview: 16/9).
 */
export function YoutubeVideoPlayer({
  videoId,
  title,
  label = "Watch product video",
}: {
  videoId: string;
  /** Accessible name context, e.g. the product name. */
  title: string;
  label?: string;
}) {
  const [activated, setActivated] = useState(false);
  const embedUrl = youtubeEmbedUrl(videoId);
  if (!isYoutubeVideoId(videoId) || !embedUrl) return null;

  if (!activated) {
    return (
      <button
        type="button"
        onClick={() => setActivated(true)}
        aria-label={`${label}: ${title}`}
        className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#F4F2F0] text-ink transition-[background-color] hover:bg-[#ECE8E4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
      >
        <span
          aria-hidden
          className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-white shadow-sm"
        >
          <Play className="ml-1 h-7 w-7 fill-current" />
        </span>
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-ink-muted">Plays on YouTube</span>
      </button>
    );
  }

  return (
    <iframe
      src={embedUrl}
      title={`${title} — product video`}
      className="h-full w-full border-0"
      loading="lazy"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
    />
  );
}
