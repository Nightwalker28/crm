"use client";

import Link from "next/link";
import { useState } from "react";
import { CreditCard, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { RecordTable } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { usePayments } from "@/hooks/finance/useFinanceDocuments";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getPaymentRecordStatus } from "@/lib/statusStyles";
import { PicklistText } from "@/components/picklists/PicklistText";

/**
 * Payments (12c-erp-invoicing.md §3.5): the money itself, received from customers and paid to
 * vendors, one row per payment. Each settles an invoice, a bill or (a refund) a credit note;
 * the row's own verb is on the document, so this list has no primary action.
 */
export default function PaymentsPage() {
  const { modules } = useAccessibleModules();
  const canRecord = Boolean(modules.find((module) => module.name === "finance_payments")?.actions?.can_create);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const query = usePayments(page, pageSize, { direction, status, search });

  return (
    <PageShell
      variant="list"
      title="Payments"
      description="Money received from customers and paid to vendors."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link href={DASHBOARD_ROUTES.invoices}><ReceiptText />Open invoices</Link></Button>
          {canRecord ? <Button asChild variant="outline" size="sm"><Link href={`${DASHBOARD_ROUTES.payments}/record`}><CreditCard />Record payment</Link></Button> : null}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search by number, customer, vendor, reference or invoice" />
        <Select value={direction || "all"} onValueChange={(value) => { setDirection(value === "all" ? "" : value); setPage(1); }}>
          <SelectTrigger aria-label="Filter direction"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Received and made</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="made">Made</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status || "all"} onValueChange={(value) => { setStatus(value === "all" ? "" : value); setPage(1); }}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <RecordTable
        label="Payments"
        rows={query.data?.results ?? []}
        rowKey={(row) => row.id}
        rowHref={(row) => `${DASHBOARD_ROUTES.payments}/${row.id}`}
        isLoading={query.isLoading}
        isPermissionDenied={isForbiddenError(query.error)}
        hasError={Boolean(query.error) && !isForbiddenError(query.error)}
        onRetry={() => void query.refetch()}
        emptyState={{ icon: CreditCard, title: "No payments", description: "Payments are recorded against an issued invoice or a posted bill." }}
        columns={[
          { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
          { key: "paid_on", label: "Paid on", size: "sm", render: (row) => formatDateOnly(row.paid_on) },
          { key: "party", label: "Customer or vendor", size: "lg", render: (row) => row.party_name ?? "—" },
          { key: "document", label: "For", size: "md", render: (row) => row.allocations.map((allocation) => allocation.document_label ?? "Document").join(", ") || "—" },
          { key: "kind", label: "Kind", size: "sm", render: (row) => (row.kind === "refund" ? "Refund" : row.direction === "received" ? "Received" : "Paid out") },
          { key: "method", label: "Method", size: "sm", render: (row) => <PicklistText listKey="payment_method" value={row.method} /> },
          { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPaymentRecordStatus(row.status)} /> },
          { key: "amount", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.amount} currency={row.currency} /> },
        ]}
      />
      <Pagination
        page={page}
        totalPages={query.data?.total_pages ?? 0}
        totalCount={query.data?.total_count ?? 0}
        pageSize={pageSize}
        rangeStart={query.data?.range_start ?? 0}
        rangeEnd={query.data?.range_end ?? 0}
        isRefreshing={query.isFetching && !query.isLoading}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      />
    </PageShell>
  );
}
