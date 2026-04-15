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

type InsertionOrdersListProps = {
  orders: InsertionOrder[];
  isLoading: boolean;
  onEdit: (order: InsertionOrder) => void;
  onDelete: (order: InsertionOrder) => void;
  visibleColumns: string[];
};


export default function InsertionOrdersList({
  orders,
  isLoading,
  onEdit,
  onDelete,
  visibleColumns,
}: InsertionOrdersListProps) {
  const hasColumn = (key: string) => visibleColumns.includes(key);
  const columnCount = visibleColumns.length + 1;

  return (
    <ModuleTableShell>
      <Table className="min-w-[1040px]">
        <TableHeader>
          <TableHeaderRow>
            {hasColumn("io_number") && <TableHead>IO Number</TableHead>}
            {hasColumn("customer_name") && <TableHead>Customer</TableHead>}
            {hasColumn("status") && <TableHead>Status</TableHead>}
            {hasColumn("currency") && <TableHead>Currency</TableHead>}
            {hasColumn("total_amount") && <TableHead>Total</TableHead>}
            {hasColumn("issue_date") && <TableHead>Issue Date</TableHead>}
            {hasColumn("due_date") && <TableHead>Due Date</TableHead>}
            {hasColumn("external_reference") && <TableHead>Reference</TableHead>}
            {hasColumn("user_name") && <TableHead>Owner</TableHead>}
            {hasColumn("updated_at") && <TableHead>Updated</TableHead>}
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
                {hasColumn("io_number") && <TableCell>{order.io_number || "-"}</TableCell>}
                {hasColumn("customer_name") && <TableCell>{order.customer_name || "-"}</TableCell>}
                {hasColumn("status") && <TableCell className="capitalize">{order.status || "-"}</TableCell>}
                {hasColumn("currency") && <TableCell>{order.currency || "-"}</TableCell>}
                {hasColumn("total_amount") && <TableCell>{order.total_amount ?? "-"}</TableCell>}
                {hasColumn("issue_date") && <TableCell>{order.issue_date || "-"}</TableCell>}
                {hasColumn("due_date") && <TableCell>{order.due_date || "-"}</TableCell>}
                {hasColumn("external_reference") && <TableCell>{order.external_reference || "-"}</TableCell>}
                {hasColumn("user_name") && <TableCell>{order.user_name || "-"}</TableCell>}
                {hasColumn("updated_at") && <TableCell>{order.updated_at || "-"}</TableCell>}
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
