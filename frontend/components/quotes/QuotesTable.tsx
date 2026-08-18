"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";

import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
import { CustomFieldValue } from "@/components/ui/CustomFieldValue";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import type { Quote } from "@/hooks/sales/useQuotes";
import type { TableColumnOption } from "@/types/table";
import { formatDateOnly } from "@/lib/datetime";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { getQuoteStatus } from "@/lib/statusStyles";
import { Money } from "@/components/ui/Money";

type QuotesTableProps = {
  quotes: Quote[];
  isLoading: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  selectedIds?: number[];
  onToggleRow?: (quoteId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
  sort?: RecordTableSort | null;
  onSortChange?: (sort: RecordTableSort) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
};

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

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  title: "lg",
  customer_name: "lg",
  status: "sm",
  currency: "sm",
  quote_number: "sm",
};

const MONEY_COLUMNS = new Set(["subtotal_amount", "discount_amount", "tax_amount", "total_amount"]);

function renderCell(quote: Quote, column: string) {
  if (isCustomFieldColumnKey(column)) return <CustomFieldValue column={column} values={quote.custom_fields} />;

  switch (column) {
    case "quote_number":
      return <span className="text-sm font-medium tabular-nums text-copy-primary">{quote.quote_number}</span>;
    case "status": {
      const style = getQuoteStatus(quote.status ?? "");
      return <StatusValue status={style} />;
    }
    case "issue_date":
    case "expiry_date":
      return (
        <span className="text-sm text-copy-muted">
          {quote[column as keyof Quote] ? formatDateOnly(String(quote[column as keyof Quote])) : "-"}
        </span>
      );
    case "subtotal_amount":
    case "discount_amount":
    case "tax_amount":
    case "total_amount":
      return (
        <span className="text-sm text-copy-primary">
          <Money amount={quote[column as keyof Quote] as string | number | null} currency={quote.currency} />
        </span>
      );
    default:
      return (
        <span className="text-sm text-copy-secondary">
          {String(quote[column as keyof Quote] ?? "") || <span className="text-copy-disabled">-</span>}
        </span>
      );
  }
}

export default function QuotesTable({
  quotes,
  isLoading,
  isRefreshing = false,
  hasError = false,
  onRetry,
  visibleColumns,
  columnOptions = [],
  selectedIds = [],
  onToggleRow,
  onToggleCurrentPage,
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  onClearFilters,
}: QuotesTableProps) {
  const columns = useMemo<RecordTableColumn<Quote>[]>(
    () =>
      visibleColumns.map((column) => ({
        key: column,
        label: getReadableColumnLabel(column, columnOptions),
        sortable: !isCustomFieldColumnKey(column) && SORTABLE_COLUMNS.has(column),
        size: COLUMN_SIZES[column],
        align: MONEY_COLUMNS.has(column) ? "right" : "left",
        render: (quote) => renderCell(quote, column),
      })),
    [visibleColumns, columnOptions],
  );

  return (
    <RecordTable
      label="Quotes"
      columns={columns}
      rows={quotes}
      rowKey={(quote) => quote.quote_id}
      rowHref={(quote) => `/dashboard/sales/quotes/${quote.quote_id}`}
      rowLabel={(quote) => `Open quote ${quote.quote_number}`}
      selection={
        onToggleRow && onToggleCurrentPage
          ? {
              selectedIds,
              onToggleRow: (id, checked) => onToggleRow(Number(id), checked),
              onToggleAll: onToggleCurrentPage,
              rowLabel: (quote) => `Select quote ${quote.quote_number}`,
            }
          : undefined
      }
      sort={sort}
      onSortChange={onSortChange}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      emptyState={{
        icon: FileText,
        title: "No quotes yet",
        description: "Create a quote or import existing quotes from CSV.",
        action: <Button asChild><Link href="/dashboard/sales/quotes/new">Create quote</Link></Button>,
      }}
      filteredEmptyState={{ icon: FileText }}
    />
  );
}
