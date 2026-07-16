"use client";

import { Fragment } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";

import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import { CustomFieldCell } from "@/components/ui/CustomFieldCell";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import { Button } from "@/components/ui/button";
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
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  draft: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Draft" },
  sent: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "Sent" },
  accepted: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Accepted" },
  declined: { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40", label: "Declined" },
  expired: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Expired" },
};

function formatMoney(value: string | number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
}

const SORTABLE_COLUMNS = new Set([
  "quote_number",
  "title",
  "customer_name",
  "contact_id",
  "organization_id",
  "opportunity_id",
  "assigned_to",
  "status",
  "issue_date",
  "expiry_date",
  "currency",
  "subtotal_amount",
  "discount_amount",
  "tax_amount",
  "total_amount",
  "created_time",
  "updated_at",
]);

export default function QuotesTable({
  quotes,
  isLoading,
  isRefreshing = false,
  visibleColumns,
  columnOptions = [],
  selectedIds = [],
  currentPageSelectionState = false,
  onToggleRow,
  onToggleCurrentPage,
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  onClearFilters,
}: QuotesTableProps) {

  function toggleSort(column: string) {
    const nextSort: SortState = sort?.column === column
      ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
      : { column, direction: "asc" };
    onSortChange?.(nextSort);
  }

  function renderCell(quote: Quote, column: string) {
    if (isCustomFieldColumnKey(column)) return <CustomFieldCell column={column} values={quote.custom_fields} />;
    switch (column) {
      case "quote_number":
        return <TableCell className="sticky left-12 z-10 bg-surface"><Link href={`/dashboard/sales/quotes/${quote.quote_id}`} className="font-mono text-sm font-medium text-copy-primary hover:underline">{quote.quote_number}</Link></TableCell>;
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
              const sortable = !isCustomFieldColumnKey(column) && SORTABLE_COLUMNS.has(column);
              return sortable ? (
                <SortableHead key={column} sorted={sort?.column === column} direction={sort?.column === column ? sort.direction : "asc"} onClick={() => toggleSort(column)} className={column === "quote_number" ? "sticky left-12 z-20 bg-surface" : undefined}>
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
                <EmptyState icon={FileText} title={hasActiveFilters ? "No quotes match these filters" : "No quotes yet"} description={hasActiveFilters ? "Clear one or more filters and try again." : "Create a quote or import existing quotes from CSV."} action={hasActiveFilters && onClearFilters ? <Button type="button" variant="outline" onClick={onClearFilters}>Clear filters</Button> : <Button asChild><Link href="/dashboard/sales/quotes/new">Create quote</Link></Button>} />
              </TableCell>
            </TableRow>
          ) : (
            quotes.map((quote) => (
              <TableRow key={quote.quote_id}>
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
