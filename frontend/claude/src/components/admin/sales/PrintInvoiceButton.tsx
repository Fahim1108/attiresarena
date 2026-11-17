"use client";

import { Printer } from "lucide-react";

/** Prints the order detail page; non-invoice sections carry aa-no-print. */
export function PrintInvoiceButton() {
  return (
    <button
      type="button"
      className="aa-secondary gap-2 aa-no-print"
      onClick={() => window.print()}
    >
      <Printer size={16} strokeWidth={1.6} aria-hidden="true" />
      Print invoice
    </button>
  );
}
