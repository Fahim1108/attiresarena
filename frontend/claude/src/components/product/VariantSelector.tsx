"use client";
import { canonicalSize } from "@/lib/catalogue-dimensions";

import { Check } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { isLightColor } from "@/lib/color";
import type { ColorOption } from "@/types";

/** Arrow/Home/End navigation for radiogroups: arrowing moves focus and selects, per the radio pattern. */
function onRadioGroupKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const options = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  const current = options.indexOf(e.target as HTMLButtonElement);
  if (current === -1 || !options.length) return;
  e.preventDefault();
  let next: number;
  if (e.key === "Home") next = 0;
  else if (e.key === "End") next = options.length - 1;
  else {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    next = (current + delta + options.length) % options.length;
  }
  const el = options[next];
  el?.focus();
  el?.click();
}

export function ColorSelector({ colors, value, onChange }: { colors: ColorOption[]; value: string; onChange: (id: string) => void }) {
  const selected = colors.find((c) => c.id === value);
  return (
    <fieldset>
      <legend className="mb-2.5 text-sm text-ink">
        Color: <span className="font-medium">{selected?.name}</span>
      </legend>
      <div className="flex flex-wrap gap-2.5" role="radiogroup" onKeyDown={onRadioGroupKeyDown}>
        {colors.map((c) => {
          const active = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={c.name}
              title={c.name}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(c.id)}
              className={cn("aa-press flex h-11 w-11 items-center justify-center rounded-full border-2 transition-[border-color]", active ? "border-primary" : "border-transparent hover:border-ink/25")}
            >
              <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", isLightColor(c.hex) && "ring-1 ring-inset ring-ink/15")} style={{ backgroundColor: c.hex }}>
                {active && <Check className={cn("h-4 w-4", isLightColor(c.hex) ? "text-ink" : "text-white")} aria-hidden />}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SizeSelector({ sizes, labels, locked = false, value, onChange, isAvailable, onSizeGuide, measurements, error }: { sizes: string[]; locked?: boolean; labels?: Record<string, string>; value?: string; onChange: (s: string) => void; isAvailable: (s: string) => boolean; onSizeGuide?: () => void; measurements?: Record<string, string>; error?: string }) {
  const labelId = useId();
  const errorId = useId();
  if (sizes.length === 1 && sizes[0] === "One Size") {
    return <p className="text-sm text-ink">Size: <span className="font-medium">One Size</span></p>;
  }
  const firstEnabled = sizes.findIndex((s) => !locked && isAvailable(s));
  // The selected size with its guide measurements, shown beside the
  // "Size:" line — "Size: M (Chest 40, Length 28–29)". Just the one size;
  // the option buttons below stay plain labels with nothing written in
  // them (Fahim, 2026-11-25).
  const selectedLabel = value
    ? labels?.[value] ?? labels?.[canonicalSize(value) ?? value] ?? canonicalSize(value) ?? value
    : null;
  const selectedMeasurement = value ? measurements?.[value] : undefined;
  const sizeLine = selectedLabel
    ? selectedMeasurement
      ? `${selectedLabel} (${selectedMeasurement})`
      : selectedLabel
    : "Select a size";
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <p id={labelId} className="text-sm text-ink">
          Size: <span className="font-medium">{sizeLine}</span>
        </p>
        {onSizeGuide && (
          <button type="button" onClick={onSizeGuide} className="text-xs text-primary underline underline-offset-4 hover:text-primary-dark">
            Size Guide
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={labelId} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onKeyDown={onRadioGroupKeyDown}>
        {sizes.map((s, i) => {
          const available = isAvailable(s);
          const active = s === value;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={available ? `Size ${s}` : `Size ${s}, ${locked ? "not available for this item" : "sold out"}`}
              disabled={locked || !available}
              tabIndex={active || (!value && i === firstEnabled) ? 0 : -1}
              onClick={() => { if (!locked) onChange(s); }}
              className={cn(
                "aa-press relative h-11 min-w-14 px-3 rounded-control border text-sm transition-colors",
                active ? "border-primary bg-primary text-white" : "border-line bg-surface text-ink hover:border-ink/50",
                !available && locked && "opacity-40",
                !available && !locked && "cursor-not-allowed text-ink-muted/50 hover:border-line",
              )}
            >
              {labels?.[s] ?? labels?.[canonicalSize(s) ?? s] ?? canonicalSize(s) ?? s}
            </button>
          );
        })}
      </div>
      {error && <p id={errorId} className="mt-2 text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}
