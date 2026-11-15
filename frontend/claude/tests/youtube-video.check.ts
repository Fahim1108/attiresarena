import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isYoutubeVideoId,
  MAX_YOUTUBE_LINK_LENGTH,
  parseYoutubeVideoInput,
  youtubeEmbedUrl,
  youtubeWatchUrl,
  YOUTUBE_LINK_ERROR,
} from "../src/lib/youtube-video";
import {
  parsePublishedAdminRow,
  projectPublishedAdminProduct,
} from "../src/lib/catalog-publication";
import { ProductGallery } from "../src/components/product/ProductGallery";
import { YoutubeVideoPlayer } from "../src/components/product/YoutubeVideoPlayer";

const ID = "dQw4w9WgXcQ";
const ID_UNDERSCORE_DASH = "Ab3_-xY9zQ0";

describe("youtube video link parsing", () => {
  it("accepts watch URLs and ignores extra query params", () => {
    expect(parseYoutubeVideoInput(`https://www.youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID, error: null });
    expect(parseYoutubeVideoInput(`https://youtube.com/watch?v=${ID}&t=42s&list=PL123`)).toEqual({ videoId: ID, error: null });
    expect(parseYoutubeVideoInput(`https://m.youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID, error: null });
    expect(parseYoutubeVideoInput(`http://www.youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID, error: null });
  });

  it("accepts youtu.be, embed and shorts forms", () => {
    expect(parseYoutubeVideoInput(`https://youtu.be/${ID}`)).toEqual({ videoId: ID, error: null });
    expect(parseYoutubeVideoInput(`https://youtu.be/${ID}/`)).toEqual({ videoId: ID, error: null });
    expect(parseYoutubeVideoInput(`https://www.youtube.com/embed/${ID}`)).toEqual({ videoId: ID, error: null });
    expect(parseYoutubeVideoInput(`https://www.youtube.com/shorts/${ID}`)).toEqual({ videoId: ID, error: null });
    expect(parseYoutubeVideoInput(`https://youtu.be/${ID}?t=10`)).toEqual({ videoId: ID, error: null });
  });

  it("accepts IDs with underscores and dashes, and bare hosts", () => {
    expect(parseYoutubeVideoInput(`https://youtu.be/${ID_UNDERSCORE_DASH}`)).toEqual({ videoId: ID_UNDERSCORE_DASH, error: null });
    expect(parseYoutubeVideoInput(`youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID, error: null });
    expect(parseYoutubeVideoInput(`youtu.be/${ID}`)).toEqual({ videoId: ID, error: null });
  });

  it("treats empty and whitespace-only input as no video", () => {
    expect(parseYoutubeVideoInput("")).toEqual({ videoId: null, error: null });
    expect(parseYoutubeVideoInput("   \n\t ")).toEqual({ videoId: null, error: null });
    expect(parseYoutubeVideoInput(`  https://youtu.be/${ID}  `)).toEqual({ videoId: ID, error: null });
  });

  it("rejects non-YouTube hosts, including lookalikes", () => {
    for (const input of [
      `https://vimeo.com/${ID}`,
      `https://youtube.com.evil.example/watch?v=${ID}`,
      `https://notyoutube.com/watch?v=${ID}`,
      `https://youtu.be.evil.example/${ID}`,
      "https://example.com/watch?v=dQw4w9WgXcQ",
    ]) {
      expect(parseYoutubeVideoInput(input)).toEqual({ videoId: null, error: YOUTUBE_LINK_ERROR });
    }
  });

  it("rejects malformed IDs and wrong path forms", () => {
    for (const input of [
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ1",
      "https://www.youtube.com/watch?v=dQw4w9WgXc!",
      "https://www.youtube.com/watch",
      "https://www.youtube.com/watch?list=PL123",
      `https://youtu.be/${ID}/extra`,
      `https://www.youtube.com/embed/${ID}/extra`,
      "https://www.youtube.com/",
      "https://www.youtube.com/channel/UC12345678901",
      "not a link",
      `https://youtu.be/${ID} junk`,
    ]) {
      expect(parseYoutubeVideoInput(input)).toEqual({ videoId: null, error: YOUTUBE_LINK_ERROR });
    }
  });

  it("rejects non-http schemes and overlong input", () => {
    expect(parseYoutubeVideoInput(`javascript:alert(1)//youtube.com/watch?v=${ID}`)).toEqual({ videoId: null, error: YOUTUBE_LINK_ERROR });
    expect(parseYoutubeVideoInput(`ftp://youtube.com/watch?v=${ID}`)).toEqual({ videoId: null, error: YOUTUBE_LINK_ERROR });
    const overlong = `https://youtu.be/${ID}?x=${"a".repeat(MAX_YOUTUBE_LINK_LENGTH)}`;
    const parsed = parseYoutubeVideoInput(overlong);
    expect(parsed.videoId).toBe(null);
    expect(parsed.error).toMatch(/too long/);
  });

  it("builds nocookie embed and watch URLs only for valid IDs", () => {
    expect(youtubeEmbedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}`);
    expect(youtubeEmbedUrl(ID)).not.toContain("autoplay");
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(youtubeEmbedUrl("short")).toBe(null);
    expect(youtubeEmbedUrl("dQw4w9WgXcQ?autoplay=1")).toBe(null);
    expect(youtubeWatchUrl("")).toBe(null);
    expect(isYoutubeVideoId(ID)).toBe(true);
    expect(isYoutubeVideoId("dQw4w9WgXcQ ")).toBe(false);
    expect(isYoutubeVideoId(null)).toBe(false);
    expect(isYoutubeVideoId(42)).toBe(false);
  });
});

const BASE_URL = "https://jwccyndyaamodxjtjtfo.supabase.co";
const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";
const MEDIA_PATH = "55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666.jpg";

function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PRODUCT_ID,
    slug: "sample-oxford-shirt",
    name: "Sample Oxford Shirt",
    description: "A crisp sample shirt for feed tests.",
    category_id: CATEGORY_ID,
    highlights: ["100% cotton"],
    tags: ["cotton"],
    badges: ["New Arrival"],
    created_at: "2026-11-15T00:00:00.000Z",
    published_at: "2026-11-15T01:00:00.000Z",
    variants: [
      { id: VARIANT_ID, size: "M", color: "Navy Blue", price_minor: 250000, sale_price_minor: null, available: 3 },
    ],
    media: [{ path: MEDIA_PATH, alt: "Front view" }],
    ...overrides,
  };
}

describe("publication projector video field", () => {
  it("projects the video ID only when present and valid", () => {
    const withVideo = projectPublishedAdminProduct(validRow({ youtube_video_id: ID }), BASE_URL);
    expect(withVideo?.youtubeVideoId).toBe(ID);
    const parsed = parsePublishedAdminRow(validRow({ youtube_video_id: ID }));
    expect(parsed?.youtube_video_id).toBe(ID);
  });

  it("omits the video field when absent or null (pre-migration rows)", () => {
    const absent = projectPublishedAdminProduct(validRow(), BASE_URL);
    expect(absent).not.toBe(null);
    expect(absent).not.toHaveProperty("youtubeVideoId");
    expect(parsePublishedAdminRow(validRow())?.youtube_video_id).toBe(null);
    const nulled = projectPublishedAdminProduct(validRow({ youtube_video_id: null }), BASE_URL);
    expect(nulled).not.toHaveProperty("youtubeVideoId");
  });

  it("degrades an invalid video value to no video without dropping the product", () => {
    for (const bad of ["short", "https://youtu.be/dQw4w9WgXcQ", 42, ["x"]]) {
      const product = projectPublishedAdminProduct(validRow({ youtube_video_id: bad }), BASE_URL);
      expect(product).not.toBe(null);
      expect(product).not.toHaveProperty("youtubeVideoId");
    }
  });
});

const IMAGES = [
  { src: "https://example.com/a.jpg", alt: "Front view" },
  { src: "https://example.com/b.jpg", alt: "Back view" },
];

describe("product gallery video slide", () => {
  it("renders zero video UI without a video ID", () => {
    const html = renderToStaticMarkup(
      createElement(ProductGallery, { images: IMAGES, productName: "Sample Shirt" }),
    );
    expect(html).not.toContain("Watch product video");
    expect(html).not.toContain("Show product video");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("youtube");
    expect(html).toContain("Show image 1 of 2");
  });

  it("renders zero video UI for an invalid video ID", () => {
    const html = renderToStaticMarkup(
      createElement(ProductGallery, { images: IMAGES, productName: "Sample Shirt", videoId: "not-an-id" }),
    );
    expect(html).not.toContain("Show product video");
    expect(html).not.toContain("<iframe");
  });

  it("renders a facade with no iframe before activation when a video is set", () => {
    const html = renderToStaticMarkup(
      createElement(ProductGallery, { images: IMAGES, productName: "Sample Shirt", videoId: ID }),
    );
    expect(html).toContain("Show product video");
    expect(html).toContain("Watch product video");
    expect(html).toContain("Show image 1 of 2");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("youtube-nocookie");
  });

  it("shows the video slide for a product with a video but no photos", () => {
    const html = renderToStaticMarkup(
      createElement(ProductGallery, { images: [], productName: "Sample Shirt", videoId: ID }),
    );
    expect(html).toContain("Show product video");
    expect(html).toContain("Watch product video");
    expect(html).not.toContain("No photo available for this product.");
    expect(html).not.toContain("<iframe");
  });
});

describe("youtube video player facade", () => {
  it("renders a labelled play button and no iframe before activation", () => {
    const html = renderToStaticMarkup(
      createElement(YoutubeVideoPlayer, { videoId: ID, title: "Sample Shirt" }),
    );
    expect(html).toContain("Watch product video: Sample Shirt");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("youtube-nocookie");
  });

  it("renders nothing for an invalid video ID", () => {
    expect(renderToStaticMarkup(createElement(YoutubeVideoPlayer, { videoId: "bogus", title: "X" }))).toBe("");
  });
});
