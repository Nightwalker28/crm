"use client";

import { Undo2 } from "lucide-react";

import { DocumentListPage } from "@/components/transactions/DocumentListPage";
import { StatusValue } from "@/components/ui/StatusValue";
import type { InventoryReturn } from "@/hooks/inventory/useReturns";
import { formatDateTime } from "@/lib/datetime";
import { formatQuantity } from "@/lib/quantity";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getReturnStatus } from "@/lib/statusStyles";

/** Returns: archetype 1, on the shared document list (13c §3.2). */
export default function ReturnsPage() {
  return (
    <DocumentListPage<InventoryReturn>
      moduleKey="inventory_returns"
      title="Returns"
      description="Goods customers sent back. Start a return from the delivery it is against."
      endpoint="/inventory/returns"
      searchPlaceholder="Search by number, order or reason"
      statusOptions={[{ value: "draft", label: "Draft" }, { value: "received", label: "Received" }, { value: "cancelled", label: "Cancelled" }]}
      rowHref={(row) => `${DASHBOARD_ROUTES.inventoryReturns}/${row.id}`}
      emptyState={{ icon: Undo2, title: "No returns", description: "Returns are recorded from the posted delivery they are against." }}
      columns={[
        { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
        { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getReturnStatus(row.status)} /> },
        { key: "reason", label: "Reason", render: (row) => row.reason },
        { key: "delivery_number", label: "Delivery", size: "sm", render: (row) => row.delivery_number ?? "—" },
        { key: "order_number", label: "Order", size: "sm", render: (row) => row.order_number ?? "—" },
        { key: "customer_name", label: "Customer", render: (row) => row.customer_name ?? "—" },
        { key: "received_at", label: "Received", size: "sm", render: (row) => (row.received_at ? formatDateTime(row.received_at) : "—") },
        { key: "total_quantity", label: "Units", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{formatQuantity(row.total_quantity)}</span> },
      ]}
    />
  );
}
