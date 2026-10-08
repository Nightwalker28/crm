"use client";

import { FileMinus } from "lucide-react";

import { DocumentListPage } from "@/components/transactions/DocumentListPage";
import { Money } from "@/components/ui/Money";
import { StatusValue } from "@/components/ui/StatusValue";
import type { CreditNote } from "@/hooks/finance/useFinanceDocuments";
import { formatDateOnly } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getCreditNoteStatus } from "@/lib/statusStyles";

/** Credit notes: archetype 1, on the shared document list (13c §3.2). */
export default function CreditNotesPage() {
  return (
    <DocumentListPage<CreditNote>
      moduleKey="finance_credit_notes"
      title="Credit notes"
      description="Credit against issued invoices. Start one from the invoice or from a return."
      endpoint="/finance/credit-notes"
      searchPlaceholder="Search by number, invoice, customer or reason"
      statusOptions={[
        { value: "draft", label: "Draft" },
        { value: "issued", label: "Issued" },
        { value: "refund_due", label: "Refund due" },
        { value: "void", label: "Void" },
      ]}
      rowHref={(row) => `${DASHBOARD_ROUTES.creditNotes}/${row.id}`}
      emptyState={{ icon: FileMinus, title: "No credit notes", description: "Credit notes are made from an issued invoice or a received return." }}
      columns={[
        { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number ?? "Draft"}</span> },
        { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getCreditNoteStatus(row.status)} /> },
        { key: "invoice_number", label: "Invoice", size: "sm", render: (row) => row.invoice_number ?? "—" },
        { key: "customer_name", label: "Customer", size: "lg", render: (row) => row.customer_name ?? "—" },
        { key: "reason", label: "Reason", size: "lg", render: (row) => row.reason ?? "—" },
        { key: "issue_date", label: "Issued", size: "sm", render: (row) => (row.issue_date ? formatDateOnly(row.issue_date) : "—") },
        { key: "refund_due", label: "Refund due", size: "sm", align: "right", render: (row) => (Number(row.refund_due) > 0 ? <Money amount={row.refund_due} currency={row.currency} /> : "—") },
        { key: "total_amount", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.total_amount} currency={row.currency} /> },
      ]}
    />
  );
}
