"use client";

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
  const [message, setMessage] = useState<string | null>(null);

  const runExport = async () => {
    setBusy(true);
    setMessage(null);
    let result: CsvExportResult;
    try {
      result = await exportAction(exportFilters);
    } catch {
      setMessage("Export failed. Try again.");
      setBusy(false);
      return;
    }
    if (!result.ok) {
      setMessage(result.error);
      setBusy(false);
      return;
    }
    downloadCsv(result.csv, result.filename);
    setMessage(
      result.truncated
        ? `Exported ${result.total} customers (totals cover the 5,000 most recent orders — narrow the search for a complete export).`
        : `Exported ${result.total} customer${result.total === 1 ? "" : "s"}.`,
    );
    setBusy(false);
  };

  return (
    <span>
      <button type="button" className="aa-secondary" onClick={runExport} disabled={busy}>
        {busy ? "Exporting…" : "Export CSV"}
      </button>{" "}
      {message ? (
        <span role="status" className="aa-hint">
          {message}
        </span>
      ) : null}
    </span>
  );
}
