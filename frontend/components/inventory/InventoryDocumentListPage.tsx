"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardList } from "lucide-react";

import { Button } from "@/components/ui/button";
import Pagination from "@/components/ui/Pagination";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useInventoryDocuments, type InventoryDocument, type InventoryKind } from "@/hooks/inventory/useInventory";
import { isForbiddenError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import type { StatusDescriptor } from "@/lib/statusStyles";

const DOCUMENT_STATUS: Record<InventoryDocument["status"], StatusDescriptor> = {
  draft: { label: "Draft", tone: "neutral" },
  posted: { label: "Posted", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function InventoryDocumentListPage({ kind }: { kind: InventoryKind }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const { modules } = useAccessibleModules();
  const actions = modules.find((module) => module.name === `inventory_${kind}`)?.actions;
  const query = useInventoryDocuments(kind, page, pageSize, status);
  const title = kind === "adjustments" ? "Adjustments" : "Transfers";
  const route = `/dashboard/inventory/${kind}`;

  return <PageShell variant="list" title={title} description={kind === "adjustments" ? "Reasoned stock changes and physical counts." : "Move stock between warehouses with a posted record."}
    actions={actions?.can_create ? <Button asChild><Link href={`${route}/new`}>New {kind === "adjustments" ? "adjustment" : "transfer"}</Link></Button> : null}>
    <div className="flex flex-wrap items-center gap-3">
      <Select value={status || "all"} onValueChange={(value) => { setStatus(value === "all" ? "" : value); setPage(1); }}><SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="posted">Posted</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent></Select>
    </div>
    <RecordTable label={title} rows={query.data?.results ?? []} rowKey={(row) => row.id} rowHref={(row) => `${route}/${row.id}`}
      isLoading={query.isLoading} isPermissionDenied={isForbiddenError(query.error)} hasError={Boolean(query.error) && !isForbiddenError(query.error)} onRetry={() => void query.refetch()}
      emptyState={{ icon: ClipboardList, title: `No ${title.toLowerCase()}`, description: "Create a draft to document the stock change before posting." }}
      columns={[{ key: "number", label: "Number", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
        { key: "status", label: "Status", render: (row) => <StatusValue status={DOCUMENT_STATUS[row.status]} /> },
        { key: "location", label: kind === "adjustments" ? "Warehouse" : "Route", render: (row) => kind === "adjustments" ? row.warehouse_name : `${row.from_warehouse_name} → ${row.to_warehouse_name}` },
        { key: "lines", label: "Products", align: "right", render: (row) => <span className="tabular-nums">{row.line_count}</span> },
        { key: "created", label: "Created", render: (row) => formatDateTime(row.created_at) }]} />
    <Pagination page={page} totalPages={query.data?.total_pages ?? 0} totalCount={query.data?.total_count ?? 0} pageSize={pageSize} rangeStart={query.data?.range_start ?? 0} rangeEnd={query.data?.range_end ?? 0}
      isRefreshing={query.isFetching && !query.isLoading} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
  </PageShell>;
}
