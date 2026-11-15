"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import {
  countdownParts,
  resolveWidgetStyle,
  type Widget,
} from "@/lib/admin/reference-adapt";

const TITLE_SIZES: Record<Widget["title_size"], string> = {
  small: "text-lg sm:text-xl",
  medium: "text-[22px] sm:text-[26px]",
  large: "text-3xl sm:text-4xl",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * One homepage widget section. Countdown digits tick client-side only:
 * before the first tick the section shows the static end date, so server
 * and client render identically (no hydration mismatch). An ended
 * countdown renders nothing. The ticking digits are plain text (no live
 * region), so screen readers are not spammed every second.
 */
export function WidgetCountdown({ widget }: { widget: Widget }) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const style = resolveWidgetStyle(widget);
  const endsAt = widget.type === "countdown" ? widget.ends_at : null;
  const parts = endsAt !== null && nowMs !== null ? countdownParts(endsAt, nowMs) : null;
  if (parts?.expired) return null;
  const centered = widget.title_alignment === "center";

  return (
    <section
      className="container"
      aria-label={widget.title}
      data-widget={widget.id}
      style={{ backgroundColor: style.background }}
    >
      <div className="py-8 sm:py-10" style={{ textAlign: centered ? "center" : "left" }}>
        {widget.title_visible ? (
          <h2
            className={`mb-2 font-display font-semibold ${TITLE_SIZES[widget.title_size]}`}
            style={{ color: style.title }}
          >
            {widget.title}
          </h2>
        ) : null}
        {widget.subtitle ? (
          <p className="mb-2 text-[15px] leading-relaxed" style={{ color: style.content }}>
            {widget.subtitle}
          </p>
        ) : null}
        {widget.offer_title ? (
          <p className="mb-1 text-base font-semibold" style={{ color: style.title }}>
            {widget.offer_title}
          </p>
        ) : null}
        {widget.discount_text ? (
          <p className="mb-3 text-base font-semibold" style={{ color: style.accent }}>
            {widget.discount_text}
          </p>
        ) : null}
        {endsAt !== null ? (
          parts === null ? (
            <p className="text-sm" style={{ color: style.content }}>
              Ends {formatDate(endsAt)}
            </p>
          ) : (
            <div>
              <div
                className="flex flex-wrap gap-2 sm:gap-3"
                style={{ justifyContent: centered ? "center" : "flex-start" }}
              >
                {(
                  [
                    ["Days", parts.days],
                    ["Hours", parts.hours],
                    ["Minutes", parts.minutes],
                    ["Seconds", parts.seconds],
                  ] as const
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="min-w-[4.25rem] rounded-control border px-3 py-2 text-center"
                    style={{ borderColor: style.accent }}
                  >
                    <div
                      className="font-display text-2xl font-semibold tabular-nums"
                      style={{ color: style.title }}
                    >
                      {label === "Days" ? String(value) : pad(value)}
                    </div>
                    <div
                      className="text-xs uppercase tracking-wide"
                      style={{ color: style.content }}
                    >
                      {label}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-sm" style={{ color: style.content }}>
                Ends {formatDate(endsAt)}
              </p>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}
