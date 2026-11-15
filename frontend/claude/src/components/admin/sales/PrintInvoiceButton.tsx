"use client";

/** Prints the order detail page; non-invoice sections carry aa-no-print. */
export function PrintInvoiceButton() {
  return (
    <button type="button" className="aa-secondary aa-no-print" onClick={() => window.print()}>
      Print invoice
    </button>
  );
}
