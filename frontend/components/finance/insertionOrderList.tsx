import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import type { InsertionOrder } from "@/hooks/finance/useInsertionOrders";
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
import { Button } from "@/components/ui/button";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { resolveMediaUrl } from "@/lib/media";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getInsertionOrderStatusStyle } from "@/lib/statusStyles";

type InsertionOrderTableSortState = { column: string; direction: "asc" | "desc" } | null;

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
  sort: InsertionOrderTableSortState;
  onSortChange: (sort: InsertionOrderTableSortState) => void;
  selectionEnabled?: boolean;
  hasActiveFilters?: boolean;
  hasError?: boolean;
  canCreate?: boolean;
  onClearFilters?: () => void;
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

function getNumericValue(order: InsertionOrder, column: keyof InsertionOrder) {
  const value = order[column];
  return typeof value === "number" ? value : null;
}

function getStringValue(order: InsertionOrder, column: keyof InsertionOrder) {
  const value = order[column];
  return typeof value === "string" ? value : null;
}

function renderEmptyText(className = "text-copy-disabled text-sm") {
  return <span className={className}>—</span>;
}

function renderDateCell(value: string | null | undefined, className = "text-sm text-copy-secondary tabular-nums") {
  return (
    <TableCell>
      {value ? (
        <span className={className}>{formatDateOnly(value)}</span>
      ) : (
        renderEmptyText()
      )}
    </TableCell>
  );
}

function renderTextCell(value: string | null | undefined, className = "text-sm text-copy-secondary") {
  return (
    <TableCell>
      {value ? <span className={className}>{value}</span> : renderEmptyText()}
    </TableCell>
  );
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
  selectionEnabled = true,
  hasActiveFilters = false,
  hasError = false,
  canCreate = false,
  onClearFilters,
}: InsertionOrdersListProps) {
  const columnCount = visibleColumns.length + (selectionEnabled ? 1 : 0);
  const headers: Record<string, string> = {
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

  const renderCell = (order: InsertionOrder, column: string) => {
    if (isCustomFieldColumnKey(column)) {
      return <CustomFieldCell column={column} values={order.custom_fields} />;
    }

    switch (column) {
      case "io_number":
        return (
          <TableCell>
            {order.io_number ? (
              <Link
                href={`/dashboard/finance/insertion-orders/${order.id}`}
                onClick={(event) => event.stopPropagation()}
                className="rounded-[var(--radius-control-sm)] font-mono text-sm font-medium text-copy-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {order.io_number}
              </Link>
            ) : renderEmptyText()}
          </TableCell>
        );
      case "customer_name":
        return (
          <TableCell>
            <span className="block max-w-[180px] truncate text-sm font-medium text-copy-primary">
              {order.customer_name || renderEmptyText()}
            </span>
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
            })() : renderEmptyText()}
          </TableCell>
        );
      case "currency":
        return (
          <TableCell>
            <span className="rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted px-1.5 py-0.5 text-xs font-semibold tracking-wider text-copy-secondary">
              {order.currency || "—"}
            </span>
          </TableCell>
        );
      case "total_amount":
      case "subtotal_amount":
      case "tax_amount": {
        const amount = getNumericValue(order, column);
        return (
          <TableCell>
            {amount != null ? (
              <span className="text-sm font-semibold tabular-nums text-copy-primary">
                {formatAmount(amount, order.currency)}
              </span>
            ) : (
              renderEmptyText()
            )}
          </TableCell>
        );
      }
      case "issue_date":
      case "effective_date":
      case "start_date":
      case "end_date": {
        return renderDateCell(getStringValue(order, column));
      }
      case "due_date":
        return renderDateCell(
          order.due_date,
          `text-sm font-medium tabular-nums ${
            isDuePast(order.due_date) && order.status !== "completed" && order.status !== "cancelled"
              ? "text-state-danger"
              : "text-copy-primary"
          }`,
        );
      case "external_reference":
      case "counterparty_reference": {
        const textValue = getStringValue(order, column);
        return renderTextCell(
          textValue,
          "block max-w-[140px] truncate font-mono text-sm tracking-tight text-copy-secondary",
        );
      }
      case "user_name":
        return (
          <TableCell>
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
              {order.user_name ? <span className="text-sm text-copy-secondary">{order.user_name}</span> : renderEmptyText()}
            </div>
          </TableCell>
        );
      case "updated_at": {
        const dateTimeValue = getStringValue(order, column);
        return (
          <TableCell>
            <span className="text-sm tabular-nums text-copy-muted">
              {dateTimeValue ? formatDateTime(dateTimeValue, { hour: "numeric", minute: "2-digit" }) : renderEmptyText()}
            </span>
          </TableCell>
        );
      }
      default:
        return null;
    }
  };

  function toggleSort(column: string) {
    const nextSort: InsertionOrderTableSortState =
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
            {selectionEnabled ? <TableHead className="w-12 pr-0">
              <Checkbox
                checked={currentPageSelectionState}
                onCheckedChange={(checked) => onToggleCurrentPage?.(checked === true)}
                className="flex size-4 items-center justify-center rounded border border-line-strong bg-surface text-primary"
                aria-label="Select current page insertion orders"
              >
                <CheckboxIndicator className="h-3 w-3" />
              </Checkbox>
            </TableHead> : null}
            {visibleColumns.map((column) => {
              const label = headers[column] ?? getReadableColumnLabel(column, columnOptions);
              const sortable = !isCustomFieldColumnKey(column) && SORTABLE_COLUMNS.has(column);
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
            <ModuleTableLoading columnCount={columnCount} withCheckbox={selectionEnabled} />
          ) : hasError ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-12">
                <EmptyState icon={FileSpreadsheet} title="Insertion orders unavailable" description="Use Try again above to reload insertion orders." />
              </TableCell>
            </TableRow>
          ) : orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-12">
                <EmptyState
                  icon={FileSpreadsheet}
                  title={hasActiveFilters ? "No insertion orders match this view" : "No insertion orders yet"}
                  description={hasActiveFilters
                    ? "Clear the search or filters and try again."
                    : canCreate
                      ? "Create or import the first insertion order."
                      : "Insertion orders will appear here when a teammate creates one."}
                  action={hasActiveFilters && onClearFilters
                    ? <Button type="button" variant="outline" onClick={onClearFilters}>Clear filters</Button>
                    : canCreate
                      ? <Button asChild><Link href="/dashboard/finance/insertion-orders/new">Create insertion order</Link></Button>
                      : undefined}
                />
              </TableCell>
            </TableRow>
          ) : (
            orders.map((order) => (
              <TableRow
                key={order.id}
                className="group cursor-pointer"
                onClick={() => onRowClick(order)}
              >
                {selectionEnabled ? <TableCell
                  className="w-12 pr-0"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    checked={selectedIds.includes(order.id)}
                    onCheckedChange={(checked) => onToggleRow?.(order.id, checked === true)}
                    className="flex size-4 items-center justify-center rounded border border-line-strong bg-surface text-primary"
                    aria-label={`Select insertion order ${order.io_number}`}
                  >
                    <CheckboxIndicator className="h-3 w-3" />
                  </Checkbox>
                </TableCell> : null}
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
