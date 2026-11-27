"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./sales/order-cards.module.css";

/** Small copy-to-clipboard button for admin list values (TxID, sender
 * number, amounts). Clipboard API with a textarea + execCommand fallback,
 * same pattern as PaymentVerificationCard. Icon-only ("icon") for tight
 * desktop columns, labelled ("text") for expanded card details. Styles
 * live in order-cards.module.css — the only CSS this slice touches. */
export function CopyButton({
  value,
  label,
  variant = "text",
}: {
  /** Exact text placed on the clipboard. */
  value: string;
  /** Accessible name, e.g. "Copy Transaction ID". */
  label: string;
  /** "text" shows Copy/Copied; "icon" is icon-only. */
  variant?: "icon" | "text";
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable (older browsers, insecure context):
      // fall back to a selected textarea so the copy still works.
      try {
        const area = document.createElement("textarea");
        area.value = value;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      } catch {
        // Nothing more to try; leave the button state unchanged.
        return;
      }
    }
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      className={
        variant === "icon"
          ? styles.copyButtonIcon
          : `aa-secondary inline-flex items-center gap-1 ${styles.copyButtonText}`
      }
      onClick={copy}
      aria-label={label}
    >
      {copied ? (
        <Check size={14} strokeWidth={2} aria-hidden="true" />
      ) : (
        <Copy size={14} strokeWidth={2} aria-hidden="true" />
      )}
      {variant === "text" ? (copied ? "Copied" : "Copy") : null}
    </button>
  );
}
