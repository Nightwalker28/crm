"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";

import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import type { Order } from "@/hooks/sales/useOrders";
import type { TableColumnOption } from "@/types/table";
import { formatDateTime } from "@/lib/datetime";
import { getReadableColumnLabel } from "@/lib/moduleViewConfigs";
import { getOrderStatus } from "@/lib/statusStyles";
import { Money } from "@/components/ui/Money";

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

function renderCell(order: Order, column: string) {
  switch (column) {
    case "order_number":
      return <span className="text-sm font-medium tabular-nums text-copy-primary">{order.order_number}</span>;
    case "status": {
      const style = getOrderStatus(order.status);
      return <StatusValue status={style} />;
    }
    case "grand_total":
      return <span className="text-sm text-copy-primary"><Money amount={order.grand_total} currency={order.currency} /></span>;
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
