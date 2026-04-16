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
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { getCustomFieldKeyFromColumn, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";

type InsertionOrdersListProps = {
  orders: InsertionOrder[];
  isLoading: boolean;
  onEdit: (order: InsertionOrder) => void;
  onDelete: (order: InsertionOrder) => void;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
};


export default function InsertionOrdersList({
  orders,
  isLoading,
  onEdit,
  onDelete,
  visibleColumns,
  columnOptions = [],
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
  const columnLabels = new Map(columnOptions.map((option) => [option.key, option.label]));

  const renderCell = (order: InsertionOrder, column: string) => {
    if (isCustomFieldColumnKey(column)) {
      const fieldKey = getCustomFieldKeyFromColumn(column);
      const value = order.custom_fields?.[fieldKey];
      return <TableCell>{value == null || value === "" ? "-" : String(value)}</TableCell>;
    }
    switch (column) {
      case "io_number":
        return <TableCell>{order.io_number || "-"}</TableCell>;
      case "customer_name":
        return <TableCell>{order.customer_name || "-"}</TableCell>;
      case "status":
        return <TableCell className="capitalize">{order.status || "-"}</TableCell>;
      case "currency":
        return <TableCell>{order.currency || "-"}</TableCell>;
      case "total_amount":
        return <TableCell>{order.total_amount ?? "-"}</TableCell>;
      case "issue_date":
        return <TableCell>{order.issue_date || "-"}</TableCell>;
      case "due_date":
        return <TableCell>{order.due_date || "-"}</TableCell>;
      case "external_reference":
        return <TableCell>{order.external_reference || "-"}</TableCell>;
      case "user_name":
        return <TableCell>{order.user_name || "-"}</TableCell>;
      case "updated_at":
        return <TableCell>{order.updated_at || "-"}</TableCell>;
      default:
        return null;
    }
  };

  return (
    <ModuleTableShell>
      <Table className="min-w-[1040px]">
        <TableHeader>
          <TableHeaderRow>
            {visibleColumns.map((column) => (
              <TableHead key={column}>{headers[column] ?? columnLabels.get(column) ?? column}</TableHead>
            ))}
            <TableHead className="text-right">Actions</TableHead>
          </TableHeaderRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-10 text-center text-neutral-500">
                Loading insertion orders...
              </TableCell>
            </TableRow>
          ) : orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-10 text-center text-neutral-500">
                No insertion orders found.
              </TableCell>
            </TableRow>
          ) : (
            orders.map((order) => (
              <TableRow key={order.id}>
                {visibleColumns.map((column) => (
                  <Fragment key={column}>{renderCell(order, column)}</Fragment>
                ))}
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => onEdit(order)}
                      className="text-blue-300 hover:text-blue-200"
                      title="Edit insertion order"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => onDelete(order)}
                      className="text-red-300 hover:text-red-200"
                      title="Delete insertion order"
                    >
                      <Trash2 size={16} />
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
