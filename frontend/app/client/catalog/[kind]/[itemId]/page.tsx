"use client";

import { formatSnakeCaseLabel } from "@/lib/module-display";
import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CircleCheck, Send } from "lucide-react";
import { toast } from "sonner";

import { RecordWorkspace } from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/Money";
import { PanelHeader } from "@/components/ui/PanelStates";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import {
  useClientCatalogItem,
  useClientCatalogRequestActions,
  type ClientCatalogKind,
} from "@/hooks/useClientPortal";
import { getCatalogStockStatus, getGenericStatus } from "@/lib/statusStyles";

export default function ClientCatalogItemPage() {
  const params = useParams();
  const kind = String(params.kind ?? "");
  const itemId = String(params.itemId ?? "");
  const itemQuery = useClientCatalogItem(kind, itemId);
  const { requestItem, isRequestingItem } = useClientCatalogRequestActions();
  const [quantity, setQuantity] = useState("1");
  const [details, setDetails] = useState("");
  // 13d §3.7: after submitting, the request's reference and where to follow it.
  const [submitted, setSubmitted] = useState<{ id: number; order_number: string } | null>(null);
  const item = itemQuery.data;

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericQuantity = Number(quantity);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      toast.error("Enter a quantity greater than zero.");
      return;
    }
    try {
      const order = await requestItem({ kind: kind as ClientCatalogKind, itemId: Number(itemId), quantity, details });
      setDetails("");
      setSubmitted({ id: order.id, order_number: order.order_number });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The request could not be sent. Check your connection and try again.");
    }
  }

  return (
    // Archetype 2, read-only (§4.7): no `spine`. Requesting the item creates an order — a
    // row pointing at this record, not a column on it.
    <RecordWorkspace
      title={item?.name ?? "Catalog item"}
      description="See the item and your price, and ask us for it."
      backHref="/client/catalog"
      backLabel="Catalog"
      isLoading={itemQuery.isLoading}
      hasError={Boolean(itemQuery.error) || (!itemQuery.isLoading && !item)}
      onRetry={() => void itemQuery.refetch()}
      status={
        item ? (
          <StatusValue
            status={item.kind === "service" ? getGenericStatus("available") : getCatalogStockStatus(item.availability_status)}
            context="record"
          />
        ) : null
      }
      subtitle={
        item ? (
          <>
            <span>{formatSnakeCaseLabel(item.kind)}</span>
            <Money amount={item.resolved_unit_price} currency={item.currency} />
          </>
        ) : null
      }
      details={
        item ? (
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex min-w-0 flex-col gap-6">
              {item.description ? (
                <Card className="flex min-w-0 flex-col gap-4 p-6">
                  <PanelHeader title="About this item" />
                  <p className="whitespace-pre-wrap text-p-sm text-copy-secondary">{item.description}</p>
                </Card>
              ) : null}

              <Card className="p-6">
                <FactList>
                  <Fact label="Public price">
                    <Money amount={item.public_unit_price} currency={item.currency} />
                  </Fact>
                  <Fact label="Your price">
                    <Money amount={item.resolved_unit_price} currency={item.currency} className="font-medium text-copy-primary" />
                  </Fact>
                </FactList>
              </Card>
            </div>

            <Card className="flex h-fit min-w-0 flex-col gap-4 p-6">
              <PanelHeader title="Request this item" description="We confirm your request as an order and let you know." />
              {submitted ? (
                <div role="status" className="grid gap-3 rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-copy-primary">
                    <CircleCheck className="h-4 w-4 text-state-success" aria-hidden="true" />
                    Request sent
                  </p>
                  <p className="text-sm text-copy-secondary">
                    Your reference is <span className="font-semibold text-copy-primary">{submitted.order_number}</span>. It shows under Orders as
                    awaiting confirmation until we confirm it.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm"><Link href={`/client/orders/${submitted.id}`}>View request</Link></Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setSubmitted(null)}>Request again</Button>
                  </div>
                </div>
              ) : (
              <form className="grid gap-4" onSubmit={(event) => void submitRequest(event)}>
                <Field>
                  <FieldLabel htmlFor="catalog-request-quantity">
                    Quantity <RequiredMark />
                  </FieldLabel>
                  <Input
                    id="catalog-request-quantity"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    inputMode="decimal"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="catalog-request-details">Details</FieldLabel>
                  <Textarea
                    id="catalog-request-details"
                    value={details}
                    onChange={(event) => setDetails(event.target.value)}
                    placeholder="Delivery date, sizes, anything we should know"
                  />
                </Field>
                <Button type="submit" className="w-full" disabled={isRequestingItem}>
                  <Send />
                  {isRequestingItem ? "Sending…" : "Send request"}
                </Button>
              </form>
              )}
            </Card>
          </div>
        ) : null
      }
    />
  );
}
