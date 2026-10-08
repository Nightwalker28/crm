"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { History, Scale } from "lucide-react";

import { InventoryDataTransferActions } from "@/components/inventory/InventoryDataTransferActions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/Money";
import Pagination from "@/components/ui/Pagination";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatGroup, StatTile } from "@/components/ui/StatTile";
import { StatusValue } from "@/components/ui/StatusValue";
import { TextLink } from "@/components/ui/TextLink";
import { useCatalogCategories } from "@/hooks/catalog/useCatalogCategories";
import { useRevaluations, useValuation, useValuationSummary, useWarehouses, type Revaluation, type ValuationRow } from "@/hooks/inventory/useInventory";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly, formatDateTime, todayIsoDate } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";

type Tab = "value" | "revaluations";

function quantity(value: string) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }); }

const KIND_LABELS: Record<Revaluation["kind"], string> = { manual: "Revalued", bill_variance: "Bill price difference", vendor_credit: "Vendor credit", migration: "Cost set" };

/** Inventory → Valuation (ERP E6, 12d-erp-costing.md §3.5): what the stock on hand is worth. */
export default function InventoryValuationPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = params.get("tab") === "revaluations" ? "revaluations" : "value";
  const { modules } = useAccessibleModules();
  const valuationActions = modules.find((module) => module.name === "inventory_valuation")?.actions;
  function showTab(next: Tab) {
    const address = new URLSearchParams(params.toString());
    if (next === "value") address.delete("tab"); else address.set("tab", next);
    router.replace(`${pathname}${address.size ? `?${address}` : ""}`, { scroll: false });
  }
  // A document, not a full-height list: the summary tiles and filters above the table are
  // taller than a short viewport, so one page scroll beats a pinned table that scrolls too (§11.1).
  return <PageShell variant="document" title="Valuation" description="What the stock on hand is worth at average cost, and every change to its value."
    actions={<>
      <SegmentedControl aria-label="Valuation view" value={tab} onValueChange={(next) => showTab(next as Tab)}>
        <SegmentedItem value="value"><Scale />Stock value</SegmentedItem>
        <SegmentedItem value="revaluations"><History />Revaluations</SegmentedItem>
      </SegmentedControl>
      <Button asChild variant="outline"><Link href={DASHBOARD_ROUTES.inventoryStock}>Stock</Link></Button>
    </>}>
    {tab === "value" ? <StockValue canExport={Boolean(valuationActions?.can_export)} /> : <Revaluations canExport={Boolean(valuationActions?.can_export)} />}
  </PageShell>;
}

function StockValue({ canExport }: { canExport: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [asOf, setAsOf] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [costFilter, setCostFilter] = useState<"all" | "missing">("all");
  const [sort, setSort] = useState<RecordTableSort>({ column: "product_name", direction: "asc" });
  const warehouses = useWarehouses();
  const categories = useCatalogCategories();
  const summary = useValuationSummary(asOf || undefined);
  const valuation = useValuation(page, pageSize, { asOf: asOf || undefined, warehouseId, categoryId, search, costMissing: costFilter === "missing" ? true : undefined, sortBy: sort.column, sortOrder: sort.direction });
  const currency = summary.data?.base_currency;
  const showWarehouse = (warehouses.data?.filter((row) => row.is_active).length ?? 0) > 1;
  const reset = () => setPage(1);
  const exportParams = new URLSearchParams({ kind: "valuation" });
  if (asOf) exportParams.set("as_of", asOf);
  if (warehouseId) exportParams.set("warehouse_id", warehouseId);
  if (categoryId) exportParams.set("category_id", categoryId);
  if (costFilter === "missing") exportParams.set("cost_missing", "true");
  const columns: RecordTableColumn<ValuationRow>[] = [
    { key: "product_name", label: "Product", size: "lg", sortable: true, render: (row) => <span className="font-semibold text-copy-primary">{row.product_name}</span> },
    { key: "sku", label: "SKU", render: (row) => row.sku || "—" },
    { key: "category", label: "Category", render: (row) => row.category_name || "—" },
    { key: "on_hand", label: "On hand", align: "right", sortable: true, render: (row) => <span className="tabular-nums">{quantity(row.on_hand)}</span> },
    { key: "average_cost", label: "Average cost", align: "right", sortable: true, render: (row) => row.cost_partial ? <span title={`${quantity(row.uncosted_quantity ?? "0")} on hand have no cost`}><Money amount={row.average_cost} currency={currency} maximumFractionDigits={4} /> <span className="text-copy-muted">(partial)</span></span> : <Money amount={row.average_cost} currency={currency} maximumFractionDigits={4} /> },
    { key: "stock_value", label: "Stock value", align: "right", sortable: true, render: (row) => row.cost_partial ? <StatusValue status={{ label: "Partly costed", tone: "attention" }} /> : row.cost_missing ? <StatusValue status={{ label: "Cost missing", tone: "attention" }} /> : <Money amount={row.stock_value} currency={currency} /> },
  ];
  const missing = summary.data?.cost_missing ?? 0;
  return <>
    <Card>
      <StatGroup label="Stock value">
        <StatTile label="Stock value" value={summary.isLoading ? "—" : <Money amount={summary.data?.total_value} currency={currency} />} context={asOf ? `At the end of ${formatDateOnly(asOf)}` : "Now"} />
        <StatTile label="Products in stock" value={summary.isLoading ? "—" : summary.data?.products_in_stock ?? 0} context={currency ? `Valued in ${currency}` : undefined} />
        <StatTile label="Cost missing" value={summary.isLoading ? "—" : missing} context={missing ? "Some or all units have no cost until revalued" : "Every product has a cost"} />
      </StatGroup>
    </Card>
    {missing > 0 && costFilter !== "missing" ? <div className="flex flex-wrap items-center gap-3">
      <p className="text-p-sm text-copy-secondary">{missing === 1 ? "One product in stock has" : `${missing} products in stock have`} no cost, so {missing === 1 ? "its" : "their"} stock counts as zero. Open each and use Revalue on its Stock tab.</p>
      <Button variant="outline" size="sm" onClick={() => { setCostFilter("missing"); reset(); }}>Show products with no cost</Button>
    </div> : null}
    <div className="flex flex-wrap items-end gap-3">
      <SearchBar value={search} onChange={(value) => { setSearch(value); reset(); }} placeholder="Search product or SKU" />
      <Field className="w-44"><FieldLabel htmlFor="valuation-as-of">As of</FieldLabel><Input id="valuation-as-of" type="date" value={asOf} max={todayIsoDate()} onChange={(event) => { setAsOf(event.target.value); reset(); }} /></Field>
      {showWarehouse ? <Select value={warehouseId || "all"} onValueChange={(value) => { setWarehouseId(value === "all" ? "" : value); reset(); }}><SelectTrigger aria-label="Filter warehouse"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All warehouses</SelectItem>{warehouses.data?.filter((row) => row.is_active).map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent></Select> : null}
      {categories.data?.length ? <Select value={categoryId || "all"} onValueChange={(value) => { setCategoryId(value === "all" ? "" : value); reset(); }}><SelectTrigger aria-label="Filter category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.data.map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.full_name}</SelectItem>)}</SelectContent></Select> : null}
      <Select value={costFilter} onValueChange={(value) => { setCostFilter(value as "all" | "missing"); reset(); }}><SelectTrigger aria-label="Filter cost"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All stock</SelectItem><SelectItem value="missing">Cost missing</SelectItem></SelectContent></Select>
    </div>
    <InventoryDataTransferActions kind="valuation" canExport={canExport} exportPath={`/inventory/valuation/export-job?${exportParams}`} exportLabel="Export valuation" />
    <RecordTable label="Stock valuation" rows={valuation.data?.results ?? []} rowKey={(row) => row.product_id} rowHref={(row) => `${DASHBOARD_ROUTES.products}/${row.product_id}?tab=stock`}
      sort={sort} onSortChange={(next) => { setSort(next); reset(); }}
      isLoading={valuation.isLoading} isPermissionDenied={isForbiddenError(valuation.error)} hasError={Boolean(valuation.error) && !isForbiddenError(valuation.error)} onRetry={() => void valuation.refetch()}
      emptyState={costFilter === "missing"
        ? { icon: Scale, title: "Every product has a cost", description: "Products in stock with no cost would appear here." }
        : { icon: Scale, title: "No stock on hand", description: asOf ? "Nothing was in stock at the end of that day." : "Tracked products with stock appear here with their value." }}
      columns={columns} />
    <Pagination page={page} totalPages={valuation.data?.total_pages ?? 0} totalCount={valuation.data?.total_count ?? 0} pageSize={pageSize} rangeStart={valuation.data?.range_start ?? 0} rangeEnd={valuation.data?.range_end ?? 0}
      isRefreshing={valuation.isFetching && !valuation.isLoading} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
  </>;
}

function Revaluations({ canExport }: { canExport: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const revaluations = useRevaluations(page, pageSize);
  const summary = useValuationSummary();
  const currency = summary.data?.base_currency;
  const columns: RecordTableColumn<Revaluation>[] = [
    { key: "date", label: "Date", render: (row) => formatDateTime(row.created_at) },
    { key: "number", label: "Number", render: (row) => row.number },
    { key: "product", label: "Product", size: "lg", render: (row) => <TextLink href={`${DASHBOARD_ROUTES.products}/${row.product_id}?tab=stock`}>{row.product_name ?? "Product"}</TextLink> },
    { key: "kind", label: "Kind", render: (row) => row.reverses_id ? `${KIND_LABELS[row.kind]} (undone)` : KIND_LABELS[row.kind] },
    { key: "average", label: "Average cost", align: "right", render: (row) => <span className="tabular-nums">
      {row.average_before == null ? "None" : <Money amount={row.average_before} currency={currency} maximumFractionDigits={4} />} → <Money amount={row.average_after} currency={currency} maximumFractionDigits={4} /></span> },
    { key: "stock_change", label: "Stock value change", align: "right", render: (row) => <Money amount={row.stock_change} currency={currency} /> },
    { key: "cogs_change", label: "Cost of goods change", align: "right", render: (row) => Number(row.cogs_change) ? <Money amount={row.cogs_change} currency={currency} /> : "—" },
    { key: "reason", label: "Reason", size: "lg", render: (row) => row.reason },
    { key: "by", label: "By", render: (row) => row.actor_name || "System" },
  ];
  return <>
    <InventoryDataTransferActions kind="revaluations" canExport={canExport} exportPath="/inventory/valuation/export-job?kind=revaluations" exportLabel="Export revaluations" />
    <RecordTable label="Revaluations" rows={revaluations.data?.results ?? []} rowKey={(row) => row.id}
      isLoading={revaluations.isLoading} isPermissionDenied={isForbiddenError(revaluations.error)} hasError={Boolean(revaluations.error) && !isForbiddenError(revaluations.error)} onRetry={() => void revaluations.refetch()}
      emptyState={{ icon: History, title: "No revaluations", description: "A Revalue on a product, or a bill priced differently from its purchase order, appears here." }}
      columns={columns} />
    <Pagination page={page} totalPages={revaluations.data?.total_pages ?? 0} totalCount={revaluations.data?.total_count ?? 0} pageSize={pageSize} rangeStart={revaluations.data?.range_start ?? 0} rangeEnd={revaluations.data?.range_end ?? 0}
      isRefreshing={revaluations.isFetching && !revaluations.isLoading} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
  </>;
}
