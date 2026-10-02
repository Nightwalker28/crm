"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InventoryDataTransferActions } from "@/components/inventory/InventoryDataTransferActions";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useMovements, useWarehouses } from "@/hooks/inventory/useInventory";
import { isForbiddenError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";

function amount(value: string) { const number = Number(value); return `${number > 0 ? "+" : ""}${number.toLocaleString(undefined, { maximumFractionDigits: 4 })}`; }

export default function InventoryMovementsPage() {
  const params = useSearchParams();
  const productId = Number(params.get("product_id")) || undefined;
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [moveType, setMoveType] = useState("");
  const warehouses = useWarehouses();
  const { modules } = useAccessibleModules();
  const stockActions = modules.find((module) => module.name === "inventory_stock")?.actions;
  const moves = useMovements(cursor, productId, warehouseId, moveType);
  const showWarehouse = (warehouses.data?.filter((row) => row.is_active).length ?? 0) > 1;
  function changeFilter(update: () => void) { update(); setCursor(null); setHistory([]); }
  return <PageShell variant="list" title="Movements" description="Every posted change to tracked stock, newest first." actions={<Button asChild variant="outline"><Link href={DASHBOARD_ROUTES.inventoryStock}>Stock</Link></Button>}>
    <div className="flex flex-wrap items-center gap-3">
      {showWarehouse ? <Select value={warehouseId || "all"} onValueChange={(value) => changeFilter(() => setWarehouseId(value === "all" ? "" : value))}><SelectTrigger aria-label="Filter warehouse"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All warehouses</SelectItem>{warehouses.data?.filter((row) => row.is_active).map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent></Select> : null}
      <Select value={moveType || "all"} onValueChange={(value) => changeFilter(() => setMoveType(value === "all" ? "" : value))}><SelectTrigger aria-label="Filter movement type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{["opening", "adjustment", "sales_order", "website_order", "reversal"].map((type) => <SelectItem key={type} value={type}>{type.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select>
    </div>
    <InventoryDataTransferActions kind="movements" canExport={Boolean(stockActions?.can_export)} />
    <RecordTable label="Stock movements" rows={moves.data?.results ?? []} rowKey={(row) => row.id}
      isLoading={moves.isLoading} isPermissionDenied={isForbiddenError(moves.error)} hasError={Boolean(moves.error) && !isForbiddenError(moves.error)} onRetry={() => void moves.refetch()}
      emptyState={{ icon: History, title: "No movements", description: "Opening stock, orders and adjustments appear here when posted." }}
      columns={[{ key: "date", label: "Date", render: (row) => formatDateTime(row.occurred_at) }, { key: "product", label: "Product", size: "lg", render: (row) => <Link className="text-copy-primary underline-offset-2 hover:underline" href={`${DASHBOARD_ROUTES.products}/${row.product_id}?tab=stock`}>{row.product_name}</Link> }, ...(showWarehouse ? [{ key: "warehouse", label: "Warehouse", render: (row: NonNullable<typeof moves.data>["results"][number]) => row.warehouse_name }] : []), { key: "type", label: "Type", render: (row) => row.move_type.replaceAll("_", " ") }, { key: "document", label: "Document", render: (row) => row.source_type === "sales_order" ? <Link className="underline-offset-2 hover:underline" href={`/dashboard/sales/orders/${row.source_id}`}>Sales order #{row.source_id}</Link> : `${row.source_type.replaceAll("_", " ")} #${row.source_id}` }, { key: "reason", label: "Reason", render: (row) => row.reason || "—" }, { key: "actor", label: "By", render: (row) => row.actor_label }, { key: "change", label: "Change", align: "right", render: (row) => <span className="tabular-nums">{amount(row.quantity)}</span> }, { key: "after", label: "On hand after", align: "right", render: (row) => <span className="tabular-nums">{Number(row.on_hand_after).toLocaleString()}</span> }]} />
    <div className="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={!history.length} onClick={() => { setCursor(history.at(-1) ?? null); setHistory((value) => value.slice(0, -1)); }}>Previous</Button><Button variant="outline" size="sm" disabled={!moves.data?.has_more} onClick={() => { setHistory((value) => [...value, cursor ?? ""]); setCursor(moves.data?.next_cursor ?? null); }}>Next</Button></div>
  </PageShell>;
}
