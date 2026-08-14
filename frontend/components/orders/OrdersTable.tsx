"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/Pill";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import type { Order } from "@/hooks/sales/useOrders";
import type { TableColumnOption } from "@/types/table";
import { formatDateTime } from "@/lib/datetime";
import { getReadableColumnLabel } from "@/lib/moduleViewConfigs";
import { getOrderStatusStyle } from "@/lib/statusStyles";

type OrdersTableProps = {
  orders: Order[];
  isLoading: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  sort?: RecordTableSort | null;
  onSortChange?: (sort: RecordTableSort) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
};

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

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  order_number: "sm",
  status: "sm",
  currency: "sm",
  organization_name: "lg",
  opportunity_name: "lg",
};

function formatMoney(value: string | number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
}

function renderCell(order: Order, column: string) {
  switch (column) {
    case "order_number":
      return <span className="text-sm font-medium tabular-nums text-copy-primary">{order.order_number}</span>;
    case "status": {
      const style = getOrderStatusStyle(order.status);
      return <Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill>;
    }
    case "grand_total":
      return <span className="text-sm tabular-nums text-copy-primary">{formatMoney(order.grand_total, order.currency)}</span>;
    case "organization_name":
      return <span className="text-sm text-copy-secondary">{order.organization_name || "—"}</span>;
    case "contact_name":
      return <span className="text-sm text-copy-secondary">{order.contact_name || "—"}</span>;
    case "opportunity_name":
      return <span className="text-sm text-copy-secondary">{order.opportunity_name || "—"}</span>;
    case "owner_name":
      return <span className="text-sm text-copy-secondary">{order.owner_name || "Unassigned"}</span>;
    case "created_at":
    case "updated_at":
      return <span className="text-sm text-copy-muted">{formatDateTime(String(order[column]))}</span>;
    default:
      return (
        <span className="text-sm text-copy-secondary">
          {String(order[column as keyof Order] ?? "") || <span className="text-copy-disabled">-</span>}
        </span>
      );
  }
}

export default function OrdersTable({
  orders,
  isLoading,
  isRefreshing = false,
  hasError = false,
  onRetry,
  visibleColumns,
  columnOptions = [],
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  onClearFilters,
}: OrdersTableProps) {
  const columns = useMemo<RecordTableColumn<Order>[]>(
    () =>
      visibleColumns.map((column) => ({
        key: column,
        label: getReadableColumnLabel(column, columnOptions),
        sortable: SORTABLE_COLUMNS.has(column),
        size: COLUMN_SIZES[column],
        align: column === "grand_total" ? "right" : "left",
        render: (order) => renderCell(order, column),
      })),
    [visibleColumns, columnOptions],
  );

  return (
    <RecordTable
      label="Orders"
      columns={columns}
      rows={orders}
      rowKey={(order) => order.id}
      rowHref={(order) => `/dashboard/sales/orders/${order.id}`}
      rowLabel={(order) => `Open order ${order.order_number}`}
      sort={sort}
      onSortChange={onSortChange}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      emptyState={{
        icon: ShoppingCart,
        title: "No orders yet",
        description: "Create an order manually or convert an accepted quote.",
        action: <Button asChild><Link href="/dashboard/sales/orders/new">Create order</Link></Button>,
      }}
      filteredEmptyState={{ icon: ShoppingCart }}
    />
  );
}
