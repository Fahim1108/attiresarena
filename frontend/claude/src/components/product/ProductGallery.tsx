"use client";

import { ChevronLeft, ChevronRight, Play, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal, SmartImage } from "@/components/ui";
import { cn } from "@/lib/cn";
import { isYoutubeVideoId } from "@/lib/youtube-video";
import type { ProductImage } from "@/types";
import { YoutubeVideoPlayer } from "./YoutubeVideoPlayer";

/**
 * Gallery with thumbnails, swipeable main image (mobile), hover zoom (desktop)
 * and a full-screen zoom modal. When `videoId` holds a valid YouTube video
 * ID, one extra slide follows the images: a click-to-load facade that only
 * creates the embed on activation. Without a valid ID the gallery behaves
 * exactly as before — no video UI of any kind.
 */
export function ProductGallery({ images, productName, videoId }: { images: ProductImage[]; productName: string; videoId?: string }) {
  const hasVideo = isYoutubeVideoId(videoId);
  const slideCount = images.length + (hasVideo ? 1 : 0);
  const videoIndex = images.length;
  const [index, setIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const [previousImages, setPreviousImages] = useState(images);
  if (images !== previousImages) { setPreviousImages(images); setIndex(0); }
  const [previousVideoId, setPreviousVideoId] = useState(videoId);
  if (videoId !== previousVideoId) { setPreviousVideoId(videoId); setIndex(0); }
  // Reset the external scroller when the image set changes.
  useEffect(() => {
    scroller.current?.scrollTo({ left: 0 });
  }, [images, videoId]);

  // Honest empty state: no feed today produces a product without
  // images, but a gallery must never render an empty box with a zoom
  // button that opens an empty modal if one ever arrives. A product
  // with a video but no photos still shows its video slide.
  if (images.length === 0 && !hasVideo) {
    return (
      <div className="flex aspect-[3/4] items-center justify-center rounded-card bg-[#F4F2F0]">
        <p className="text-sm text-ink-muted">No photo available for this product.</p>
      </div>
    );
  }

  const go = (i: number) => {
    if (slideCount === 0) return;
    const next = (i + slideCount) % slideCount;
    setIndex(next);
    const el = scroller.current;
    if (el) el.scrollTo({ left: next * el.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  // Zoom modal navigation stays image-only: the video slide has no zoom.
  // It still scrolls the main scroller, as the old shared handler did,
  // so the gallery behind the modal stays in sync with the index.
  const goImage = (i: number) => {
    if (images.length === 0) return;
    const next = (i + images.length) % images.length;
    setIndex(next);
    const el = scroller.current;
    if (el) el.scrollTo({ left: next * el.clientWidth });
  };

  const current = images[index];

  return (
    <div className="flex flex-col-reverse gap-3 lg:flex-row lg:gap-4">
      {/* Thumbnails */}
      <ul className="flex gap-2 overflow-x-auto scrollbar-none lg:w-[84px] lg:shrink-0 lg:flex-col" aria-label="Product images">
        {images.map((img, i) => (
          <li key={img.src} className="shrink-0">
            <button
              type="button"
              onClick={() => go(i)}
              aria-label={`Show image ${i + 1} of ${images.length}`}
              aria-current={i === index}
              className={cn("relative block h-[84px] w-[68px] overflow-hidden rounded bg-[#F4F2F0] ring-offset-2 transition-[opacity,box-shadow] lg:h-[104px] lg:w-[84px]", i === index ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100")}
            >
              <SmartImage src={img.src} alt="" fill sizes="84px" className="object-cover" />
            </button>
          </li>
        ))}
        {hasVideo && (
          <li className="shrink-0">
            <button
              type="button"
              onClick={() => go(videoIndex)}
              aria-label="Show product video"
              aria-current={videoIndex === index}
              className={cn("flex h-[84px] w-[68px] flex-col items-center justify-center gap-1 rounded bg-[#F4F2F0] ring-offset-2 transition-[opacity,box-shadow] lg:h-[104px] lg:w-[84px]", videoIndex === index ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100")}
            >
              <Play className="h-5 w-5 fill-current text-primary" aria-hidden />
              <span className="text-xs font-medium">Video</span>
            </button>
          </li>
        )}
      </ul>

      {/* Main image */}
      <div className="relative flex-1">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            const i = Math.min(Math.round(el.scrollLeft / el.clientWidth), Math.max(slideCount - 1, 0));
            if (i !== index) setIndex(i);
          }}
          className="flex snap-x snap-mandatory overflow-x-auto rounded-card bg-[#F4F2F0] scrollbar-none lg:overflow-hidden"
        >
          {images.map((img, i) => (
            <div
              key={img.src}
              className="relative aspect-[3/4] w-full shrink-0 snap-center cursor-zoom-in"
              onMouseMove={(e) => {
                if (window.matchMedia("(hover: none)").matches) return;
                const r = e.currentTarget.getBoundingClientRect();
                setLens({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
              }}
              onMouseLeave={() => setLens(null)}
              onClick={() => setZoomOpen(true)}
            >
              <SmartImage
                src={img.src}
                alt={img.alt}
                fill
                priority={i === 0}
                sizes="(min-width:1024px) 50vw, 100vw"
                className="object-cover transition-transform duration-200"
                style={lens && i === index ? { transform: "scale(1.8)", transformOrigin: `${lens.x}% ${lens.y}%` } : undefined}
              />
            </div>
          ))}
          {hasVideo && (
            <div className="relative aspect-[3/4] w-full shrink-0 snap-center">
              <YoutubeVideoPlayer videoId={videoId ?? ""} title={productName} />
            </div>
          )}
        </div>

        {current && (
          <button type="button" onClick={() => setZoomOpen(true)} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface/90 text-ink shadow-sm hover:bg-surface" aria-label="Open zoomed image">
            <ZoomIn className="h-4 w-4" aria-hidden />
          </button>
        )}
        {slideCount > 1 && (
          <>
            <button type="button" onClick={() => go(index - 1)} className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 shadow-sm hover:bg-surface lg:flex" aria-label="Previous slide">
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button type="button" onClick={() => go(index + 1)} className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 shadow-sm hover:bg-surface lg:flex" aria-label="Next slide">
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 lg:hidden" aria-hidden>
              {Array.from({ length: slideCount }, (_, i) => (
                <span key={i} className={cn("h-1.5 rounded-full transition-[width,background-color]", i === index ? "w-5 bg-primary" : "w-1.5 bg-ink/25")} />
              ))}
            </div>
          </>
        )}
      </div>

      <Modal open={zoomOpen} onClose={() => setZoomOpen(false)} title={productName} hideTitle className="sm:max-w-3xl">
        {current && (
          <div className="relative">
            <div className="relative mx-auto aspect-[3/4] max-h-[75vh] overflow-auto rounded bg-[#F4F2F0]">
              <SmartImage src={current.src} alt={current.alt} fill sizes="100vw" className="object-contain" />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button type="button" onClick={() => goImage(index - 1)} className="flex h-11 w-11 items-center justify-center rounded-full border border-line hover:border-ink" aria-label="Previous image">
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <span className="text-sm text-ink-muted">
                {index + 1} / {images.length}
              </span>
              <button type="button" onClick={() => goImage(index + 1)} className="flex h-11 w-11 items-center justify-center rounded-full border border-line hover:border-ink" aria-label="Next image">
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
