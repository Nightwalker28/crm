"use client";

import Link from "next/link";
import { useState } from "react";
import { ShoppingBasket } from "lucide-react";

import { purchaseOrderStatus } from "@/components/purchasing/PurchaseOrderDocumentPage";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import Pagination from "@/components/ui/Pagination";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { usePurchaseOrders } from "@/hooks/purchasing/usePurchasing";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";

/** Purchase orders: archetype 1. */
export default function PurchaseOrdersPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const query = usePurchaseOrders(page, pageSize, status, search);
  const { modules } = useAccessibleModules();
  const canCreate = Boolean(modules.find((module) => module.name === "purchase_orders")?.actions?.can_create);

  return (
    <PageShell
      variant="list"
      title="Purchase orders"
      description="Stock ordered from vendors. Placed orders count as incoming until they are received."
      actions={canCreate ? <Button asChild><Link href={`${DASHBOARD_ROUTES.purchaseOrders}/new`}>New purchase order</Link></Button> : null}
    >
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search purchase orders" />
        <Select value={status || "all"} onValueChange={(value) => { setStatus(value === "all" ? "" : value); setPage(1); }}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open (draft or ordered)</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="ordered">Ordered</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <RecordTable
        label="Purchase orders"
        rows={query.data?.results ?? []}
        rowKey={(row) => row.id}
        rowHref={(row) => `${DASHBOARD_ROUTES.purchaseOrders}/${row.id}`}
        isLoading={query.isLoading}
        isPermissionDenied={isForbiddenError(query.error)}
        hasError={Boolean(query.error) && !isForbiddenError(query.error)}
        onRetry={() => void query.refetch()}
        emptyState={{
          icon: ShoppingBasket,
          title: "No purchase orders",
          description: "Create one, or draft them from the Reorder screen.",
          action: canCreate ? <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.purchaseOrders}/new`}>New purchase order</Link></Button> : undefined,
        }}
        columns={[
          { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
          { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={purchaseOrderStatus(row)} /> },
          { key: "vendor", label: "Vendor", size: "lg", render: (row) => row.vendor_name ?? "—" },
          { key: "expected", label: "Expected", size: "sm", render: (row) => (row.expected_date ? formatDateOnly(row.expected_date) : "—") },
          { key: "total", label: "Total", size: "sm", align: "right", render: (row) => <Money amount={row.subtotal} currency={row.currency} /> },
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
