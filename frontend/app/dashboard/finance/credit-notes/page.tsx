"use client";

import { useState } from "react";
import { FileMinus } from "lucide-react";

import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { RecordTable } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { useCreditNotes } from "@/hooks/finance/useFinanceDocuments";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getCreditNoteStatus } from "@/lib/statusStyles";

/**
 * Credit notes: archetype 1. A credit note starts from its invoice or from a return, so this
 * list has no create action of its own.
 */
export default function CreditNotesPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const query = useCreditNotes(page, pageSize, status, search);

  return (
    <PageShell variant="list" title="Credit notes" description="Credit against issued invoices. Start one from the invoice or from a return.">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search by number, invoice, customer or reason" />
        <Select value={status || "all"} onValueChange={(value) => { setStatus(value === "all" ? "" : value); setPage(1); }}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="refund_due">Refund due</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <RecordTable
        label="Credit notes"
        rows={query.data?.results ?? []}
        rowKey={(row) => row.id}
        rowHref={(row) => `${DASHBOARD_ROUTES.creditNotes}/${row.id}`}
        isLoading={query.isLoading}
        isPermissionDenied={isForbiddenError(query.error)}
        hasError={Boolean(query.error) && !isForbiddenError(query.error)}
        onRetry={() => void query.refetch()}
        emptyState={{ icon: FileMinus, title: "No credit notes", description: "Credit notes are made from an issued invoice or a received return." }}
        columns={[
          { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number ?? "Draft"}</span> },
          { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getCreditNoteStatus(row.status)} /> },
          { key: "invoice", label: "Invoice", size: "sm", render: (row) => row.invoice_number ?? "—" },
          { key: "customer", label: "Customer", size: "lg", render: (row) => row.customer_name ?? "—" },
          { key: "reason", label: "Reason", size: "lg", render: (row) => row.reason ?? "—" },
          { key: "issued", label: "Issued", size: "sm", render: (row) => (row.issue_date ? formatDateOnly(row.issue_date) : "—") },
          { key: "refund_due", label: "Refund due", size: "sm", align: "right", render: (row) => (Number(row.refund_due) > 0 ? <Money amount={row.refund_due} currency={row.currency} /> : "—") },
          { key: "total", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.total_amount} currency={row.currency} /> },
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
