"use client";

import Link from "next/link";
import { CreditCard, ReceiptText } from "lucide-react";

import { PicklistText } from "@/components/picklists/PicklistText";
import { DocumentListPage } from "@/components/transactions/DocumentListPage";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { StatusValue } from "@/components/ui/StatusValue";
import type { PaymentRecord } from "@/hooks/finance/usePosInvoices";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { formatDateOnly } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getPaymentRecordStatus } from "@/lib/statusStyles";

/**
 * Payments (12c-erp-invoicing.md §3.5): the money itself, received from customers and paid to
 * vendors, one row per payment. Each settles an invoice, a bill or (a refund) a credit note.
 * On the shared document list (13c §3.2); *Received*, *Made* and *Refunds* are its presets.
 */
export default function PaymentsPage() {
  const { modules } = useAccessibleModules();
  const canRecord = Boolean(modules.find((module) => module.name === "finance_payments")?.actions?.can_create);

  return (
    <DocumentListPage<PaymentRecord>
      moduleKey="finance_payments"
      title="Payments"
      description="Money received from customers and paid to vendors."
      endpoint="/finance/payments"
      searchPlaceholder="Search by number, customer, vendor, reference or invoice"
      primaryAction={
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href={DASHBOARD_ROUTES.invoices}><ReceiptText />Open invoices</Link></Button>
          {canRecord ? <Button asChild><Link href={`${DASHBOARD_ROUTES.payments}/record`}><CreditCard />Record payment</Link></Button> : null}
        </div>
      }
      statusOptions={[{ value: "posted", label: "Posted" }, { value: "void", label: "Void" }]}
      rowHref={(row) => `${DASHBOARD_ROUTES.payments}/${row.id}`}
      emptyState={{ icon: CreditCard, title: "No payments", description: "Payments are recorded against an issued invoice or a posted bill." }}
      columns={[
        { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
        { key: "paid_on", label: "Paid on", size: "sm", render: (row) => formatDateOnly(row.paid_on) },
        { key: "party_name", label: "Customer or vendor", size: "lg", render: (row) => row.party_name ?? "—" },
        { key: "documents", label: "For", size: "md", render: (row) => row.allocations.map((allocation) => allocation.document_label ?? "Document").join(", ") || "—" },
        { key: "kind", label: "Kind", size: "sm", render: (row) => (row.kind === "refund" ? "Refund" : row.direction === "received" ? "Received" : "Paid out") },
        { key: "method", label: "Method", size: "sm", render: (row) => <PicklistText listKey="payment_method" value={row.method} /> },
        { key: "reference", label: "Reference", size: "md", render: (row) => row.reference ?? "—" },
        { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPaymentRecordStatus(row.status)} /> },
        { key: "amount", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.amount} currency={row.currency} /> },
      ]}
    />
  );
}
