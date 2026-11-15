"use client";

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
    <span>
      <button type="button" className="aa-button" onClick={download} disabled={busy}>
        {busy ? "Preparing…" : "Download daily sales CSV"}
      </button>
      {error ? (
        <span role="alert" style={{ marginLeft: "0.6rem", color: "#7a1010" }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
