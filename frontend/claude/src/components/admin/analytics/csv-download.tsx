"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import type { CsvExportResult } from "@/lib/admin/analytics";

export function CsvDownloadButton({
  action,
  from,
  to,
}: {
  action: (form: FormData) => Promise<CsvExportResult>;
  from: string;
  to: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("from", from);
      form.set("to", to);
      const result = await action(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("The CSV could not be generated. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-2 rounded-admin-control bg-admin-primary px-4 text-sm font-medium text-white transition-colors hover:bg-admin-primary/90"
        onClick={download}
        disabled={busy}
      >
        <Download size={16} strokeWidth={1.6} aria-hidden="true" />
        {busy ? "Preparing…" : "Download daily sales CSV"}
      </button>
      {error ? (
        <span role="alert" className="text-sm text-admin-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
