import type { SizeGuide } from "@/types";

/** Inline size-guide table for the product page Details section.
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
