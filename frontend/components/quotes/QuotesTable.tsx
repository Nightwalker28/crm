"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";

import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import { CustomFieldCell } from "@/components/ui/CustomFieldCell";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import type { Quote } from "@/hooks/sales/useQuotes";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { formatDateOnly } from "@/lib/datetime";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";

type SortState = { column: string; direction: "asc" | "desc" } | null;

type QuotesTableProps = {
  quotes: Quote[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  selectedIds?: number[];
  currentPageSelectionState?: boolean | "indeterminate";
  onToggleRow?: (quoteId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  draft: { bg: "bg-neutral-800/40", text: "text-neutral-300", border: "border-neutral-700/40", label: "Draft" },
  sent: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40", label: "Sent" },
  accepted: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-700/40", label: "Accepted" },
  declined: { bg: "bg-red-900/30", text: "text-red-300", border: "border-red-700/40", label: "Declined" },
  expired: { bg: "bg-amber-900/30", text: "text-amber-300", border: "border-amber-700/40", label: "Expired" },
};

function formatMoney(value: string | number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
}

export default function QuotesTable({ quotes, isLoading, isRefreshing = false, visibleColumns, columnOptions = [], selectedIds = [], currentPageSelectionState = false, onToggleRow, onToggleCurrentPage }: QuotesTableProps) {
  const router = useRouter();
  const [sort, setSort] = useState<SortState>(null);
  const sortedQuotes = useMemo(() => {
    if (!sort) return quotes;
    return [...quotes].sort((left, right) => {
      const leftValue = String(left[sort.column as keyof Quote] ?? "").toLowerCase();
      const rightValue = String(right[sort.column as keyof Quote] ?? "").toLowerCase();
      const result = leftValue.localeCompare(rightValue, undefined, { numeric: true });
      return sort.direction === "asc" ? result : -result;
    });
  }, [quotes, sort]);

  function toggleSort(column: string) {
    setSort((current) => current?.column !== column ? { column, direction: "asc" } : { column, direction: current.direction === "asc" ? "desc" : "asc" });
  }

  function renderCell(quote: Quote, column: string) {
    if (isCustomFieldColumnKey(column)) return <CustomFieldCell column={column} values={quote.custom_fields} />;
    switch (column) {
      case "quote_number":
        return <TableCell><span className="font-mono text-sm font-medium text-neutral-100">{quote.quote_number}</span></TableCell>;
      case "status": {
        const style = STATUS_STYLES[quote.status ?? ""] ?? STATUS_STYLES.draft;
        return <TableCell><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>;
      }
      case "issue_date":
      case "expiry_date":
        return <TableCell><span className="text-sm text-neutral-400">{quote[column as keyof Quote] ? formatDateOnly(String(quote[column as keyof Quote])) : "-"}</span></TableCell>;
      case "subtotal_amount":
      case "discount_amount":
      case "tax_amount":
      case "total_amount":
        return <TableCell><span className="text-sm tabular-nums text-neutral-200">{formatMoney(quote[column as keyof Quote] as string | number | null, quote.currency)}</span></TableCell>;
      default:
        return <TableCell><span className="text-sm text-neutral-300">{String(quote[column as keyof Quote] ?? "") || <span className="text-neutral-600">-</span>}</span></TableCell>;
    }
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[980px]">
        <TableHeader>
          <TableHeaderRow>
            <TableHead className="w-12 pr-0">
              <Checkbox checked={currentPageSelectionState} onCheckedChange={(checked) => onToggleCurrentPage?.(checked === true)} className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900" aria-label="Select current page quotes">
                <CheckboxIndicator className="h-3 w-3" />
              </Checkbox>
            </TableHead>
            {visibleColumns.map((column) => {
              const label = getReadableColumnLabel(column, columnOptions);
              const sortable = !isCustomFieldColumnKey(column) && ["quote_number", "customer_name", "status", "total_amount", "expiry_date"].includes(column);
              return sortable ? (
                <SortableHead key={column} sorted={sort?.column === column} direction={sort?.column === column ? sort.direction : "asc"} onClick={() => toggleSort(column)}>
                  {label}
                </SortableHead>
              ) : <TableHead key={column}>{label}</TableHead>;
            })}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={visibleColumns.length + 1} />
          ) : quotes.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1} className="py-16 text-center">
                <EmptyState icon={FileText} title="No quotes found" description="Quotes matching the current view will appear here." />
              </TableCell>
            </TableRow>
          ) : (
            sortedQuotes.map((quote) => (
              <TableRow key={quote.quote_id} className="group cursor-pointer" onClick={() => router.push(`/dashboard/sales/quotes/${quote.quote_id}`)}>
                <TableCell className="w-12 pr-0" onClick={(event) => event.stopPropagation()}>
                  <Checkbox checked={selectedIds.includes(quote.quote_id)} onCheckedChange={(checked) => onToggleRow?.(quote.quote_id, checked === true)} className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900" aria-label={`Select quote ${quote.quote_number}`}>
                    <CheckboxIndicator className="h-3 w-3" />
                  </Checkbox>
                </TableCell>
                {visibleColumns.map((column) => <Fragment key={column}>{renderCell(quote, column)}</Fragment>)}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
