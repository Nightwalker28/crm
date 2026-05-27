"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";

import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
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
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  draft: { bg: "bg-neutral-800/40", text: "text-neutral-300", border: "border-neutral-700/40", label: "Draft" },
  confirmed: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40", label: "Confirmed" },
  fulfilled: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-700/40", label: "Fulfilled" },
  cancelled: { bg: "bg-red-900/30", text: "text-red-300", border: "border-red-700/40", label: "Cancelled" },
};

function formatMoney(value: string | number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
}

export default function OrdersTable({ orders, isLoading, isRefreshing = false, visibleColumns, columnOptions = [] }: OrdersTableProps) {
  const router = useRouter();
  const [sort, setSort] = useState<SortState>(null);
  const sortedOrders = useMemo(() => {
    if (!sort) return orders;
    return [...orders].sort((left, right) => {
      const leftValue = String(left[sort.column as keyof Order] ?? "").toLowerCase();
      const rightValue = String(right[sort.column as keyof Order] ?? "").toLowerCase();
      const result = leftValue.localeCompare(rightValue, undefined, { numeric: true });
      return sort.direction === "asc" ? result : -result;
    });
  }, [orders, sort]);

  function toggleSort(column: string) {
    setSort((current) => current?.column !== column ? { column, direction: "asc" } : { column, direction: current.direction === "asc" ? "desc" : "asc" });
  }

  function renderCell(order: Order, column: string) {
    switch (column) {
      case "order_number":
        return <TableCell><span className="font-mono text-sm font-medium text-neutral-100">{order.order_number}</span></TableCell>;
      case "status": {
        const style = STATUS_STYLES[order.status] ?? STATUS_STYLES.draft;
        return <TableCell><Pill bg={style.bg} text={style.text} border={style.border}>{style.label}</Pill></TableCell>;
      }
      case "grand_total":
        return <TableCell><span className="text-sm tabular-nums text-neutral-200">{formatMoney(order.grand_total, order.currency)}</span></TableCell>;
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
              const sortable = ["order_number", "status", "grand_total", "created_at", "updated_at"].includes(column);
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
            <ModuleTableLoading columnCount={visibleColumns.length} />
          ) : orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length} className="py-16 text-center">
                <EmptyState icon={ShoppingCart} title="No orders found" description="Accepted quotes converted to orders will appear here." />
              </TableCell>
            </TableRow>
          ) : (
            sortedOrders.map((order) => (
              <TableRow key={order.id} className="group cursor-pointer" onClick={() => router.push(`/dashboard/sales/orders/${order.id}`)}>
                {visibleColumns.map((column) => <Fragment key={column}>{renderCell(order, column)}</Fragment>)}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
