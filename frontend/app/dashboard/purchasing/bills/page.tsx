"use client";

import Link from "next/link";
import { FileText, Plus } from "lucide-react";

import { DocumentListPage } from "@/components/transactions/DocumentListPage";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { StatusValue } from "@/components/ui/StatusValue";
import type { PurchaseBill } from "@/hooks/purchasing/usePurchasing";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { formatDateOnly } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { OVERDUE_STATUS, getBillStatus, getPosPaymentStatus } from "@/lib/statusStyles";

/**
 * Bills (12c-erp-invoicing.md §3.5): archetype 1, on the shared document list (13c §3.2). A
 * bill for received stock starts from its purchase order or receipt; *New bill* here is for
 * services and expenses.
 */
export default function BillsPage() {
  const { modules } = useAccessibleModules();
  const canCreate = Boolean(modules.find((module) => module.name === "purchase_bills")?.actions?.can_create);

  return (
    <DocumentListPage<PurchaseBill>
      moduleKey="purchase_bills"
      title="Bills"
      description="What vendors have invoiced. Bill received stock from its purchase order or receipt."
      endpoint="/purchasing/bills"
      searchPlaceholder="Search by number, vendor or vendor invoice"
      primaryAction={canCreate ? <Button asChild><Link href={`${DASHBOARD_ROUTES.purchaseBills}/new`}><Plus />New bill</Link></Button> : undefined}
      statusOptions={[
        { value: "draft", label: "Draft" },
        { value: "posted", label: "Posted" },
        { value: "unpaid", label: "Unpaid" },
        { value: "overdue", label: "Overdue" },
        { value: "variance", label: "Price differs from PO" },
        { value: "void", label: "Void" },
      ]}
      rowHref={(row) => `${DASHBOARD_ROUTES.purchaseBills}/${row.id}`}
      emptyState={{ icon: FileText, title: "No bills", description: "Bill received stock from its purchase order, or add a bill for a service or expense." }}
      columns={[
        { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
        { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getBillStatus(row.status)} /> },
        { key: "vendor_name", label: "Vendor", size: "lg", render: (row) => row.vendor_name ?? "—" },
        { key: "vendor_invoice_number", label: "Vendor invoice", size: "md", render: (row) => row.vendor_invoice_number },
        { key: "order_number", label: "Purchase order", size: "sm", render: (row) => row.order_number ?? "—" },
        { key: "bill_date", label: "Bill date", size: "sm", render: (row) => formatDateOnly(row.bill_date) },
        { key: "due_date", label: "Due", size: "sm", render: (row) => (row.due_date ? formatDateOnly(row.due_date) : "—") },
        { key: "payment_status", label: "Payment", size: "sm", render: (row) => (row.status !== "posted" ? "—" : row.is_overdue ? <StatusValue status={OVERDUE_STATUS} /> : <StatusValue status={getPosPaymentStatus(row.payment_status)} />) },
        { key: "total", label: "Total", size: "sm", align: "right", render: (row) => <Money amount={row.total} currency={row.currency} /> },
        { key: "balance_due", label: "Balance due", size: "sm", align: "right", render: (row) => (row.status === "posted" ? <Money amount={row.balance_due} currency={row.currency} /> : "—") },
      ]}
    />
  );
}
