import type { AdminActionResult } from "@/lib/admin/authorization";

/** Shape of every sales Server Action used with useActionState. */
export type SalesAction = (
  prev: AdminActionResult | null,
  formData: FormData,
) => Promise<AdminActionResult>;

export type CsvExportResult =
  | { ok: true; csv: string; filename: string; truncated: boolean; total: number }
  | { ok: false; error: string };

export type OrdersExportAction = (input: {
  q: string;
  status: string;
  payment: string;
  from: string;
  to: string;
  sort: string;
}) => Promise<CsvExportResult>;

export type CustomersExportAction = (input: {
  q: string;
  sort: string;
}) => Promise<CsvExportResult>;

export type CouponTestAction = (input: {
  code: string;
  userId: string;
  phone: string;
  subtotal: string;
}) => Promise<
  | { ok: true; result: { valid: boolean; reason: string | null; discount_minor: number } }
  | { ok: false; error: string }
>;

/** Download a CSV string in the browser. No route handler is involved. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
