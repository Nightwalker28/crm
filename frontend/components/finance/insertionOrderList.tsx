"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";

import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
import { CustomFieldValue } from "@/components/ui/CustomFieldValue";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import type { InsertionOrder } from "@/hooks/finance/useInsertionOrders";
import type { TableColumnOption } from "@/types/table";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { resolveMediaUrl } from "@/lib/media";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getInsertionOrderStatus } from "@/lib/statusStyles";
import { formatMoney } from "@/lib/currency";

type InsertionOrdersListProps = {
  orders: InsertionOrder[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  selectedIds?: number[];
  onToggleRow?: (orderId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
  sort: RecordTableSort | null;
  onSortChange: (sort: RecordTableSort) => void;
  selectionEnabled?: boolean;
  hasActiveFilters?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  canCreate?: boolean;
  onClearFilters?: () => void;
};

const HEADERS: Record<string, string> = {
  io_number: "IO Number",
  customer_name: "Customer",
  status: "Status",
  currency: "Currency",
  subtotal_amount: "Subtotal",
  tax_amount: "Tax",
  total_amount: "Total",
  issue_date: "Issue Date",
  effective_date: "Effective",
  due_date: "Due Date",
  start_date: "Start Date",
  end_date: "End Date",
  external_reference: "Reference",
  counterparty_reference: "Counterparty Ref",
  user_name: "Owner",
  updated_at: "Updated",
};

const SORTABLE_COLUMNS = new Set([
  "io_number",
  "customer_name",
  "status",
  "currency",
  "subtotal_amount",
  "tax_amount",
  "total_amount",
  "issue_date",
  "effective_date",
  "due_date",
  "start_date",
  "end_date",
  "external_reference",
  "counterparty_reference",
  "updated_at",
]);

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  customer_name: "lg",
  io_number: "sm",
  status: "sm",
  currency: "sm",
};

const MONEY_COLUMNS = new Set(["total_amount", "subtotal_amount", "tax_amount"]);
const DATE_COLUMNS = new Set(["issue_date", "effective_date", "start_date", "end_date"]);

// Empty string rather than a placeholder: the call site branches on it. Formatting is
// lib/currency.ts's (design.md 7.1).
function formatAmount(amount?: number | null, currency?: string): string {
  return formatMoney(amount, currency, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) ?? "";
}

function isDuePast(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  try {
    return new Date(dateStr) < new Date();
  } catch {
    return false;
  }
}

function emptyValue() {
  return <span className="text-sm text-copy-disabled">—</span>;
}

function renderCell(order: InsertionOrder, column: string) {
  if (isCustomFieldColumnKey(column)) return <CustomFieldValue column={column} values={order.custom_fields} />;

  if (DATE_COLUMNS.has(column)) {
    const value = order[column as keyof InsertionOrder];
    return typeof value === "string" && value
      ? <span className="text-sm tabular-nums text-copy-secondary">{formatDateOnly(value)}</span>
      : emptyValue();
  }

  if (MONEY_COLUMNS.has(column)) {
    const amount = order[column as keyof InsertionOrder];
    return typeof amount === "number"
      ? <span className="text-sm font-semibold tabular-nums text-copy-primary">{formatAmount(amount, order.currency)}</span>
      : emptyValue();
  }

  switch (column) {
    case "io_number":
      return order.io_number
        ? <span className="text-sm font-medium tabular-nums text-copy-primary">{order.io_number}</span>
        : emptyValue();
    case "customer_name":
      return (
        <span className="block max-w-[180px] truncate text-sm font-medium text-copy-primary">
          {order.customer_name || emptyValue()}
        </span>
      );
    case "status": {
      if (!order.status) return emptyValue();
      const style = getInsertionOrderStatus(order.status);
      return <StatusValue status={style} className="w-24" />;
    }
    case "currency":
      return (
        <span className="rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-copy-secondary">
          {order.currency || "—"}
        </span>
      );
    case "due_date": {
      if (!order.due_date) return emptyValue();
      const overdue = isDuePast(order.due_date) && order.status !== "completed" && order.status !== "cancelled";
      return (
        <span className={`text-sm font-medium tabular-nums ${overdue ? "text-state-danger" : "text-copy-primary"}`}>
          {formatDateOnly(order.due_date)}
        </span>
      );
    }
    case "external_reference":
    case "counterparty_reference": {
      const value = order[column as keyof InsertionOrder];
      return typeof value === "string" && value
        ? <span className="block max-w-[140px] truncate text-sm text-copy-secondary">{value}</span>
        : emptyValue();
    }
    case "user_name":
      return (
        <div className="flex items-center gap-2">
          {order.photo_url ? (
            <Image
              src={resolveMediaUrl(order.photo_url)}
              alt=""
              width={24}
              height={24}
              unoptimized
              className="size-6 shrink-0 rounded-full object-cover"
            />
          ) : null}
          {order.user_name ? <span className="text-sm text-copy-secondary">{order.user_name}</span> : emptyValue()}
        </div>
      );
    case "updated_at":
      return (
        <span className="text-sm tabular-nums text-copy-muted">
          {order.updated_at ? formatDateTime(order.updated_at, { hour: "numeric", minute: "2-digit" }) : emptyValue()}
        </span>
      );
    default:
      return null;
  }
}

export default function InsertionOrdersList({
  orders,
  isLoading,
  isRefreshing = false,
  visibleColumns,
  columnOptions = [],
  selectedIds = [],
  onToggleRow,
  onToggleCurrentPage,
  sort,
  onSortChange,
  selectionEnabled = true,
  hasActiveFilters = false,
  hasError = false,
  onRetry,
  canCreate = false,
  onClearFilters,
}: InsertionOrdersListProps) {
  const columns = useMemo<RecordTableColumn<InsertionOrder>[]>(
    () =>
      visibleColumns.map((column) => ({
        key: column,
        label: HEADERS[column] ?? getReadableColumnLabel(column, columnOptions),
        sortable: !isCustomFieldColumnKey(column) && SORTABLE_COLUMNS.has(column),
        size: COLUMN_SIZES[column],
        align: MONEY_COLUMNS.has(column) ? "right" : "left",
        render: (order) => renderCell(order, column),
      })),
    [visibleColumns, columnOptions],
  );

  return (
    <RecordTable
      label="Insertion orders"
      columns={columns}
      rows={orders}
      rowKey={(order) => order.id}
      rowHref={(order) => `/dashboard/finance/insertion-orders/${order.id}`}
      rowLabel={(order) => `Open insertion order ${order.io_number ?? order.id}`}
      selection={
        selectionEnabled && onToggleRow && onToggleCurrentPage
          ? {
              selectedIds,
              onToggleRow: (id, checked) => onToggleRow(Number(id), checked),
              onToggleAll: onToggleCurrentPage,
              rowLabel: (order) => `Select insertion order ${order.io_number ?? order.id}`,
            }
          : undefined
      }
      sort={sort}
      onSortChange={onSortChange}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      errorState={{ title: "Insertion orders could not be loaded" }}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      emptyState={{
        icon: FileSpreadsheet,
        title: "No insertion orders yet",
        description: canCreate
          ? "Create or import the first insertion order."
          : "Insertion orders will appear here when a teammate creates one.",
        action: canCreate
          ? <Button asChild><Link href="/dashboard/finance/insertion-orders/new">Create insertion order</Link></Button>
          : undefined,
      }}
      filteredEmptyState={{
        icon: FileSpreadsheet,
        title: "No insertion orders match this view",
        description: "Clear the search or filters and try again.",
      }}
    />
  );
}
