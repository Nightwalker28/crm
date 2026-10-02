"use client";

import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";

import { QuickCreateSurface } from "@/components/ui/QuickCreateSurface";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PanelError } from "@/components/ui/PanelStates";
import { RecordTable } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { TextLink } from "@/components/ui/TextLink";
import { useProductReservations, useReservationActions, type ReservationLine } from "@/hooks/inventory/useReservations";
import { formatDateOnly } from "@/lib/datetime";
import { getOrderPriority } from "@/lib/statusStyles";

function quantity(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Decimal-safe enough for four places: compare and sum in ten-thousandths. */
function units(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 10_000) : NaN;
}

/**
 * Edit or move one product's holds between confirmed orders (12a-erp-fulfilment.md §3.5).
 *
 * Rows are oldest order first — the default allocation. Any hold changed here becomes
 * manual on the server, and a later shortage releases automatic holds before it.
 */
export function ReservationsDialog({
  open,
  onOpenChange,
  productId,
  initialWarehouseId,
  highlightOrderLineId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: number;
  initialWarehouseId?: number | null;
  highlightOrderLineId?: number | null;
}) {
  const [warehouseId, setWarehouseId] = useState<number | null>(initialWarehouseId ?? null);
  const query = useProductReservations(open ? productId : null, warehouseId);
  const { saveReservations } = useReservationActions();
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const data = query.data;

  // Closing forgets the draft, so the next open starts from what the server holds.
  function changeOpen(next: boolean) {
    if (!next) {
      setWarehouseId(initialWarehouseId ?? null);
      setEdits({});
      setSaveError(null);
    }
    onOpenChange(next);
  }

  const lines = data?.lines ?? [];
  const valueOf = (line: ReservationLine) => edits[line.order_line_id] ?? String(Number(line.reserved));
  const changed = lines.filter((line) => edits[line.order_line_id] !== undefined && units(edits[line.order_line_id]) !== units(line.reserved));
  const totalHeld = lines.reduce((sum, line) => sum + (units(valueOf(line)) || 0), 0);
  // Holds outside this list (none today, but the server is the judge) stay in the total.
  const heldElsewhere = data ? units(data.reserved) - lines.reduce((sum, line) => sum + units(line.reserved), 0) : 0;
  const onHand = data ? units(data.on_hand) : 0;
  const unallocated = onHand - totalHeld - heldElsewhere;
  const invalidLine = lines.find((line) => {
    const value = units(valueOf(line));
    return !Number.isFinite(value) || value < 0 || value > units(line.to_deliver);
  });

  const summary = changed.map((line) => {
    const delta = (units(valueOf(line)) - units(line.reserved)) / 10_000;
    return `${line.order_number} ${delta > 0 ? "gains" : "loses"} ${quantity(Math.abs(delta))}`;
  }).join(", ");

  async function submit() {
    if (!data) return;
    if (invalidLine) throw new Error(`${invalidLine.order_number} can hold between 0 and ${quantity(invalidLine.to_deliver)}.`);
    if (unallocated < 0) throw new Error(`That is ${quantity(-unallocated / 10_000)} more than is on hand.`);
    if (!changed.length) { changeOpen(false); return; }
    setSaveError(null);
    try {
      await saveReservations({ productId, payload: {
        warehouse_id: data.warehouse_id, version: data.version,
        holds: changed.map((line) => ({ order_line_id: line.order_line_id, quantity: valueOf(line) })),
      } });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Reservations could not be saved.");
      throw error;
    }
    toast.success(`Reservations saved: ${summary}.`);
    changeOpen(false);
  }

  return (
    <QuickCreateSurface
      open={open}
      onOpenChange={changeOpen}
      title={data ? `Reservations · ${data.product_name}` : "Reservations"}
      description="Stock held for confirmed orders, in the order new stock is offered: priority, then oldest. Change a quantity to move stock to a more urgent order."
      showCreateAndOpen={false}
      createLabel="Save reservations"
      pendingLabel="Saving…"
      isDirty={changed.length > 0}
      isLoading={query.isLoading}
      error={saveError}
      submitErrorMessage={null}
      validationSummary={invalidLine
        ? `${invalidLine.order_number} can hold between 0 and ${quantity(invalidLine.to_deliver)}.`
        : unallocated < 0 ? `That is ${quantity(-unallocated / 10_000)} more than is on hand.` : null}
      statusMessage={changed.length ? summary : null}
      onSubmit={submit}
      onSubmitError={(error) => { if (!saveError && error instanceof Error) setSaveError(error.message); }}
      discardTitle="Discard reservation changes?"
    >
      {query.error ? (
        <PanelError message={query.error instanceof Error ? query.error.message : "Reservations could not be loaded."} onRetry={() => void query.refetch()} />
      ) : (
        <div className="grid gap-4">
          {data && data.warehouses.length > 1 ? (
            <Field>
              <FieldLabel htmlFor="reservations-warehouse">Warehouse</FieldLabel>
              <Select value={String(data.warehouse_id)} onValueChange={(value) => { setEdits({}); setWarehouseId(Number(value)); }} disabled={changed.length > 0}>
                <SelectTrigger id="reservations-warehouse"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={String(warehouse.id)}>{warehouse.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <FactList className="grid-cols-3">
            <Fact label="On hand"><span className="tabular-nums">{quantity(data?.on_hand)}</span></Fact>
            <Fact label="Reserved"><span className="tabular-nums">{data ? quantity((totalHeld + heldElsewhere) / 10_000) : "—"}</span></Fact>
            <Fact label="Unallocated"><span className="tabular-nums">{data ? quantity(unallocated / 10_000) : "—"}</span></Fact>
          </FactList>
          <RecordTable
            variant="lineItems"
            shellVariant="nested"
            label="Reservations by order"
            rows={lines}
            rowKey={(row) => row.order_line_id}
            isLoading={query.isLoading}
            emptyState={{ icon: PackageCheck, title: "No open orders", description: "Confirmed orders waiting for this product appear here." }}
            columns={[
              { key: "order", label: "Order", size: "sm", render: (row) => (
                <span className="flex flex-col">
                  <TextLink href={`/dashboard/sales/orders/${row.order_id}?tab=fulfilment`}>{row.order_number}</TextLink>
                  {row.order_line_id === highlightOrderLineId ? <span className="text-xs text-copy-label">This order</span> : null}
                </span>
              ) },
              { key: "customer", label: "Customer", render: (row) => row.customer_name ?? "—" },
              { key: "priority", label: "Priority", size: "sm", render: (row) => <StatusValue status={getOrderPriority(row.priority)} /> },
              { key: "confirmed", label: "Confirmed", size: "sm", render: (row) => formatDateOnly(row.confirmed_at) },
              { key: "delivery", label: "Delivery date", size: "sm", render: (row) => (row.delivery_date ? formatDateOnly(row.delivery_date) : "—") },
              { key: "to_deliver", label: "To deliver", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.to_deliver)}</span> },
              { key: "reserved", label: "Reserved", size: "md", align: "right", interactive: true, render: (row) => (
                <span className="flex items-center justify-end gap-2">
                  {row.manual ? <StatusValue status={{ tone: null, label: "Manual" }} /> : null}
                  <Input
                    aria-label={`Reserved for ${row.order_number}`}
                    type="number"
                    min={0}
                    max={Number(row.to_deliver)}
                    step="0.0001"
                    inputMode="decimal"
                    value={valueOf(row)}
                    onChange={(event) => setEdits((current) => ({ ...current, [row.order_line_id]: event.target.value }))}
                  />
                </span>
              ) },
            ]}
          />
        </div>
      )}
    </QuickCreateSurface>
  );
}
