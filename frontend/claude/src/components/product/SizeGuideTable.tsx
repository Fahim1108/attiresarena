import type { SizeGuide } from "@/types";

/** Bracket text for the size-selector buttons ("XL (Chest 44, Length 28–29)"),
 *  built from the guide's Chest/Length columns. A size with no usable
 *  measurements is omitted so its button shows just the label. */
export function sizeGuideMeasurements(guide: SizeGuide): Record<string, string> {
  const chestIdx = guide.columns.findIndex((c) => c.toLowerCase() === "chest");
  const lengthIdx = guide.columns.findIndex((c) => c.toLowerCase() === "length");
  const out: Record<string, string> = {};
  for (const row of guide.rows) {
    const size = row[0];
    if (!size) continue;
    const parts: string[] = [];
    const chest = chestIdx >= 0 ? row[chestIdx] : undefined;
    const length = lengthIdx >= 0 ? row[lengthIdx] : undefined;
    if (chest && chest !== "Not specified") parts.push(`Chest ${chest}`);
    if (length && length !== "Not specified") parts.push(`Length ${length}`);
    if (parts.length > 0) out[size] = parts.join(", ");
  }
  return out;
}

/** Inline size-guide table for the product page Size Guide section.
 *  Shown directly on the page — there is no Size Guide button or modal. */
export function SizeGuideTable({ guide }: { guide: SizeGuide }) {
  return (
    <div>
      <p className="text-base font-bold text-ink">{guide.title}</p>
      <p className="mt-1 text-xs text-ink-muted">All measurements in {guide.unit}.</p>
      <div className="-mx-1 mt-2 overflow-x-auto">
        <table className="w-full min-w-[320px] text-left text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line">
              {guide.columns.map((c) => (
                <th key={c} scope="col" className="px-2 py-2.5 text-sm font-bold uppercase tracking-wide text-ink">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {guide.rows.map((row) => (
              <tr key={row.join("-")} className="border-b border-line/70 last:border-0">
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="px-2 py-2.5 font-semibold text-ink">
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className="px-2 py-2.5 text-ink">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-muted">
        {guide.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
