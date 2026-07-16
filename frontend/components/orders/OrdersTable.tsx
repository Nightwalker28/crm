"use client";

import { Fragment } from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";

import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import { Button } from "@/components/ui/button";
import type { Order } from "@/hooks/sales/useOrders";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { formatDateTime } from "@/lib/datetime";
import { getReadableColumnLabel } from "@/lib/moduleViewConfigs";

type SortState = { column: string; direction: "asc" | "desc" } | null;

type OrdersTableProps = {
  orders: Order[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  draft: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Draft" },
  confirmed: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "Confirmed" },
  fulfilled: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Fulfilled" },
  cancelled: { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40", label: "Cancelled" },
};

function formatMoney(value: string | number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
}

const SORTABLE_COLUMNS = new Set([
  "order_number",
  "quote_id",
  "organization_id",
  "contact_id",
  "opportunity_id",
  "owner_id",
  "status",
  "currency",
  "subtotal",
  "tax_total",
  "discount_total",
  "grand_total",
  "created_at",
  "updated_at",
]);

export default function OrdersTable({
  orders,
  isLoading,
  isRefreshing = false,
  visibleColumns,
  columnOptions = [],
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  onClearFilters,
}: OrdersTableProps) {

  function toggleSort(column: string) {
    const nextSort: SortState = sort?.column === column
      ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
      : { column, direction: "asc" };
    onSortChange?.(nextSort);
  }

  function renderCell(order: Order, column: string) {
    switch (column) {
      case "order_number":
        return <TableCell className="sticky left-0 z-10 bg-surface"><Link href={`/dashboard/sales/orders/${order.id}`} className="font-mono text-sm font-medium text-copy-primary hover:underline">{order.order_number}</Link></TableCell>;
      case "status": {
        const style = STATUS_STYLES[order.status] ?? STATUS_STYLES.draft;
        return <TableCell><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>;
      }
      case "grand_total":
        return <TableCell><span className="text-sm tabular-nums text-neutral-200">{formatMoney(order.grand_total, order.currency)}</span></TableCell>;
      case "organization_name":
        return <TableCell><span className="text-sm text-neutral-300">{order.organization_name || "—"}</span></TableCell>;
      case "contact_name":
        return <TableCell><span className="text-sm text-neutral-300">{order.contact_name || "—"}</span></TableCell>;
      case "opportunity_name":
        return <TableCell><span className="text-sm text-neutral-300">{order.opportunity_name || "—"}</span></TableCell>;
      case "owner_name":
        return <TableCell><span className="text-sm text-neutral-300">{order.owner_name || "Unassigned"}</span></TableCell>;
      case "created_at":
      case "updated_at":
        return <TableCell><span className="text-sm text-neutral-400">{formatDateTime(String(order[column]))}</span></TableCell>;
      default:
        return <TableCell><span className="text-sm text-neutral-300">{String(order[column as keyof Order] ?? "") || <span className="text-neutral-600">-</span>}</span></TableCell>;
    }
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[980px]">
        <TableHeader>
          <TableHeaderRow>
            {visibleColumns.map((column) => {
              const label = getReadableColumnLabel(column, columnOptions);
              const sortable = SORTABLE_COLUMNS.has(column);
              return sortable ? (
                <SortableHead key={column} sorted={sort?.column === column} direction={sort?.column === column ? sort.direction : "asc"} onClick={() => toggleSort(column)} className={column === "order_number" ? "sticky left-0 z-20 bg-surface" : undefined}>
                  {label}
                </SortableHead>
              ) : <TableHead key={column}>{label}</TableHead>;
            })}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={visibleColumns.length} />
          ) : orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length} className="py-16 text-center">
                <EmptyState icon={ShoppingCart} title={hasActiveFilters ? "No orders match these filters" : "No orders yet"} description={hasActiveFilters ? "Clear one or more filters and try again." : "Create an order manually or convert an accepted quote."} action={hasActiveFilters && onClearFilters ? <Button type="button" variant="outline" onClick={onClearFilters}>Clear filters</Button> : <Button asChild><Link href="/dashboard/sales/orders/new">Create order</Link></Button>} />
              </TableCell>
            </TableRow>
          ) : (
            orders.map((order) => (
              <TableRow key={order.id}>
                {visibleColumns.map((column) => <Fragment key={column}>{renderCell(order, column)}</Fragment>)}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
