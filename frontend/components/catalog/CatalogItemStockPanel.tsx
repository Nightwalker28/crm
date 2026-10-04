"use client";

import Link from "next/link";
import { useState } from "react";
import { Boxes, ListChecks, Plus, Scale } from "lucide-react";
import { toast } from "sonner";

import { ReservationsDialog } from "@/components/inventory/ReservationsDialog";
import { QuickCreateSurface } from "@/components/ui/QuickCreateSurface";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/Money";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import { useInventoryActions, useProductStock, useRevalue, useWarehouses, type ProductStock, type StockMove } from "@/hooks/inventory/useInventory";
import { formatMoney } from "@/lib/currency";
import { formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { isForbiddenError } from "@/lib/api";

function quantity(value: string | number | null) {
  if (value == null) return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Where a movement's cost came from (12d §3.1), in words. */
const COST_SOURCES: Record<string, string> = {
  receipt: "Purchase cost", opening: "Opening cost", average: "Average cost", return: "Cost when delivered",
  reversal: "Cost of the reversed move", manual: "Entered cost", fallback: "Product cost at migration", missing: "Cost missing",
};

export function CatalogItemStockPanel({ productId, canAdjust, canManageReservations = false, canRevalue = false }: {
  productId: number;
  canAdjust: boolean;
  /** `view` on stock and `edit` on orders: the Reservations dialog, which edits holds. */
  canManageReservations?: boolean;
  /** `edit` on Inventory → Valuation. Cost figures show whenever the stock payload carries them. */
  canRevalue?: boolean;
}) {
  const [reservationsOpen, setReservationsOpen] = useState(false);
  const stock = useProductStock(productId);
  const warehouses = useWarehouses();
  const { adjust } = useInventoryActions();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"change" | "quantity">("change");
  const [value, setValue] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [revalueOpen, setRevalueOpen] = useState(false);
  const multipleWarehouses = (warehouses.data?.filter((warehouse) => warehouse.is_active).length ?? 0) > 1;
  const dirty = Boolean(value || reason || note || unitCost || warehouseId || mode !== "change");
  const needsCost = Boolean(stock.data?.needs_cost);

  async function submit() {
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number) || (mode === "quantity" && number < 0) || !reason.trim()) {
      throw new Error("Enter a valid quantity and a reason.");
    }
    const cost = Number(unitCost);
    const adding = mode === "change" ? number > 0 : number > Number(stock.data?.on_hand ?? 0);
    if (needsCost && adding && (!unitCost.trim() || !Number.isFinite(cost) || cost < 0)) {
      throw new Error("This product has no cost yet. Enter a unit cost for the stock you are adding.");
    }
    await adjust({ productId, payload: {
      ...(multipleWarehouses && warehouseId ? { warehouse_id: Number(warehouseId) } : {}),
      ...(mode === "change" ? { change: number } : { quantity: number }),
      reason: reason.trim(), note: note.trim() || undefined,
      ...(needsCost && unitCost.trim() ? { unit_cost: cost } : {}),
    } });
    toast.success("Stock adjustment posted.");
    setOpen(false);
    setValue(""); setReason(""); setNote(""); setUnitCost(""); setWarehouseId(""); setMode("change");
  }

  const data = stock.data;
  return (
    <Card className="min-w-0 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading description="Balances and recent posted changes for this product.">Stock</SectionHeading>
        <div className="flex flex-wrap gap-2">
          {canManageReservations && data?.track_inventory ? <Button type="button" variant="outline" size="sm" onClick={() => setReservationsOpen(true)}><ListChecks />Reservations</Button> : null}
          {canRevalue && data?.valuation ? <Button type="button" variant="outline" size="sm" onClick={() => setRevalueOpen(true)}><Scale />Revalue</Button> : null}
          {canAdjust && data?.track_inventory ? <Button type="button" size="sm" onClick={() => setOpen(true)}><Plus />Adjust stock</Button> : null}
        </div>
      </div>
      {data?.track_inventory ? (
        <FactList className="mt-4 grid-cols-2 sm:grid-cols-5">
          <Fact label="On hand"><span className="tabular-nums">{quantity(data.on_hand)}</span></Fact>
          <Fact label="Reserved"><span className="tabular-nums">{quantity(data.reserved)}</span></Fact>
          <Fact label="Available"><span className="tabular-nums">{quantity(data.available)}</span></Fact>
          <Fact label="Incoming"><span className="tabular-nums">{quantity(data.incoming ?? 0)}</span></Fact>
          <Fact label="Projected"><span className="tabular-nums" title="Available, less backordered demand, plus incoming">{quantity(data.projected)}</span></Fact>
        </FactList>
      ) : null}
      {data?.track_inventory && data.valuation ? (
        <FactList className="mt-4 grid-cols-2 sm:grid-cols-5">
          <Fact label="Average cost">{data.valuation.average_cost == null ? <span className="text-copy-muted">Not set</span> : <><Money amount={data.valuation.average_cost} currency={data.valuation.base_currency} maximumFractionDigits={4} />{data.valuation.cost_partial ? <span className="text-copy-muted"> (partial)</span> : null}</>}</Fact>
          <Fact label="Stock value"><Money amount={data.valuation.stock_value} currency={data.valuation.base_currency} /></Fact>
          {data.valuation.cost_partial ? (
            <Fact label="Cost"><StatusValue status={{ label: `${quantity(data.valuation.uncosted_quantity ?? 0)} without cost`, tone: "attention" }} /></Fact>
          ) : data.valuation.cost_missing ? <Fact label="Cost"><StatusValue status={{ label: "Cost missing", tone: "attention" }} /></Fact> : null}
        </FactList>
      ) : null}
      {data?.track_inventory ? null : data ? (
        <p className="mt-4 text-p-sm text-copy-secondary">Inventory is not tracked for this product.</p>
      ) : null}
      {multipleWarehouses && data?.track_inventory ? (
        <div className="mt-6">
          <SectionHeading>By warehouse</SectionHeading>
          <RecordTable variant="readOnly" shellVariant="nested" label="Warehouse stock" rows={data.warehouses} rowKey={(row) => row.id}
            emptyState={{ icon: Boxes, title: "No warehouse balances" }}
            columns={warehouseColumns(data)} />
        </div>
      ) : null}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-3"><SectionHeading>Recent movements</SectionHeading><Button asChild variant="outline" size="sm"><Link href={`${DASHBOARD_ROUTES.inventoryMovements}?product_id=${productId}`}>View all movements</Link></Button></div>
        <RecordTable variant="readOnly" shellVariant="nested" label="Recent stock movements" rows={data?.movements ?? []} rowKey={(row) => row.id}
          isLoading={stock.isLoading} isPermissionDenied={isForbiddenError(stock.error)} hasError={Boolean(stock.error) && !isForbiddenError(stock.error)} onRetry={() => void stock.refetch()}
          emptyState={{ icon: Boxes, title: "No movements yet", description: "Opening balances and adjustments appear here." }}
          columns={movementColumns(data)} />
      </div>
      {canManageReservations ? <ReservationsDialog open={reservationsOpen} onOpenChange={setReservationsOpen} productId={productId} /> : null}
      <QuickCreateSurface open={open} onOpenChange={setOpen} title="Adjust stock" description="Post a reasoned change to the inventory ledger." showCreateAndOpen={false} createLabel="Post adjustment" pendingLabel="Posting…" isDirty={dirty} onSubmit={submit} onSubmitError={(error) => toast.error(error instanceof Error ? error.message : "Stock could not be adjusted.")}>
        <div className="grid gap-4">
          {multipleWarehouses ? <Field><FieldLabel>Warehouse</FieldLabel><Select value={warehouseId || String(warehouses.data?.find((row) => row.is_default)?.id ?? "")} onValueChange={setWarehouseId}><SelectTrigger aria-label="Warehouse"><SelectValue /></SelectTrigger><SelectContent>{warehouses.data?.filter((row) => row.is_active).map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent></Select></Field> : null}
          <Field><FieldLabel>Change type</FieldLabel><Select value={mode} onValueChange={(next) => setMode(next as "change" | "quantity")}><SelectTrigger aria-label="Change type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="change">Change by</SelectItem><SelectItem value="quantity">Set new quantity</SelectItem></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="inventory-adjustment-value">{mode === "change" ? "Change" : "New quantity"}</FieldLabel><Input id="inventory-adjustment-value" type="number" step="0.0001" value={value} onChange={(event) => setValue(event.target.value)} /><FieldDescription>Use a negative change to take stock out.</FieldDescription></Field>
          {needsCost ? <Field><FieldLabel htmlFor="inventory-adjustment-cost">Unit cost</FieldLabel><Input id="inventory-adjustment-cost" type="number" min="0" step="0.0001" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} /><FieldDescription>This product has no cost yet. What one unit cost you, used to value the stock you add.</FieldDescription></Field> : null}
          <Field><FieldLabel htmlFor="inventory-adjustment-reason">Reason</FieldLabel><Input id="inventory-adjustment-reason" value={reason} maxLength={120} onChange={(event) => setReason(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="inventory-adjustment-note">Note</FieldLabel><Textarea id="inventory-adjustment-note" value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        </div>
      </QuickCreateSurface>
      {canRevalue && data?.valuation ? <RevalueDialog open={revalueOpen} onOpenChange={setRevalueOpen} productId={productId} onHand={Number(data.on_hand ?? 0)} valuation={data.valuation} /> : null}
    </Card>
  );
}

function warehouseColumns(data: ProductStock): RecordTableColumn<ProductStock["warehouses"][number]>[] {
  const currency = data.valuation?.base_currency;
  return [
    { key: "name", label: "Warehouse", render: (row) => row.name },
    { key: "on_hand", label: "On hand", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.on_hand)}</span> },
    { key: "reserved", label: "Reserved", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.reserved)}</span> },
    { key: "available", label: "Available", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.available)}</span> },
    ...(data.valuation ? [{ key: "value", label: "Stock value", align: "right" as const, render: (row: ProductStock["warehouses"][number]) => <Money amount={row.stock_value} currency={currency} /> }] : []),
  ];
}

function movementColumns(data: ProductStock | undefined): RecordTableColumn<StockMove>[] {
  const currency = data?.valuation?.base_currency;
  return [
    { key: "date", label: "Date", render: (row) => formatDateTime(row.occurred_at) },
    { key: "type", label: "Type", render: (row) => row.move_type.replaceAll("_", " ") },
    { key: "warehouse", label: "Warehouse", render: (row) => row.warehouse_name },
    { key: "actor", label: "By", render: (row) => row.actor_label },
    { key: "quantity", label: "Change", align: "right", render: (row) => <span className="tabular-nums">{Number(row.quantity) > 0 ? "+" : ""}{quantity(row.quantity)}</span> },
    { key: "after", label: "On hand after", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.on_hand_after)}</span> },
    ...(data?.valuation ? [
      { key: "unit_cost", label: "Unit cost", align: "right" as const, render: (row: StockMove) => <span title={row.cost_source ? COST_SOURCES[row.cost_source] ?? row.cost_source : undefined}><Money amount={row.unit_cost} currency={currency} maximumFractionDigits={4} /></span> },
      { key: "value", label: "Value", align: "right" as const, render: (row: StockMove) => <Money amount={row.value} currency={currency} /> },
    ] : []),
  ];
}

/** Set a new average cost for what is on hand (12d §3.2). Shows the change in value first. */
function RevalueDialog({ open, onOpenChange, productId, onHand, valuation }: {
  open: boolean; onOpenChange: (open: boolean) => void; productId: number; onHand: number; valuation: NonNullable<ProductStock["valuation"]>;
}) {
  const revalue = useRevalue();
  const [average, setAverage] = useState("");
  const [reason, setReason] = useState("");
  const next = Number(average);
  const valid = average.trim() !== "" && Number.isFinite(next) && next >= 0;
  const change = valid && onHand > 0 ? onHand * next - Number(valuation.stock_value) : null;
  return (
    <QuickCreateSurface open={open} onOpenChange={onOpenChange} title="Revalue stock" description="Set a new average cost for the stock on hand. The change is recorded as a revaluation."
      showCreateAndOpen={false} createLabel="Revalue" pendingLabel="Revaluing…" isDirty={Boolean(average || reason)}
      onSubmit={async () => {
        if (!valid || !reason.trim()) throw new Error("Enter an average cost of zero or more, and a reason.");
        await revalue.mutateAsync({ product_id: productId, average_cost: next, reason: reason.trim() });
        toast.success("Stock revalued.");
        onOpenChange(false);
        setAverage(""); setReason("");
      }}
      onSubmitError={(error) => toast.error(error instanceof Error ? error.message : "Stock could not be revalued.")}>
      <div className="grid gap-4">
        <Field><FieldLabel htmlFor="revalue-average">New average cost ({valuation.base_currency})</FieldLabel><Input id="revalue-average" type="number" min="0" step="0.0001" value={average} onChange={(event) => setAverage(event.target.value)} />
          <FieldDescription>{onHand > 0
            ? change === null ? `Currently ${valuation.average_cost == null ? "no cost" : formatMoney(valuation.average_cost, valuation.base_currency, { maximumFractionDigits: 4 })} for ${quantity(onHand)} on hand.`
              : `Stock value changes by ${formatMoney(change, valuation.base_currency)}, to ${formatMoney(onHand * next, valuation.base_currency)}.`
            : "Nothing is on hand: this sets the cost the next stock added takes."}</FieldDescription></Field>
        <Field><FieldLabel htmlFor="revalue-reason">Reason</FieldLabel><Input id="revalue-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></Field>
      </div>
    </QuickCreateSurface>
  );
}
