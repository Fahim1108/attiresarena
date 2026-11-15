/**
 * YouTube product-video parsing: pure helpers shared by the admin save
 * path, the admin form preview, the publication projector and the
 * storefront gallery.
 *
 * CANONICAL FORM: the 11-character YouTube video ID only. The admin
 * pastes a full link; the server action extracts the ID and stores
 * that (products.youtube_video_id). Storing the ID — never a raw URL —
 * keeps the embed URL construction safe: the ID charset is fixed, so
 * no pasted URL can inject query parameters or a different host into
 * the iframe src. No video URL is ever invented: empty input means
 * no video, and anything unparseable is a field-level error.
 *
 * ACCEPTED LINK FORMS (http/https, with or without a scheme):
 *   youtube.com/watch?v=ID (extra query params ignored)
 *   youtu.be/ID
 *   youtube.com/embed/ID
 *   youtube.com/shorts/ID
 * No other provider, host or path form is accepted.
 */

/** A YouTube video ID is exactly 11 URL-safe base64 characters. */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Upper bound on a pasted link; anything longer is rejected, not truncated. */
export const MAX_YOUTUBE_LINK_LENGTH = 2048;

export const YOUTUBE_LINK_ERROR =
  "Enter a valid YouTube link, e.g. https://www.youtube.com/watch?v=… or https://youtu.be/….";

export function isYoutubeVideoId(value: unknown): value is string {
  return typeof value === "string" && YOUTUBE_VIDEO_ID_PATTERN.test(value);
}

function isYoutubeHost(hostname: string): boolean {
  return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
}

function isShortHost(hostname: string): boolean {
  return hostname === "youtu.be" || hostname.endsWith(".youtu.be");
}

function idFromSegments(segments: string[]): string | null {
  if (segments.length !== 1) return null;
  const candidate = segments[0] ?? "";
  return isYoutubeVideoId(candidate) ? candidate : null;
}

export interface YoutubeVideoParse {
  /** The extracted video ID, or null when the input was empty. */
  videoId: string | null;
  /** Field-level error message, or null when the input parsed. */
  error: string | null;
}

/**
 * Parse pasted admin input into a video ID. Empty/whitespace-only input
 * parses to no video (videoId null, no error): clearing the field
 * removes the video. Anything else that is not a recognised YouTube
 * link form returns YOUTUBE_LINK_ERROR.
 */
export function parseYoutubeVideoInput(raw: string): YoutubeVideoParse {
  const input = raw.trim();
  if (input === "") return { videoId: null, error: null };
  if (input.length > MAX_YOUTUBE_LINK_LENGTH) {
    return { videoId: null, error: "That YouTube link is too long." };
  }
  // Reject control characters and whitespace inside the link: a pasted
  // link with junk around the ID must fail, not silently parse.
  if (/[\s<>]/.test(input)) return { videoId: null, error: YOUTUBE_LINK_ERROR };
  let url: URL;
  try {
    // Bare hosts ("youtube.com/watch?v=…") parse as https; an explicit
    // scheme other than http/https (e.g. javascript:) must not parse.
    url = /^[a-z][a-z0-9+.-]*:/i.test(input)
      ? new URL(input)
      : new URL(`https://${input}`);
  } catch {
    return { videoId: null, error: YOUTUBE_LINK_ERROR };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { videoId: null, error: YOUTUBE_LINK_ERROR };
  }
  const hostname = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter((part) => part !== "");
  if (isShortHost(hostname)) {
    const videoId = idFromSegments(segments);
    return videoId
      ? { videoId, error: null }
      : { videoId: null, error: YOUTUBE_LINK_ERROR };
  }
  if (isYoutubeHost(hostname)) {
    if (segments[0] === "watch") {
      const candidate = url.searchParams.get("v") ?? "";
      return isYoutubeVideoId(candidate)
        ? { videoId: candidate, error: null }
        : { videoId: null, error: YOUTUBE_LINK_ERROR };
    }
    if (segments[0] === "embed" || segments[0] === "shorts") {
      const videoId = idFromSegments(segments.slice(1));
      return videoId
        ? { videoId, error: null }
        : { videoId: null, error: YOUTUBE_LINK_ERROR };
    }
    return { videoId: null, error: YOUTUBE_LINK_ERROR };
  }
  return { videoId: null, error: YOUTUBE_LINK_ERROR };
}

/**
 * Privacy-enhanced embed URL for a validated video ID. No autoplay
 * parameter is ever added: playback starts only when the shopper
 * presses play in the embed. Returns null for an invalid ID.
 */
export function youtubeEmbedUrl(videoId: string): string | null {
  if (!isYoutubeVideoId(videoId)) return null;
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

/** Canonical watch URL for a validated video ID (admin "view" link). */
export function youtubeWatchUrl(videoId: string): string | null {
  if (!isYoutubeVideoId(videoId)) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}
