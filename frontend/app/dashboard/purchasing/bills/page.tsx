"use client";

import Link from "next/link";
import { useState } from "react";
import { FileText, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import Pagination from "@/components/ui/Pagination";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { usePurchaseBills } from "@/hooks/purchasing/usePurchasing";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { OVERDUE_STATUS, getBillStatus, getPosPaymentStatus } from "@/lib/statusStyles";

/**
 * Bills (12c-erp-invoicing.md §3.5): archetype 1. A bill for received stock starts from its
 * purchase order or receipt; *New bill* here is for services and expenses.
 */
export default function BillsPage() {
  const { modules } = useAccessibleModules();
  const canCreate = Boolean(modules.find((module) => module.name === "purchase_bills")?.actions?.can_create);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const query = usePurchaseBills(page, pageSize, status, search);

  return (
    <PageShell
      variant="list"
      title="Bills"
      description="What vendors have invoiced. Bill received stock from its purchase order or receipt."
      actions={canCreate ? <Button asChild><Link href={`${DASHBOARD_ROUTES.purchaseBills}/new`}><Plus />New bill</Link></Button> : null}
    >
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search by number, vendor or vendor invoice" />
        <Select value={status || "all"} onValueChange={(value) => { setStatus(value === "all" ? "" : value); setPage(1); }}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All bills</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="variance">Price differs from PO</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <RecordTable
        label="Bills"
        rows={query.data?.results ?? []}
        rowKey={(row) => row.id}
        rowHref={(row) => `${DASHBOARD_ROUTES.purchaseBills}/${row.id}`}
        isLoading={query.isLoading}
        isPermissionDenied={isForbiddenError(query.error)}
        hasError={Boolean(query.error) && !isForbiddenError(query.error)}
        onRetry={() => void query.refetch()}
        emptyState={{ icon: FileText, title: "No bills", description: "Bill received stock from its purchase order, or add a bill for a service or expense." }}
        columns={[
          { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
          { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getBillStatus(row.status)} /> },
          { key: "vendor", label: "Vendor", size: "lg", render: (row) => row.vendor_name ?? "—" },
          { key: "reference", label: "Vendor invoice", size: "md", render: (row) => row.vendor_invoice_number },
          { key: "order", label: "Purchase order", size: "sm", render: (row) => row.order_number ?? "—" },
          { key: "due", label: "Due", size: "sm", render: (row) => (row.due_date ? formatDateOnly(row.due_date) : "—") },
          { key: "payment", label: "Payment", size: "sm", render: (row) => (row.status !== "posted" ? "—" : row.is_overdue ? <StatusValue status={OVERDUE_STATUS} /> : <StatusValue status={getPosPaymentStatus(row.payment_status)} />) },
          { key: "total", label: "Total", size: "sm", align: "right", render: (row) => <Money amount={row.total} currency={row.currency} /> },
          { key: "balance", label: "Balance due", size: "sm", align: "right", render: (row) => (row.status === "posted" ? <Money amount={row.balance_due} currency={row.currency} /> : "—") },
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
