"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { downloadCsv, type CustomersExportAction, type CsvExportResult } from "./types";

export function CustomersExportButton({
  exportFilters,
  exportAction,
}: {
  exportFilters: { q: string; sort: string };
  exportAction: CustomersExportAction;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);

  const runExport = async () => {
    setBusy(true);
    setMessage(null);
    let result: CsvExportResult;
    try {
      result = await exportAction(exportFilters);
    } catch {
      setMessage({ text: "Export failed. Try again.", kind: "error" });
      setBusy(false);
      return;
    }
    if (!result.ok) {
      setMessage({ text: result.error, kind: "error" });
      setBusy(false);
      return;
    }
    downloadCsv(result.csv, result.filename);
    setMessage({
      text: result.truncated
        ? `Exported ${result.total} customers (totals cover the 5,000 most recent orders — narrow the search for a complete export).`
        : `Exported ${result.total} customer${result.total === 1 ? "" : "s"}.`,
      kind: "info",
    });
    setBusy(false);
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className="aa-secondary gap-2" onClick={runExport} disabled={busy}>
        <Download size={16} strokeWidth={1.6} aria-hidden="true" />
        {busy ? "Exporting…" : "Export CSV"}
      </button>
      {message ? (
        <span
          role={message.kind === "error" ? "alert" : "status"}
          className={message.kind === "error" ? "text-sm text-admin-danger" : "aa-hint"}
        >
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
