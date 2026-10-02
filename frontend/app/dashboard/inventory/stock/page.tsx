"use client";

import Link from "next/link";
import { useState } from "react";
import { Boxes } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStock, useWarehouses } from "@/hooks/inventory/useInventory";
import { isForbiddenError } from "@/lib/api";
import { DASHBOARD_ROUTES } from "@/lib/routes";

function amount(value: string) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }); }

export default function InventoryStockPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [warehouseId, setWarehouseId] = useState("");
  const [stockStatus, setStockStatus] = useState("");
  const stock = useStock(page, search, warehouseId, stockStatus);
  const warehouses = useWarehouses();
  const showWarehouse = (warehouses.data?.filter((row) => row.is_active).length ?? 0) > 1;
  return <PageShell variant="list" title="Stock" description="On hand and available quantities by product." actions={<Button asChild variant="outline"><Link href={DASHBOARD_ROUTES.inventoryMovements}>Movements</Link></Button>}>
    <div className="flex flex-wrap items-center gap-3">
      <SearchBar value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search product or SKU" />
      {showWarehouse ? <Select value={warehouseId || "all"} onValueChange={(value) => { setWarehouseId(value === "all" ? "" : value); setPage(1); }}><SelectTrigger aria-label="Filter warehouse"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All warehouses</SelectItem>{warehouses.data?.filter((row) => row.is_active).map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent></Select> : null}
      <Select value={stockStatus || "all"} onValueChange={(value) => { setStockStatus(value === "all" ? "" : value); setPage(1); }}><SelectTrigger aria-label="Filter stock status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All stock</SelectItem><SelectItem value="in_stock">In stock</SelectItem><SelectItem value="out_of_stock">Out of stock</SelectItem></SelectContent></Select>
    </div>
    <RecordTable label="Stock" rows={stock.data?.results ?? []} rowKey={(row) => `${row.product_id}-${row.warehouse_id}`} rowHref={(row) => `${DASHBOARD_ROUTES.products}/${row.product_id}?tab=stock`}
      isLoading={stock.isLoading} isPermissionDenied={isForbiddenError(stock.error)} hasError={Boolean(stock.error) && !isForbiddenError(stock.error)} onRetry={() => void stock.refetch()}
      emptyState={{ icon: Boxes, title: "No tracked stock", description: "Enable tracking on a product to see its warehouse balance here." }}
      columns={[{ key: "product", label: "Product", size: "lg", render: (row) => <span className="font-semibold text-copy-primary">{row.product_name}</span> }, { key: "sku", label: "SKU", render: (row) => row.sku || "—" }, ...(showWarehouse ? [{ key: "warehouse", label: "Warehouse", render: (row: NonNullable<typeof stock.data>["results"][number]) => row.warehouse_name }] : []), { key: "on_hand", label: "On hand", align: "right", render: (row) => <span className="tabular-nums">{amount(row.on_hand)}</span> }, { key: "available", label: "Available", align: "right", render: (row) => <span className="tabular-nums">{amount(row.available)}</span> }]} />
    <div className="flex items-center justify-between text-sm text-copy-muted"><span>{stock.data?.total_count ?? 0} balances</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={!stock.data || page >= stock.data.total_pages} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
  </PageShell>;
}
