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
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line-default pb-4">
          <Link href="/client" className="font-lynk text-3xl text-copy-primary">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client">Overview</Link>
          </Button>
        </header>

        <section className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm text-copy-secondary">
              <PackageSearch className="h-4 w-4" />
              Client catalog
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-copy-primary">Products and services</h1>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-copy-muted" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search catalog" className="pl-9" />
          </div>
        </section>

        {catalogQuery.isLoading ? (
          <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">Loading catalog...</div>
        ) : catalogQuery.error ? (
          <div className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-5 text-sm text-state-danger">
            {catalogQuery.error instanceof Error ? catalogQuery.error.message : "Failed to load catalog."}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">No published catalog items are available.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <Link key={`${item.kind}-${item.id}`} href={`/client/catalog/${item.kind}/${item.id}`} className="group rounded-[var(--radius-control)] border border-line-subtle bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-raised">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-copy-label">{item.kind}</div>
                    <h2 className="mt-1 truncate font-semibold text-copy-primary">{item.name}</h2>
                  </div>
                  <ArrowRight className="h-4 w-4 text-copy-muted transition-transform group-hover:translate-x-0.5" />
                </div>
                {item.description ? <p className="mt-2 line-clamp-2 text-p-sm text-copy-secondary">{item.description}</p> : null}
                <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                  <span className="capitalize text-copy-secondary">{availabilityLabel(item)}</span>
                  <span className="font-semibold text-copy-primary">{money(item.resolved_unit_price, item.currency)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
