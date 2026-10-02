"use client";

import Link from "next/link";
import { useState } from "react";
import { Boxes } from "lucide-react";

import { Button } from "@/components/ui/button";
import Pagination from "@/components/ui/Pagination";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InventoryDataTransferActions } from "@/components/inventory/InventoryDataTransferActions";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { StatusValue } from "@/components/ui/StatusValue";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useSavedViews } from "@/hooks/useSavedViews";
import { MODULE_VIEW_DEFAULTS } from "@/lib/moduleViewConfigs";
import { useStock, useWarehouses, type StockRow } from "@/hooks/inventory/useInventory";
import { isForbiddenError } from "@/lib/api";
import { DASHBOARD_ROUTES } from "@/lib/routes";

function amount(value: string) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }); }

export default function InventoryStockPage() {
  const [page, setPage] = useState(1);
  const [warehouseId, setWarehouseId] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [levelFilter, setLevelFilter] = useState("");
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("inventory_stock", MODULE_VIEW_DEFAULTS.inventory_stock);
  const search = String(draftConfig.filters.search ?? "");
  const filtersAll = JSON.stringify(draftConfig.filters.all_conditions ?? []);
  const filtersAny = JSON.stringify(draftConfig.filters.any_conditions ?? []);
  const { modules } = useAccessibleModules();
  const stockActions = modules.find((module) => module.name === "inventory_stock")?.actions;
  const adjustmentActions = modules.find((module) => module.name === "inventory_adjustments")?.actions;
  const stock = useStock(page, pageSize, search, warehouseId, levelFilter, filtersAll, filtersAny);
  const warehouses = useWarehouses();
  const showWarehouse = (warehouses.data?.filter((row) => row.is_active).length ?? 0) > 1;
  const columns: RecordTableColumn<StockRow>[] = [
    { key: "product", label: "Product", size: "lg", render: (row) => <span className="font-semibold text-copy-primary">{row.product_name}</span> },
    { key: "sku", label: "SKU", render: (row) => row.sku || "—" },
    { key: "category", label: "Category", render: (row) => row.category_name || "—" },
    ...(showWarehouse ? [{ key: "warehouse", label: "Warehouse", render: (row: StockRow) => row.warehouse_name }] : []),
    { key: "on_hand", label: "On hand", align: "right", render: (row) => <span className="tabular-nums">{amount(row.on_hand)}</span> },
    { key: "available", label: "Available", align: "right", render: (row) => <span className="tabular-nums">{amount(row.available)}</span> },
    { key: "reorder_point", label: "Reorder point", align: "right", render: (row) => <span className="tabular-nums">{amount(row.reorder_point)}</span> },
    { key: "status", label: "Status", render: (row) => Number(row.available) <= 0
      ? <StatusValue status={{ label: "Out of stock", tone: "critical" }} />
      : Number(row.reorder_point) > 0 && Number(row.available) <= Number(row.reorder_point)
        ? <StatusValue status={{ label: "Low stock", tone: "attention" }} />
        : <StatusValue status={{ label: "In stock", tone: "success" }} /> },
  ];
  return <PageShell variant="list" title="Stock" description="On hand and available quantities by product." actions={<Button asChild variant="outline"><Link href={DASHBOARD_ROUTES.inventoryMovements}>Movements</Link></Button>}>
    <SavedViewSelector moduleKey="inventory_stock" views={views} selectedViewId={selectedViewId} onSelect={(value) => { setSelectedViewId(value); setPage(1); }} />
    <div className="flex flex-wrap items-center gap-3">
      <SearchBar value={search} onChange={(value) => { setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: value } })); setPage(1); }} placeholder="Search product or SKU" />
      {showWarehouse ? <Select value={warehouseId || "all"} onValueChange={(value) => { setWarehouseId(value === "all" ? "" : value); setPage(1); }}><SelectTrigger aria-label="Filter warehouse"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All warehouses</SelectItem>{warehouses.data?.filter((row) => row.is_active).map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent></Select> : null}
      <Select value={levelFilter || "all"} onValueChange={(value) => { setLevelFilter(value === "all" ? "" : value); setPage(1); }}><SelectTrigger aria-label="Filter stock status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All stock</SelectItem><SelectItem value="in_stock">In stock</SelectItem><SelectItem value="low_stock">Low stock</SelectItem><SelectItem value="out_of_stock">Out of stock</SelectItem></SelectContent></Select>
    </div>
    <InventoryDataTransferActions kind="levels" canExport={Boolean(stockActions?.can_export)} canImport={Boolean(adjustmentActions?.can_create && adjustmentActions?.can_edit)} />
    <RecordTable label="Stock" rows={stock.data?.results ?? []} rowKey={(row) => `${row.product_id}-${row.warehouse_id}`} rowHref={(row) => `${DASHBOARD_ROUTES.products}/${row.product_id}?tab=stock`}
      isLoading={stock.isLoading} isPermissionDenied={isForbiddenError(stock.error)} hasError={Boolean(stock.error) && !isForbiddenError(stock.error)} onRetry={() => void stock.refetch()}
      emptyState={{ icon: Boxes, title: "No tracked stock", description: "Enable tracking on a product to see its warehouse balance here." }}
      columns={columns.filter((column) => draftConfig.visible_columns.includes(column.key))} />
    <Pagination page={page} totalPages={stock.data?.total_pages ?? 0} totalCount={stock.data?.total_count ?? 0} pageSize={pageSize} rangeStart={stock.data?.range_start ?? 0} rangeEnd={stock.data?.range_end ?? 0}
      isRefreshing={stock.isFetching && !stock.isLoading} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
  </PageShell>;
}
