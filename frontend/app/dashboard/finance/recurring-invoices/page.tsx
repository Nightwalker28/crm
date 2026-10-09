"use client";

import Link from "next/link";
import { Plus, Repeat } from "lucide-react";

import { DocumentListPage } from "@/components/transactions/DocumentListPage";
import { Button } from "@/components/ui/button";
import { StatusValue } from "@/components/ui/StatusValue";
import type { RecurringInvoice } from "@/hooks/finance/useReceivables";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { formatDateOnly } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getRecurringInvoiceStatus } from "@/lib/statusStyles";

/** Recurring invoices (13d §3.6): archetype 1, on the shared document list. */
export default function RecurringInvoicesPage() {
  const { modules } = useAccessibleModules();
  const canCreate = Boolean(modules.find((module) => module.name === "finance_recurring_invoices")?.actions?.can_create);
  const create = canCreate ? (
    <Button asChild><Link href={`${DASHBOARD_ROUTES.recurringInvoices}/new`}><Plus />Create recurring invoice</Link></Button>
  ) : undefined;
  return (
    <DocumentListPage<RecurringInvoice>
      moduleKey="finance_recurring_invoices"
      title="Recurring invoices"
      description="Invoices made on a schedule, as drafts or issued and emailed. Start one here or from an invoice with Make recurring."
      endpoint="/finance/recurring-invoices"
      searchPlaceholder="Search by name or customer"
      primaryAction={create}
      statusOptions={[
        { value: "active", label: "Active" },
        { value: "paused", label: "Paused or finished" },
      ]}
      rowHref={(row) => `${DASHBOARD_ROUTES.recurringInvoices}/${row.id}`}
      emptyState={{ icon: Repeat, title: "No recurring invoices", description: "Bill a customer the same thing every week, month, quarter or year.", action: create }}
      columns={[
        { key: "name", label: "Name", size: "lg", render: (row) => <span className="font-semibold text-copy-primary">{row.name}</span> },
        { key: "customer_name", label: "Customer", size: "lg", render: (row) => row.customer_name },
        { key: "schedule", label: "Repeats", size: "sm", render: (row) => row.schedule },
        { key: "next_run_date", label: "Next invoice", size: "sm", render: (row) => (row.next_run_date ? formatDateOnly(row.next_run_date) : "—") },
        { key: "action", label: "Then", size: "sm", render: (row) => (row.action === "issue_and_send" ? "Issue and email" : "Save a draft") },
        { key: "issued_count", label: "Invoices made", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{row.issued_count}</span> },
        { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getRecurringInvoiceStatus(row.status)} /> },
        { key: "end_date", label: "Ends", size: "sm", render: (row) => (row.end_date ? formatDateOnly(row.end_date) : row.max_count ? `After ${row.max_count}` : "Never") },
      ]}
    />
  );
}
