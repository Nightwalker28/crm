import { Fragment } from "react";
import Image from "next/image";
import { FileSpreadsheet } from "lucide-react";
import type { InsertionOrder, InsertionOrderSortState } from "@/hooks/finance/useInsertionOrders";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
  SortableHead,
} from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { CustomFieldCell } from "@/components/ui/CustomFieldCell";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { Pill } from "@/components/ui/Pill";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { resolveMediaUrl } from "@/lib/media";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getInsertionOrderStatusStyle } from "@/lib/statusStyles";

type InsertionOrdersListProps = {
  orders: InsertionOrder[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onRowClick: (order: InsertionOrder) => void;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  selectedIds?: number[];
  currentPageSelectionState?: boolean | "indeterminate";
  onToggleRow?: (orderId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
  sort: InsertionOrderSortState;
  onSortChange: (sort: InsertionOrderSortState) => void;
};

function formatAmount(amount?: number | null, currency?: string): string {
  if (amount == null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function isDuePast(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  try {
    return new Date(dateStr) < new Date();
  } catch {
    return false;
  }
}

function statusBorderClass(status?: string | null) {
  switch (status) {
    case "issued":
      return "border-l-2 border-l-sky-400";
    case "active":
      return "border-l-2 border-l-emerald-400";
    case "completed":
      return "border-l-2 border-l-teal-600";
    case "cancelled":
      return "border-l-2 border-l-red-500";
    default:
      return "border-l-2 border-l-neutral-700";
  }
}

export default function InsertionOrdersList({
  orders,
  isLoading,
  isRefreshing = false,
  onRowClick,
  visibleColumns,
  columnOptions = [],
  selectedIds = [],
  currentPageSelectionState = false,
  onToggleRow,
  onToggleCurrentPage,
  sort,
  onSortChange,
}: InsertionOrdersListProps) {
  const columnCount = visibleColumns.length + 1;
  const headers: Record<string, string> = {
    io_number: "IO Number",
    customer_name: "Customer",
    status: "Status",
    currency: "Currency",
    total_amount: "Total",
    issue_date: "Issue Date",
    due_date: "Due Date",
    external_reference: "Reference",
    user_name: "Owner",
    updated_at: "Updated",
  };

  const renderCell = (order: InsertionOrder, column: string) => {
    if (isCustomFieldColumnKey(column)) {
      return <CustomFieldCell column={column} values={order.custom_fields} />;
    }

    switch (column) {
      case "io_number":
        return (
          <TableCell>
            <span className="text-xs font-bold text-neutral-300 tracking-wider font-mono bg-neutral-800/60 border border-neutral-700/50 rounded px-2 py-0.5">
              {order.io_number || <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      case "customer_name":
        return (
          <TableCell>
            <div className="flex items-center gap-2">
              {order.photo_url ? (
                <Image
                  src={resolveMediaUrl(order.photo_url)}
                  alt={order.user_name ?? ""}
                  width={24}
                  height={24}
                  unoptimized
                  className="h-6 w-6 rounded-full object-cover shrink-0"
                />
              ) : null}
              <span className="text-sm font-medium text-neutral-100 truncate max-w-[180px]">
                {order.customer_name || <span className="text-neutral-600">—</span>}
              </span>
            </div>
          </TableCell>
        );
      case "status":
        return (
          <TableCell>
            {order.status ? (() => {
              const style = getInsertionOrderStatusStyle(order.status);
              return (
                <Pill bg={style.bg} text={style.text} border={style.border} className="w-24">
                  {style.label}
                </Pill>
              );
            })() : <span className="text-neutral-600 text-sm">—</span>}
          </TableCell>
        );
      case "currency":
        return (
          <TableCell>
            <span className="text-xs font-bold text-neutral-400 tracking-wider bg-neutral-800/60 border border-neutral-700/50 rounded px-1.5 py-0.5">
              {order.currency || "—"}
            </span>
          </TableCell>
        );
      case "total_amount":
        return (
          <TableCell>
            {order.total_amount != null ? (
              <span className="text-sm font-semibold text-emerald-300 tabular-nums">
                {formatAmount(order.total_amount, order.currency)}
              </span>
            ) : (
              <span className="text-neutral-600 text-sm">—</span>
            )}
          </TableCell>
        );
      case "issue_date":
        return (
          <TableCell>
            <span className="text-sm text-neutral-400 tabular-nums">
              {order.issue_date ? formatDateOnly(order.issue_date) : <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      case "due_date":
        return (
          <TableCell>
            {order.due_date ? (
              <span className={`text-sm font-medium tabular-nums ${
                isDuePast(order.due_date) && order.status !== "completed" && order.status !== "cancelled"
                  ? "text-red-400"
                  : "text-neutral-300"
              }`}>
                {formatDateOnly(order.due_date)}
              </span>
            ) : (
              <span className="text-neutral-600 text-sm">—</span>
            )}
          </TableCell>
        );
      case "external_reference":
        return (
          <TableCell>
            <span className="text-sm text-neutral-400 font-mono tracking-tight truncate block max-w-[140px]">
              {order.external_reference || <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      case "user_name":
        return (
          <TableCell>
            <span className="text-sm text-neutral-400">
              {order.user_name || <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      case "updated_at":
        return (
          <TableCell>
            <span className="text-sm text-neutral-500 tabular-nums">
              {order.updated_at ? formatDateTime(order.updated_at, { hour: "numeric", minute: "2-digit" }) : <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      default:
        return null;
    }
  };

  function toggleSort(column: string) {
    const nextSort: InsertionOrderSortState =
      sort?.column === column
        ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" };
    onSortChange(nextSort);
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[1040px]">
        <TableHeader>
          <TableHeaderRow>
            <TableHead className="w-12 pr-0">
              <Checkbox
                checked={currentPageSelectionState}
                onCheckedChange={(checked) => onToggleCurrentPage?.(checked === true)}
                className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                aria-label="Select current page insertion orders"
              >
                <CheckboxIndicator className="h-3 w-3" />
              </Checkbox>
            </TableHead>
            {visibleColumns.map((column) => {
              const label = headers[column] ?? getReadableColumnLabel(column, columnOptions);
              const sortable = !isCustomFieldColumnKey(column) && ["io_number", "customer_name", "status", "total_amount", "issue_date", "due_date", "updated_at"].includes(column);
              return sortable ? (
                <SortableHead
                  key={column}
                  sorted={sort?.column === column}
                  direction={sort?.column === column ? sort.direction : "asc"}
                  onClick={() => toggleSort(column)}
                >
                  {label}
                </SortableHead>
              ) : (
                <TableHead key={column}>{label}</TableHead>
              );
            })}
          </TableHeaderRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={columnCount} />
          ) : orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-16 text-center">
                <EmptyState icon={FileSpreadsheet} title="No insertion orders found" description="Insertion orders matching the current view will appear here." />
              </TableCell>
            </TableRow>
          ) : (
            orders.map((order) => (
              <TableRow
                key={order.id}
                className={`group cursor-pointer ${statusBorderClass(order.status)}`}
                onClick={() => onRowClick(order)}
              >
                <TableCell
                  className="w-12 pr-0"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    checked={selectedIds.includes(order.id)}
                    onCheckedChange={(checked) => onToggleRow?.(order.id, checked === true)}
                    className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                    aria-label={`Select insertion order ${order.io_number}`}
                  >
                    <CheckboxIndicator className="h-3 w-3" />
                  </Checkbox>
                </TableCell>
                {visibleColumns.map((column) => (
                  <Fragment key={column}>{renderCell(order, column)}</Fragment>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
