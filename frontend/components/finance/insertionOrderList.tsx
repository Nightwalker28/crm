import { Fragment } from "react";
import type { InsertionOrder } from "@/hooks/finance/useInsertionOrders";
import { Pencil, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/Table";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { getCustomFieldKeyFromColumn, getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";

type InsertionOrdersListProps = {
  orders: InsertionOrder[];
  isLoading: boolean;
  onEdit: (order: InsertionOrder) => void;
  onDelete: (order: InsertionOrder) => void;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  selectedIds?: number[];
  currentPageSelectionState?: boolean | "indeterminate";
  onToggleRow?: (orderId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  draft: { bg: "bg-neutral-800/60", text: "text-neutral-400", border: "border-neutral-700/50" },
  issued: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40" },
  active: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-700/40" },
  completed: { bg: "bg-teal-900/30", text: "text-teal-300", border: "border-teal-700/40" },
  cancelled: { bg: "bg-red-900/30", text: "text-red-300", border: "border-red-700/40" },
  imported: { bg: "bg-violet-900/30", text: "text-violet-300", border: "border-violet-700/40" },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status.toLowerCase()] ?? { bg: "bg-neutral-800/60", text: "text-neutral-400", border: "border-neutral-700/50" };
}

function formatAmount(amount?: number | null, currency?: string): string {
  if (amount == null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value?: string | null): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
  } catch {
    return value;
  }
}

function isDuePast(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  try {
    return new Date(dateStr) < new Date();
  } catch {
    return false;
  }
}

export default function InsertionOrdersList({
  orders,
  isLoading,
  onEdit,
  onDelete,
  visibleColumns,
  columnOptions = [],
  selectedIds = [],
  currentPageSelectionState = false,
  onToggleRow,
  onToggleCurrentPage,
}: InsertionOrdersListProps) {
  const columnCount = visibleColumns.length + 2;
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
      const fieldKey = getCustomFieldKeyFromColumn(column);
      const value = order.custom_fields?.[fieldKey];
      return (
        <TableCell>
          <span className="text-sm text-neutral-300">
            {value == null || value === "" ? (
              <span className="text-neutral-600">—</span>
            ) : String(value)}
          </span>
        </TableCell>
      );
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
                <img
                  src={order.photo_url}
                  alt={order.user_name ?? ""}
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
              const style = getStatusStyle(order.status);
              return (
                <Pill bg={style.bg} text={style.text} border={style.border} className="w-24">
                  {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
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
              {order.issue_date ? formatDate(order.issue_date) : <span className="text-neutral-600">—</span>}
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
                {formatDate(order.due_date)}
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
              {order.updated_at ? formatDate(order.updated_at) : <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      default:
        return null;
    }
  };

  return (
    <ModuleTableShell>
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
            {visibleColumns.map((column) => (
              <TableHead key={column}>
                {headers[column] ?? getReadableColumnLabel(column, columnOptions)}
              </TableHead>
            ))}
            <TableHead className="text-right pr-5">Actions</TableHead>
          </TableHeaderRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-16 text-center">
                <div className="flex flex-col items-center gap-3 text-neutral-500">
                  <div className="h-5 w-5 rounded-full border-2 border-neutral-700 border-t-neutral-400 animate-spin" />
                  <span className="text-sm">Loading insertion orders...</span>
                </div>
              </TableCell>
            </TableRow>
          ) : orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-neutral-500">
                  <svg className="w-8 h-8 text-neutral-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm">No insertion orders found</span>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            orders.map((order) => (
              <TableRow key={order.id} className="group">
                <TableCell className="w-12 pr-0">
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
                <TableCell className="text-right pr-4">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <button
                      onClick={() => onEdit(order)}
                      className="p-1.5 rounded-md text-sky-400 hover:text-sky-300 hover:bg-sky-950/40 transition-colors"
                      title="Edit insertion order"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => onDelete(order)}
                      className="p-1.5 rounded-md text-red-400 hover:text-red-300 hover:bg-red-950/40 transition-colors"
                      title="Delete insertion order"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
