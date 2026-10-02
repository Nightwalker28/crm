"use client";

import Link from "next/link";
import { useState } from "react";
import { Boxes, ListChecks, Plus } from "lucide-react";
import { toast } from "sonner";

import { ReservationsDialog } from "@/components/inventory/ReservationsDialog";
import { QuickCreateSurface } from "@/components/ui/QuickCreateSurface";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useInventoryActions, useProductStock, useWarehouses } from "@/hooks/inventory/useInventory";
import { formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { isForbiddenError } from "@/lib/api";

function quantity(value: string | number | null) {
  if (value == null) return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function CatalogItemStockPanel({ productId, canAdjust, canManageReservations = false }: {
  productId: number;
  canAdjust: boolean;
  /** `view` on stock and `edit` on orders: the Reservations dialog, which edits holds. */
  canManageReservations?: boolean;
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
  const multipleWarehouses = (warehouses.data?.filter((warehouse) => warehouse.is_active).length ?? 0) > 1;
  const dirty = Boolean(value || reason || note || warehouseId || mode !== "change");

  async function submit() {
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number) || (mode === "quantity" && number < 0) || !reason.trim()) {
      throw new Error("Enter a valid quantity and a reason.");
    }
    await adjust({ productId, payload: {
      ...(multipleWarehouses && warehouseId ? { warehouse_id: Number(warehouseId) } : {}),
      ...(mode === "change" ? { change: number } : { quantity: number }),
      reason: reason.trim(), note: note.trim() || undefined,
    } });
    toast.success("Stock adjustment posted.");
    setOpen(false);
    setValue(""); setReason(""); setNote(""); setWarehouseId(""); setMode("change");
  }

  const data = stock.data;
  return (
    <Card className="min-w-0 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading description="Balances and recent posted changes for this product.">Stock</SectionHeading>
        <div className="flex flex-wrap gap-2">
          {canManageReservations && data?.track_inventory ? <Button type="button" variant="outline" size="sm" onClick={() => setReservationsOpen(true)}><ListChecks />Reservations</Button> : null}
          {canAdjust && data?.track_inventory ? <Button type="button" size="sm" onClick={() => setOpen(true)}><Plus />Adjust stock</Button> : null}
        </div>
      </div>
      {data?.track_inventory ? (
        <FactList className="mt-4 grid-cols-3">
          <Fact label="On hand"><span className="tabular-nums">{quantity(data.on_hand)}</span></Fact>
          <Fact label="Reserved"><span className="tabular-nums">{quantity(data.reserved)}</span></Fact>
          <Fact label="Available"><span className="tabular-nums">{quantity(data.available)}</span></Fact>
        </FactList>
      ) : <p className="mt-4 text-p-sm text-copy-secondary">Inventory is not tracked for this product.</p>}
      {multipleWarehouses && data?.track_inventory ? (
        <div className="mt-6">
          <SectionHeading>By warehouse</SectionHeading>
          <RecordTable variant="readOnly" shellVariant="nested" label="Warehouse stock" rows={data.warehouses} rowKey={(row) => row.id}
            emptyState={{ icon: Boxes, title: "No warehouse balances" }}
            columns={[{ key: "name", label: "Warehouse", render: (row) => row.name }, { key: "on_hand", label: "On hand", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.on_hand)}</span> }, { key: "reserved", label: "Reserved", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.reserved)}</span> }, { key: "available", label: "Available", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.available)}</span> }]} />
        </div>
      ) : null}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-3"><SectionHeading>Recent movements</SectionHeading><Button asChild variant="outline" size="sm"><Link href={`${DASHBOARD_ROUTES.inventoryMovements}?product_id=${productId}`}>View all movements</Link></Button></div>
        <RecordTable variant="readOnly" shellVariant="nested" label="Recent stock movements" rows={data?.movements ?? []} rowKey={(row) => row.id}
          isLoading={stock.isLoading} isPermissionDenied={isForbiddenError(stock.error)} hasError={Boolean(stock.error) && !isForbiddenError(stock.error)} onRetry={() => void stock.refetch()}
          emptyState={{ icon: Boxes, title: "No movements yet", description: "Opening balances and adjustments appear here." }}
          columns={[{ key: "date", label: "Date", render: (row) => formatDateTime(row.occurred_at) }, { key: "type", label: "Type", render: (row) => row.move_type.replaceAll("_", " ") }, { key: "warehouse", label: "Warehouse", render: (row) => row.warehouse_name }, { key: "actor", label: "By", render: (row) => row.actor_label }, { key: "quantity", label: "Change", align: "right", render: (row) => <span className="tabular-nums">{Number(row.quantity) > 0 ? "+" : ""}{quantity(row.quantity)}</span> }, { key: "after", label: "On hand after", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.on_hand_after)}</span> }]} />
      </div>
      {canManageReservations ? <ReservationsDialog open={reservationsOpen} onOpenChange={setReservationsOpen} productId={productId} /> : null}
      <QuickCreateSurface open={open} onOpenChange={setOpen} title="Adjust stock" description="Post a reasoned change to the inventory ledger." showCreateAndOpen={false} createLabel="Post adjustment" pendingLabel="Posting…" isDirty={dirty} onSubmit={submit} onSubmitError={(error) => toast.error(error instanceof Error ? error.message : "Stock could not be adjusted.")}>
        <div className="grid gap-4">
          {multipleWarehouses ? <Field><FieldLabel>Warehouse</FieldLabel><Select value={warehouseId || String(warehouses.data?.find((row) => row.is_default)?.id ?? "")} onValueChange={setWarehouseId}><SelectTrigger aria-label="Warehouse"><SelectValue /></SelectTrigger><SelectContent>{warehouses.data?.filter((row) => row.is_active).map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent></Select></Field> : null}
          <Field><FieldLabel>Change type</FieldLabel><Select value={mode} onValueChange={(next) => setMode(next as "change" | "quantity")}><SelectTrigger aria-label="Change type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="change">Change by</SelectItem><SelectItem value="quantity">Set new quantity</SelectItem></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="inventory-adjustment-value">{mode === "change" ? "Change" : "New quantity"}</FieldLabel><Input id="inventory-adjustment-value" type="number" step="0.0001" value={value} onChange={(event) => setValue(event.target.value)} /><FieldDescription>Use a negative change to take stock out.</FieldDescription></Field>
          <Field><FieldLabel htmlFor="inventory-adjustment-reason">Reason</FieldLabel><Input id="inventory-adjustment-reason" value={reason} maxLength={120} onChange={(event) => setReason(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="inventory-adjustment-note">Note</FieldLabel><Textarea id="inventory-adjustment-note" value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        </div>
      </QuickCreateSurface>
    </Card>
  );
}
