"use client";

import { useState } from "react";
import { PackageSearch, ShoppingBasket } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable, type RecordRowId } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TextLink } from "@/components/ui/TextLink";
import { useWarehouses } from "@/hooks/inventory/useInventory";
import { useReorderSuggestions, usePurchasingActions, type ReorderSuggestion } from "@/hooks/purchasing/usePurchasing";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { isForbiddenError } from "@/lib/api";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { formatQuantity as quantity } from "@/lib/quantity";

const rowId = (row: ReorderSuggestion) => `${row.product_id}-${row.warehouse_id}`;


/**
 * What to buy (12b-erp-purchasing.md §2 item 6): Odoo's Replenishment report, Zoho's *Order
 * now*. Projected stock counts what confirmed orders still need and what is already on
 * order. Selected rows become one draft purchase order per preferred vendor; nothing is
 * placed with a vendor until someone places the draft.
 */
export default function ReorderPage() {
  const { modules } = useAccessibleModules();
  const canCreate = Boolean(modules.find((module) => module.name === "purchase_orders")?.actions?.can_create);
  const canViewStock = Boolean(modules.find((module) => module.name === "inventory_stock")?.actions?.can_view);
  const warehouses = useWarehouses(false, canViewStock);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const query = useReorderSuggestions(warehouseId);
  const { draftFromReorder, isSaving } = usePurchasingActions();
  const [selected, setSelected] = useState<RecordRowId[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const rows = [...(query.data ?? [])].sort((a, b) => (a.preferred_vendor_name ?? "~").localeCompare(b.preferred_vendor_name ?? "~"));
  const selectable = rows.filter((row) => row.preferred_vendor_id);
  const activeWarehouses = warehouses.data?.filter((row) => row.is_active) ?? [];
  const valueOf = (row: ReorderSuggestion) => quantities[rowId(row)] ?? String(Number(row.suggested));

  async function createDrafts() {
    const chosen = rows.filter((row) => selected.includes(rowId(row)));
    if (!chosen.length) { toast.error("Select at least one product."); return; }
    const invalid = chosen.find((row) => !(Number(valueOf(row)) > 0));
    if (invalid) { toast.error(`${invalid.product_name}: enter a quantity above zero.`); return; }
    try {
      const result = await draftFromReorder(chosen.map((row) => ({ product_id: row.product_id, warehouse_id: row.warehouse_id, quantity: valueOf(row) })));
      setSelected([]);
      toast.success(`Drafted ${result.results.map((order) => order.number).join(", ")}. Review and place them from Purchase orders.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Purchase orders could not be drafted.");
    }
  }

  return (
    <PageShell
      variant="list"
      title="Reorder"
      description="Products at or below their reorder point once open orders and incoming stock are counted."
      actions={canCreate ? (
        <Button type="button" onClick={() => void createDrafts()} disabled={isSaving || !selected.length}>
          <ShoppingBasket />
          {selected.length ? `Draft purchase orders (${selected.length})` : "Draft purchase orders"}
        </Button>
      ) : null}
    >
      {activeWarehouses.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Select value={warehouseId ? String(warehouseId) : "all"} onValueChange={(value) => { setSelected([]); setWarehouseId(value === "all" ? null : Number(value)); }}>
            <SelectTrigger aria-label="Filter warehouse"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All warehouses</SelectItem>
              {activeWarehouses.map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <RecordTable
        label="Reorder suggestions"
        rows={rows}
        rowKey={rowId}
        groupBy={(row) => row.preferred_vendor_name ?? "No preferred vendor"}
        isLoading={query.isLoading}
        isPermissionDenied={isForbiddenError(query.error)}
        hasError={Boolean(query.error) && !isForbiddenError(query.error)}
        onRetry={() => void query.refetch()}
        emptyState={{ icon: PackageSearch, title: "Nothing to reorder", description: "Every tracked product is above its reorder point once incoming stock is counted." }}
        selection={canCreate ? {
          selectedIds: selected,
          onToggleRow: (id, checked) => setSelected((current) => (checked ? [...current, id] : current.filter((value) => value !== id))),
          onToggleAll: (checked) => setSelected(checked ? selectable.map(rowId) : []),
          rowLabel: (row) => `Reorder ${row.product_name}${activeWarehouses.length > 1 ? ` in ${row.warehouse_name}` : ""}`,
          allLabel: "Select every product with a preferred vendor",
          isRowSelectable: (row) => Boolean(row.preferred_vendor_id),
        } : undefined}
        columns={[
          { key: "product", label: "Product", size: "lg", render: (row) => (
            <span className="flex flex-col">
              <TextLink href={`${DASHBOARD_ROUTES.products}/${row.product_id}?tab=stock`}>{row.product_name}</TextLink>
              {row.preferred_vendor_id ? null : (
                <span className="text-xs text-copy-label">Set a preferred vendor on the product to order it from here</span>
              )}
            </span>
          ) },
          ...(activeWarehouses.length > 1 ? [{ key: "warehouse", label: "Warehouse", render: (row: ReorderSuggestion) => row.warehouse_name }] : []),
          { key: "available", label: "Available", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.available)}</span> },
          { key: "backordered", label: "Backordered", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.backordered)}</span> },
          { key: "incoming", label: "Incoming", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.incoming)}</span> },
          { key: "projected", label: "Projected", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.projected)}</span> },
          { key: "reorder_point", label: "Reorder point", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.reorder_point)}</span> },
          { key: "order", label: "Order", size: "md", align: "right", interactive: true, render: (row) => (
            <Input
              aria-label={`Quantity to order: ${row.product_name}${activeWarehouses.length > 1 ? ` in ${row.warehouse_name}` : ""}`}
              type="number"
              min={0}
              step="0.0001"
              inputMode="decimal"
              value={valueOf(row)}
              disabled={!row.preferred_vendor_id || !canCreate}
              onChange={(event) => setQuantities((current) => ({ ...current, [rowId(row)]: event.target.value }))}
            />
          ) },
        ]}
      />
    </PageShell>
  );
}
