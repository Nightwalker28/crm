"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Send } from "lucide-react";
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
      toast.success(`Order ${order.external_reference} submitted.`);
    } catch {
      toast.error("The request could not be submitted. Check your connection and try again.");
    }
  }

  return (
    // Archetype 2, read-only (§4.7): no `spine`. Requesting the item creates an order — a
    // row pointing at this record, not a column on it.
    <RecordWorkspace
      title={item?.name ?? "Catalog item"}
      description="Review the item and request it from the team."
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
            <span className="capitalize">{item.kind}</span>
            <Money amount={item.resolved_unit_price} currency={item.currency} />
          </>
        ) : null
      }
      details={
        item ? (
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-6">
              {item.description ? (
                <Card className="flex min-w-0 flex-col gap-4 px-5 py-5">
                  <PanelHeader title="About this item" />
                  <p className="whitespace-pre-wrap text-p-sm text-copy-secondary">{item.description}</p>
                </Card>
              ) : null}

              <Card className="px-5 py-5">
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

            <Card className="flex h-fit min-w-0 flex-col gap-4 px-5 py-5">
              <PanelHeader title="Request this item" description="The team turns your request into an order." />
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
                    placeholder="Anything the team should know"
                  />
                </Field>
                <Button type="submit" className="w-full" disabled={isRequestingItem}>
                  <Send />
                  {isRequestingItem ? "Submitting…" : "Submit request"}
                </Button>
              </form>
            </Card>
          </div>
        ) : null
      }
    />
  );
}
