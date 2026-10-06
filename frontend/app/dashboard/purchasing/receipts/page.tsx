"use client";

import { useState } from "react";
import { PackageCheck } from "lucide-react";

import Pagination from "@/components/ui/Pagination";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { usePurchaseReceipts } from "@/hooks/purchasing/usePurchasing";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getPurchaseReceiptStatus } from "@/lib/statusStyles";

/**
 * Receipts: archetype 1. A receipt starts from its purchase order (*Receive*), so this list
 * has no create action of its own.
 */
export default function ReceiptsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const query = usePurchaseReceipts(page, pageSize, status, search);

  return (
    <PageShell variant="list" title="Receipts" description="Stock received from vendors. Start a receipt from its purchase order.">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search receipts" />
        <Select value={status || "all"} onValueChange={(value) => { setStatus(value === "all" ? "" : value); setPage(1); }}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <RecordTable
        label="Receipts"
        rows={query.data?.results ?? []}
        rowKey={(row) => row.id}
        rowHref={(row) => `${DASHBOARD_ROUTES.purchaseReceipts}/${row.id}`}
        isLoading={query.isLoading}
        isPermissionDenied={isForbiddenError(query.error)}
        hasError={Boolean(query.error) && !isForbiddenError(query.error)}
        onRetry={() => void query.refetch()}
        emptyState={{ icon: PackageCheck, title: "No receipts", description: "Receipts are recorded from a placed purchase order." }}
        columns={[
          { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
          { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPurchaseReceiptStatus(row.status)} /> },
          { key: "order", label: "Purchase order", size: "sm", render: (row) => row.order_number ?? "—" },
          { key: "vendor", label: "Vendor", size: "lg", render: (row) => row.vendor_name ?? "—" },
          { key: "received", label: "Received on", size: "sm", render: (row) => (row.received_on ? formatDateOnly(row.received_on) : "—") },
          { key: "units", label: "Units", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{Number(row.total_quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span> },
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
