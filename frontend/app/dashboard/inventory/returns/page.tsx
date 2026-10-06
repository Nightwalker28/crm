"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";

import Pagination from "@/components/ui/Pagination";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { useReturns } from "@/hooks/inventory/useReturns";
import { isForbiddenError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getReturnStatus } from "@/lib/statusStyles";

/**
 * Returns: archetype 1. A return starts from the posted delivery it is against, so this
 * list has no create action of its own.
 */
export default function ReturnsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const query = useReturns(page, pageSize, status, search);

  return (
    <PageShell variant="list" title="Returns" description="Goods customers sent back. Start a return from the delivery it is against.">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search returns" />
        <Select value={status || "all"} onValueChange={(value) => { setStatus(value === "all" ? "" : value); setPage(1); }}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <RecordTable
        label="Returns"
        rows={query.data?.results ?? []}
        rowKey={(row) => row.id}
        rowHref={(row) => `${DASHBOARD_ROUTES.inventoryReturns}/${row.id}`}
        isLoading={query.isLoading}
        isPermissionDenied={isForbiddenError(query.error)}
        hasError={Boolean(query.error) && !isForbiddenError(query.error)}
        onRetry={() => void query.refetch()}
        emptyState={{ icon: Undo2, title: "No returns", description: "Returns are recorded from the posted delivery they are against." }}
        columns={[
          { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
          { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getReturnStatus(row.status)} /> },
          { key: "reason", label: "Reason", render: (row) => row.reason },
          { key: "delivery", label: "Delivery", size: "sm", render: (row) => row.delivery_number ?? "—" },
          { key: "customer", label: "Customer", render: (row) => row.customer_name ?? "—" },
          { key: "received", label: "Received", size: "sm", render: (row) => (row.received_at ? formatDateTime(row.received_at) : "—") },
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
