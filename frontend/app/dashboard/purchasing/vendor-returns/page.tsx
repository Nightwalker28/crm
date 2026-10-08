"use client";

import { PackageX } from "lucide-react";

import { DocumentListPage } from "@/components/transactions/DocumentListPage";
import { StatusValue } from "@/components/ui/StatusValue";
import type { VendorReturn } from "@/hooks/purchasing/useVendorDocuments";
import { formatDateTime } from "@/lib/datetime";
import { formatQuantity } from "@/lib/quantity";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getVendorReturnResolution, getVendorReturnStatus } from "@/lib/statusStyles";

/**
 * Vendor returns (13c §3.7): archetype 1, on the shared document list. A return starts from its
 * posted receipt (*Return to vendor*), so this list has no create action of its own.
 */
export default function VendorReturnsPage() {
  return (
    <DocumentListPage<VendorReturn>
      moduleKey="purchase_vendor_returns"
      title="Vendor returns"
      description="Goods sent back to vendors. Start a return from the receipt that brought them in."
      endpoint="/purchasing/vendor-returns"
      searchPlaceholder="Search by number, vendor or reason"
      statusOptions={[{ value: "draft", label: "Draft" }, { value: "shipped", label: "Shipped" }, { value: "cancelled", label: "Cancelled" }]}
      rowHref={(row) => `${DASHBOARD_ROUTES.vendorReturns}/${row.id}`}
      emptyState={{ icon: PackageX, title: "No vendor returns", description: "Return goods from the posted receipt that brought them in." }}
      columns={[
        { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
        { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getVendorReturnStatus(row.status)} /> },
        { key: "resolution", label: "Vendor will", size: "sm", render: (row) => <StatusValue status={getVendorReturnResolution(row.resolution)} /> },
        { key: "vendor_name", label: "Vendor", size: "lg", render: (row) => row.vendor_name ?? "—" },
        { key: "receipt_number", label: "Receipt", size: "sm", render: (row) => row.receipt_number ?? "—" },
        { key: "order_number", label: "Purchase order", size: "sm", render: (row) => row.order_number ?? "—" },
        { key: "reason", label: "Reason", render: (row) => row.reason },
        { key: "shipped_at", label: "Shipped", size: "sm", render: (row) => (row.shipped_at ? formatDateTime(row.shipped_at) : "—") },
        { key: "total_quantity", label: "Units", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{formatQuantity(row.total_quantity)}</span> },
      ]}
    />
  );
}
