"use client";

import Link from "next/link";
import { useState } from "react";
import { PackageSearch, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";

import { ReservationsDialog } from "@/components/inventory/ReservationsDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldLabel } from "@/components/ui/field";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import { useDeliveryActions } from "@/hooks/inventory/useDeliveries";
import { useOrderFulfilment, useReservationActions, type OrderFulfilmentLine } from "@/hooks/inventory/useReservations";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getDeliveryStatus, getOrderAvailability, getOrderDeliveryStatus } from "@/lib/statusStyles";

function quantity(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/**
 * The order's Fulfilment tab (12a-erp-fulfilment.md §3.5): per line, what was ordered,
 * delivered and held, what is still to deliver, and the order's deliveries.
 */
export function OrderFulfilmentPanel({
  orderId,
  canEdit,
  canReallocate,
  canCreateDelivery,
  showWarehouse,
}: {
  orderId: number;
  /** `edit` on the order: Check availability, Close remaining. */
  canEdit: boolean;
  /** `edit` on orders and `view` on stock: the Reservations dialog. */
  canReallocate: boolean;
  /** `create` on deliveries. */
  canCreateDelivery: boolean;
  showWarehouse: boolean;
}) {
  const fulfilment = useOrderFulfilment(orderId);
  const { reserveOrder, isSaving } = useReservationActions();
  const { closeRemaining, isSaving: isClosing } = useDeliveryActions();
  const [dialogLine, setDialogLine] = useState<OrderFulfilmentLine | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const data = fulfilment.data;
  const confirmed = data?.status === "confirmed";
  const toDeliver = data?.lines.some((line) => Number(line.to_deliver) > 0) ?? false;
  const waiting = data?.lines.some((line) => Number(line.waiting) > 0) ?? false;
  const delivered = data?.lines.some((line) => Number(line.delivered) > 0) ?? false;
  const returned = data?.lines.some((line) => Number(line.returned) > 0) ?? false;
  const showAvailable = data?.lines.some((line) => line.available != null) ?? false;
  const deliveries = data?.deliveries ?? [];
  const hasDraft = deliveries.some((delivery) => delivery.status === "draft");

  async function checkAvailability() {
    try {
      const result = await reserveOrder(orderId);
      const stillWaiting = result.lines.filter((line) => Number(line.waiting) > 0).length;
      toast.success(stillWaiting ? `Reserved what is free; ${stillWaiting} ${stillWaiting === 1 ? "line is" : "lines are"} still waiting for stock.` : "Everything on this order is reserved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Availability could not be checked.");
    }
  }

  async function submitClose() {
    if (!closeReason.trim()) { setCloseError("Enter a reason."); return; }
    try {
      setCloseError(null);
      await closeRemaining({ orderId, reason: closeReason.trim() });
      setCloseOpen(false);
      setCloseReason("");
      toast.success("The rest of the order is closed and its stock released.");
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : "The order could not be closed.");
    }
  }

  return (
    <Card className="min-w-0 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading description={confirmed ? "What has shipped, what is held and what is still to deliver." : "A confirmed order holds stock for its product lines and ships it in deliveries."}>Fulfilment</SectionHeading>
        <div className="flex flex-wrap gap-2">
          {canEdit && confirmed && waiting ? (
            <Button type="button" variant="outline" size="sm" disabled={isSaving} onClick={() => void checkAvailability()}>
              <RefreshCw />
              Check availability
            </Button>
          ) : null}
          {canEdit && confirmed && delivered && toDeliver && !hasDraft ? (
            <Button type="button" variant="outline" size="sm" onClick={() => { setCloseError(null); setCloseOpen(true); }}>Close remaining</Button>
          ) : null}
          {canCreateDelivery && confirmed && toDeliver ? (
            <Button asChild size="sm">
              <Link href={`${DASHBOARD_ROUTES.inventoryDeliveries}/new?order_id=${orderId}`}><Truck />Create delivery</Link>
            </Button>
          ) : null}
        </div>
      </div>
      {data ? (
        <FactList className="mt-4 grid-cols-2 lg:grid-cols-3">
          <Fact label="Delivery">
            <StatusValue status={getOrderDeliveryStatus(data.delivery_status)} context="record" />
          </Fact>
          {confirmed ? (
            <Fact label="Availability">
              {data.availability ? <StatusValue status={getOrderAvailability(data.availability)} context="record" /> : <span className="text-copy-secondary">Nothing to reserve</span>}
            </Fact>
          ) : null}
          {showWarehouse ? <Fact label="Warehouse">{data.warehouse_name ?? "—"}</Fact> : null}
          {data.remaining_close_reason ? <Fact label="Rest closed because">{data.remaining_close_reason}</Fact> : null}
        </FactList>
      ) : null}
      <div className="mt-6">
        <RecordTable
          variant="readOnly"
          shellVariant="nested"
          label="Order lines and stock"
          rows={data?.lines ?? []}
          rowKey={(row) => row.order_line_id}
          isLoading={fulfilment.isLoading}
          isPermissionDenied={isForbiddenError(fulfilment.error)}
          hasError={Boolean(fulfilment.error) && !isForbiddenError(fulfilment.error)}
          onRetry={() => void fulfilment.refetch()}
          emptyState={{ icon: PackageSearch, title: "No lines" }}
          columns={[
            { key: "name", label: "Item", size: "lg", render: (row) => row.name },
            { key: "ordered", label: "Ordered", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.ordered)}</span> },
            { key: "delivered", label: "Delivered", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{row.tracked ? quantity(row.delivered) : "—"}</span> },
            ...(returned ? [{ key: "returned", label: "Returned", size: "sm" as const, align: "right" as const, render: (row: OrderFulfilmentLine) => <span className="tabular-nums">{row.tracked ? quantity(row.returned) : "—"}</span> }] : []),
            { key: "reserved", label: "Reserved", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{row.tracked ? quantity(row.reserved) : "—"}</span> },
            { key: "to_deliver", label: "To deliver", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{row.tracked && confirmed ? quantity(row.to_deliver) : "—"}</span> },
            ...(showAvailable ? [{ key: "available", label: "Free in warehouse", size: "sm" as const, align: "right" as const, render: (row: OrderFulfilmentLine) => <span className="tabular-nums">{quantity(row.available)}</span> }] : []),
            { key: "availability", label: "Stock", size: "sm", render: (row) => (
              row.availability ? <StatusValue status={getOrderAvailability(row.availability)} /> : <span className="text-copy-secondary">{row.tracked ? "—" : "Not stocked"}</span>
            ) },
          ]}
          rowActions={canReallocate && confirmed ? (row) => (
            row.tracked && row.product_id && Number(row.to_deliver) > 0 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setDialogLine(row)} aria-label={`Reallocate stock for ${row.name}`}>Reallocate…</Button>
            ) : null
          ) : undefined}
        />
      </div>
      {deliveries.length ? (
        <div className="mt-6 flex flex-col gap-3">
          <SectionHeading>Deliveries</SectionHeading>
          <RecordTable
            variant="readOnly"
            shellVariant="nested"
            label="Deliveries for this order"
            rows={deliveries}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.inventoryDeliveries}/${row.id}`}
            emptyState={{ icon: Truck, title: "No deliveries" }}
            columns={[
              { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getDeliveryStatus(row.status)} /> },
              { key: "shipped", label: "Shipped on", size: "sm", render: (row) => (row.shipped_on ? formatDateOnly(row.shipped_on) : "—") },
              { key: "carrier", label: "Carrier", render: (row) => [row.carrier, row.tracking_number].filter(Boolean).join(" · ") || "—" },
              { key: "units", label: "Units", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.total_quantity)}</span> },
            ]}
          />
        </div>
      ) : null}
      {dialogLine?.product_id ? (
        <ReservationsDialog
          open={Boolean(dialogLine)}
          onOpenChange={(open) => { if (!open) setDialogLine(null); }}
          productId={dialogLine.product_id}
          initialWarehouseId={data?.warehouse_id ?? null}
          highlightOrderLineId={dialogLine.order_line_id}
        />
      ) : null}
      <EditorPanel
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title="Close the rest of this order"
        description="The order is finished without shipping what is left: its holds are released and nothing stays to deliver. Cancelling a delivery reopens it."
        closeLabel="Close panel"
        onSubmit={() => void submitClose()}
        status={closeError ? <span role="alert">{closeError}</span> : null}
        footer={<><Button variant="outline" onClick={() => setCloseOpen(false)}>Back</Button><Button type="submit" disabled={isClosing}>Close remaining</Button></>}
      >
        <Field><FieldLabel htmlFor="order-close-reason">Reason</FieldLabel><Textarea id="order-close-reason" maxLength={500} value={closeReason} onChange={(event) => setCloseReason(event.target.value)} /></Field>
      </EditorPanel>
    </Card>
  );
}
