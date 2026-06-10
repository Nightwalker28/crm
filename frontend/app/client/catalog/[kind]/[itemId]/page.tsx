"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useClientCatalogItem, useClientCatalogRequestActions, type ClientCatalogKind } from "@/hooks/useClientPortal";

function money(value: string | number, currency: string) {
  const amount = Number(value);
  return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Failed to submit request.";
}

export default function ClientCatalogItemPage() {
  const params = useParams();
  const kind = String(params.kind ?? "");
  const itemId = String(params.itemId ?? "");
  const itemQuery = useClientCatalogItem(kind, itemId);
  const { requestItem, isRequestingItem } = useClientCatalogRequestActions();
  const [quantity, setQuantity] = useState("1");
  const [details, setDetails] = useState("");

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericQuantity = Number(quantity);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      toast.error("Enter a valid quantity.");
      return;
    }
    try {
      const order = await requestItem({ kind: kind as ClientCatalogKind, itemId: Number(itemId), quantity, details });
      setDetails("");
      toast.success(`Order ${order.external_reference} submitted.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const item = itemQuery.data;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
          <Link href="/client" className="font-lynk text-3xl text-white">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client/catalog">
              <ArrowLeft className="h-4 w-4" />
              Catalog
            </Link>
          </Button>
        </header>

        {itemQuery.isLoading ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">Loading item...</div>
        ) : itemQuery.error ? (
          <div className="rounded-md border border-red-900/60 bg-red-950/20 p-5 text-sm text-red-200">
            {itemQuery.error instanceof Error ? itemQuery.error.message : "Catalog item unavailable."}
          </div>
        ) : item ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
              <div className="text-xs uppercase text-neutral-500">{item.kind}</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-50">{item.name}</h1>
              {item.description ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-neutral-400">{item.description}</p> : null}
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-xs uppercase text-neutral-500">Availability</div>
                  <div className="mt-1 capitalize text-neutral-100">{item.kind === "service" ? "Available" : item.availability_status.replaceAll("_", " ")}</div>
                </div>
                <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-xs uppercase text-neutral-500">Public price</div>
                  <div className="mt-1 text-neutral-100">{money(item.public_unit_price, item.currency)}</div>
                </div>
                <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-xs uppercase text-neutral-500">Your price</div>
                  <div className="mt-1 font-semibold text-neutral-50">{money(item.resolved_unit_price, item.currency)}</div>
                </div>
              </div>
            </section>

            <aside className="h-fit rounded-md border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="text-base font-semibold text-neutral-100">Request item</h2>
              <form className="mt-4 space-y-3" onSubmit={(event) => void submitRequest(event)}>
                <Input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" placeholder="Quantity" required />
                <Textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Add details for the internal team" />
                <Button type="submit" className="w-full" disabled={isRequestingItem}>
                  <Send className="h-4 w-4" />
                  {isRequestingItem ? "Submitting..." : "Submit Request"}
                </Button>
              </form>
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}
