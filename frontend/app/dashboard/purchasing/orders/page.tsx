"use client";

import Link from "next/link";
import { ShoppingBasket } from "lucide-react";

import { purchaseOrderStatus } from "@/components/purchasing/PurchaseOrderDocumentPage";
import { DocumentListPage } from "@/components/transactions/DocumentListPage";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { StatusValue } from "@/components/ui/StatusValue";
import type { PurchaseOrder } from "@/hooks/purchasing/usePurchasing";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getPurchaseOrderBillStatus } from "@/lib/statusStyles";

/** Purchase orders: archetype 1, on the shared document list (13c §3.2). */
export default function PurchaseOrdersPage() {
  const { modules } = useAccessibleModules();
  const canCreate = Boolean(modules.find((module) => module.name === "purchase_orders")?.actions?.can_create);
  const create = canCreate ? <Button asChild><Link href={`${DASHBOARD_ROUTES.purchaseOrders}/new`}>New purchase order</Link></Button> : undefined;

  return (
    <DocumentListPage<PurchaseOrder>
      moduleKey="purchase_orders"
      title="Purchase orders"
      description="Stock ordered from vendors. Placed orders count as incoming until they are received."
      endpoint="/purchasing/orders"
      searchPlaceholder="Search by number, vendor or vendor reference"
      primaryAction={create}
      statusOptions={[
        { value: "open", label: "Open (RFQs and orders)" },
        { value: "draft", label: "Request for quotation" },
        { value: "sent", label: "RFQ sent" },
        { value: "ordered", label: "Ordered" },
        { value: "received", label: "Received" },
        { value: "closed", label: "Closed" },
        { value: "cancelled", label: "Cancelled" },
      ]}
      rowHref={(row) => `${DASHBOARD_ROUTES.purchaseOrders}/${row.id}`}
      emptyState={{
        icon: ShoppingBasket,
        title: "No purchase orders",
        description: "Create one, or draft them from the Reorder screen.",
        action: canCreate ? <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.purchaseOrders}/new`}>New purchase order</Link></Button> : undefined,
      }}
      columns={[
        { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
        { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={purchaseOrderStatus(row)} /> },
        { key: "vendor_name", label: "Vendor", size: "lg", render: (row) => row.vendor_name ?? "—" },
        { key: "vendor_reference", label: "Vendor reference", size: "md", render: (row) => row.vendor_reference ?? "—" },
        { key: "warehouse_name", label: "Warehouse", size: "md", render: (row) => row.warehouse_name ?? "—" },
        { key: "expected_date", label: "Expected", size: "sm", render: (row) => (row.expected_date ? formatDateOnly(row.expected_date) : "—") },
        { key: "ordered_at", label: "Placed", size: "sm", render: (row) => (row.ordered_at ? formatDateTime(row.ordered_at) : "—") },
        { key: "bill_status", label: "Billing", size: "sm", render: (row) => (row.bill_status && row.bill_status !== "none" ? <StatusValue status={getPurchaseOrderBillStatus(row.bill_status)} /> : "—") },
        { key: "subtotal", label: "Total", size: "sm", align: "right", render: (row) => <Money amount={row.subtotal} currency={row.currency} /> },
      ]}
    />
  );
}
