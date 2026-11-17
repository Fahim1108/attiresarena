"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnHelper,
  type Header,
  type PaginationState,
  type RowData,
  type SortingState,
  type TableFeatures,
} from "@tanstack/react-table";
import { DEFAULT_PAGE_SIZE } from "@/lib/admin/constants";
import { cn } from "@/design-system/cn";

/**
 * TanStack Table v9 native API (features-based; no legacy shim).
 * The feature set is module-level and shared: sorting + pagination
 * with their row models and the built-in sort-function registry.
 * Only these features ship — v9 tree-shakes the rest away.
 */
const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns,
});

export type DataTableFeatures = typeof dataTableFeatures;

/** Column definition type bound to this wrapper's feature set. */
export type DataTableColumnDef<TData extends RowData, TValue = unknown> =
  ColumnDef<DataTableFeatures, TData, TValue>;

/** Column helper bound to this wrapper's feature set. */
export function dataTableColumnHelper<TData extends RowData>(): ColumnHelper<
  DataTableFeatures,
  TData
> {
  return createColumnHelper<DataTableFeatures, TData>();
}

export type { RowData, TableFeatures };

/**
 * DataTable — TanStack Table wrapper: client-side sorting, pagination,
 * honest empty state, responsive scroll. Props-driven: the caller owns
 * columns and rows (real data only). No fetching, no server actions.
 *
 * At 390px the table scrolls horizontally inside its container; pages
 * should choose narrow column sets for phone widths. Sorting and
 * pagination are buttons with accessible names; the sorted column
 * carries aria-sort. Numbers in cells should use tabular figures via
 * the `.admin-ds-numeric` class in the cell renderer.
 */

/** "1–10 of 42", "0 results" when empty. Pure; unit-tested. */
export function dataTablePageLabel({
  pageIndex,
  pageSize,
  total,
}: {
  pageIndex: number;
  pageSize: number;
  total: number;
}): string {
  if (total <= 0) return "0 results";
  const start = pageIndex * pageSize + 1;
  const end = Math.min(total, (pageIndex + 1) * pageSize);
  return `${start}–${end} of ${total}`;
}

/** Snap a requested page size to an offered option. Pure; unit-tested. */
export function normalizePageSize(
  requested: number | undefined,
  options: readonly number[],
): number {
  const fallback = options[0] ?? DEFAULT_PAGE_SIZE;
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return options.includes(requested) ? requested : fallback;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function headerLabel<TData extends RowData>(
  header: Header<DataTableFeatures, TData, unknown>,
): string {
  const defined = header.column.columnDef.header;
  return typeof defined === "string" ? defined : header.column.id;
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  ariaLabel,
  caption,
  emptyTitle = "No results",
  emptyDescription,
  emptyAction,
  pageSize,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  className,
}: {
  columns: DataTableColumnDef<TData, unknown>[];
  data: TData[];
  /** Accessible name for the table (required: tables need names). */
  ariaLabel: string;
  /** Visually hidden caption describing the table, when useful. */
  caption?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  className?: string;
}) {
  const pageSizeId = useId();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: normalizePageSize(pageSize, pageSizeOptions),
  });

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  });

  const rows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const canPrevious = table.getCanPreviousPage();
  const canNext = table.getCanNextPage();

  return (
    <div className={cn("font-admin-sans", className)}>
      <div className="overflow-x-auto rounded-admin-card border border-admin-border bg-admin-card shadow-admin-card">
        <table
          aria-label={ariaLabel}
          className="w-full min-w-[560px] border-collapse text-sm text-admin-text"
        >
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="border-b border-admin-border bg-admin-bg"
              >
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const sortable = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sortable
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                      className="px-4 py-3 text-left text-xs font-medium text-admin-text-secondary"
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={() =>
                            header.column.toggleSorting(
                              sorted === "asc" ? true : undefined,
                            )
                          }
                          aria-label={`Sort by ${headerLabel(header)}`}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-admin-control px-1 py-0.5 text-left transition-colors hover:text-admin-text"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sorted === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <p className="text-sm font-medium text-admin-text">
                    {emptyTitle}
                  </p>
                  {emptyDescription ? (
                    <p className="mx-auto mt-1 max-w-sm text-[13px] leading-5 text-admin-text-secondary">
                      {emptyDescription}
                    </p>
                  ) : null}
                  {emptyAction ? (
                    <div className="mt-4 flex justify-center">{emptyAction}</div>
                  ) : null}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-admin-border transition-colors last:border-b-0 hover:bg-admin-bg"
                >
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className="min-w-0 px-4 py-3 align-top">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite" className="text-[13px] text-admin-text-secondary">
          {dataTablePageLabel({
            pageIndex: pagination.pageIndex,
            pageSize: pagination.pageSize,
            total: data.length,
          })}
          {pageCount > 0 ? ` · Page ${pagination.pageIndex + 1} of ${pageCount}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor={pageSizeId}
            className="text-[13px] text-admin-text-secondary"
          >
            Rows per page
          </label>
          <select
            id={pageSizeId}
            value={pagination.pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
            className="h-9 cursor-pointer rounded-admin-control border border-admin-border bg-admin-card px-2 text-sm text-admin-text"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => table.previousPage()}
            disabled={!canPrevious}
            aria-label="Previous page"
            className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-admin-control border border-admin-border bg-admin-card px-3 text-sm text-admin-text transition-colors hover:bg-admin-soft-bg disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:h-11"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Previous
          </button>
          <button
            type="button"
            onClick={() => table.nextPage()}
            disabled={!canNext}
            aria-label="Next page"
            className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-admin-control border border-admin-border bg-admin-card px-3 text-sm text-admin-text transition-colors hover:bg-admin-soft-bg disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:h-11"
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
