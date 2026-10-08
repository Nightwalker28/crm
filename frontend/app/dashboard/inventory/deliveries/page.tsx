"use client";

import { Truck } from "lucide-react";

import { TrackingNumber } from "@/components/inventory/TrackingNumber";
import { DocumentListPage } from "@/components/transactions/DocumentListPage";
import { StatusValue } from "@/components/ui/StatusValue";
import type { Delivery } from "@/hooks/inventory/useDeliveries";
import { formatDateOnly } from "@/lib/datetime";
import { formatQuantity } from "@/lib/quantity";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getDeliveryStatus } from "@/lib/statusStyles";

/** Deliveries: archetype 1, on the shared document list (13c §3.2). */
export default function DeliveriesPage() {
  return (
    <DocumentListPage<Delivery>
      moduleKey="inventory_deliveries"
      title="Deliveries"
      description="Goods shipped against sales orders. Start a delivery from the order's Fulfilment tab."
      endpoint="/inventory/deliveries"
      searchPlaceholder="Search by number, order or tracking number"
      statusOptions={[{ value: "draft", label: "Draft" }, { value: "posted", label: "Posted" }, { value: "cancelled", label: "Cancelled" }]}
      rowHref={(row) => `${DASHBOARD_ROUTES.inventoryDeliveries}/${row.id}`}
      emptyState={{ icon: Truck, title: "No deliveries", description: "Deliveries are created from a confirmed order's Fulfilment tab." }}
      columns={[
        { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
        { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getDeliveryStatus(row.status)} /> },
        { key: "order_number", label: "Order", size: "sm", render: (row) => row.order_number ?? "—" },
        { key: "customer_name", label: "Customer", render: (row) => row.customer_name ?? "—" },
        { key: "warehouse_name", label: "Warehouse", size: "md", render: (row) => row.warehouse_name ?? "—" },
        { key: "shipped_on", label: "Shipped on", size: "sm", render: (row) => (row.shipped_on ? formatDateOnly(row.shipped_on) : "—") },
        { key: "carrier", label: "Carrier", interactive: true, render: (row) => (row.carrier || row.tracking_number ? <span className="inline-flex flex-wrap gap-x-1">{row.carrier ? <span>{row.carrier}</span> : null}{row.tracking_number ? <TrackingNumber carrier={row.carrier} number={row.tracking_number} /> : null}</span> : "—") },
        { key: "total_quantity", label: "Units", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{formatQuantity(row.total_quantity)}</span> },
      ]}
    />
  );
}
