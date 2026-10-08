"use client";

import { PackageCheck } from "lucide-react";

import { DocumentListPage } from "@/components/transactions/DocumentListPage";
import { StatusValue } from "@/components/ui/StatusValue";
import type { PurchaseReceipt } from "@/hooks/purchasing/usePurchasing";
import { formatDateOnly } from "@/lib/datetime";
import { formatQuantity } from "@/lib/quantity";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getPurchaseReceiptStatus } from "@/lib/statusStyles";

/**
 * Receipts: archetype 1, on the shared document list (13c §3.2). A receipt starts from its
 * purchase order (*Receive*), so this list has no create action of its own.
 */
export default function ReceiptsPage() {
  return (
    <DocumentListPage<PurchaseReceipt>
      moduleKey="purchase_receipts"
      title="Receipts"
      description="Stock received from vendors. Start a receipt from its purchase order."
      endpoint="/purchasing/receipts"
      searchPlaceholder="Search by number, purchase order or delivery reference"
      statusOptions={[{ value: "draft", label: "Draft" }, { value: "posted", label: "Posted" }, { value: "cancelled", label: "Cancelled" }]}
      rowHref={(row) => `${DASHBOARD_ROUTES.purchaseReceipts}/${row.id}`}
      emptyState={{ icon: PackageCheck, title: "No receipts", description: "Receipts are recorded from a placed purchase order." }}
      columns={[
        { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
        { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPurchaseReceiptStatus(row.status)} /> },
        { key: "order_number", label: "Purchase order", size: "sm", render: (row) => row.order_number ?? "—" },
        { key: "vendor_name", label: "Vendor", size: "lg", render: (row) => row.vendor_name ?? "—" },
        { key: "warehouse_name", label: "Warehouse", size: "md", render: (row) => row.warehouse_name ?? "—" },
        { key: "vendor_delivery_ref", label: "Vendor delivery ref", size: "md", render: (row) => row.vendor_delivery_ref ?? "—" },
        { key: "received_on", label: "Received on", size: "sm", render: (row) => (row.received_on ? formatDateOnly(row.received_on) : "—") },
        { key: "total_quantity", label: "Units", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{formatQuantity(row.total_quantity)}</span> },
      ]}
    />
  );
}
