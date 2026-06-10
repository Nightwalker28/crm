"use client";

import Link from "next/link";
import { ArrowRight, PackageSearch, Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClientCatalog, type ClientCatalogItem } from "@/hooks/useClientPortal";

function money(value: string | number, currency: string) {
  const amount = Number(value);
  return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function availabilityLabel(item: ClientCatalogItem) {
  return item.kind === "service" ? "Available" : item.availability_status.replaceAll("_", " ");
}

export default function ClientCatalogPage() {
  const [search, setSearch] = useState("");
  const catalogQuery = useClientCatalog(search);
  const items = catalogQuery.data?.results ?? [];

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
          <Link href="/client" className="font-lynk text-3xl text-white">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client">Overview</Link>
          </Button>
        </header>

        <section className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <PackageSearch className="h-4 w-4" />
              Client catalog
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-neutral-50">Products and services</h1>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search catalog" className="pl-9" />
          </div>
        </section>

        {catalogQuery.isLoading ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">Loading catalog...</div>
        ) : catalogQuery.error ? (
          <div className="rounded-md border border-red-900/60 bg-red-950/20 p-5 text-sm text-red-200">
            {catalogQuery.error instanceof Error ? catalogQuery.error.message : "Failed to load catalog."}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">No published catalog items are available.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <Link key={`${item.kind}-${item.id}`} href={`/client/catalog/${item.kind}/${item.id}`} className="group rounded-md border border-neutral-800 bg-neutral-900 p-4 transition-colors hover:border-neutral-600 hover:bg-neutral-800/70">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase text-neutral-500">{item.kind}</div>
                    <h2 className="mt-1 truncate font-semibold text-neutral-100">{item.name}</h2>
                  </div>
                  <ArrowRight className="h-4 w-4 text-neutral-500 transition-transform group-hover:translate-x-0.5" />
                </div>
                {item.description ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-400">{item.description}</p> : null}
                <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                  <span className="capitalize text-neutral-400">{availabilityLabel(item)}</span>
                  <span className="font-semibold text-neutral-50">{money(item.resolved_unit_price, item.currency)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
