"use client";

import Link from "next/link";
import { ArrowRight, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useClientQuotes, type ClientQuote } from "@/hooks/useClientPortal";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";

function money(value: string | number, currency: string) {
  const amount = Number(value);
  return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function quoteTitle(quote: ClientQuote) {
  return quote.title || quote.quote_number;
}

export default function ClientQuotesPage() {
  const quotesQuery = useClientQuotes();
  const quotes = quotesQuery.data?.results ?? [];

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
          <Link href="/client" className="font-lynk text-3xl text-white">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client">Overview</Link>
          </Button>
        </header>

        <section className="mb-5">
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <ScrollText className="h-4 w-4" />
            Client quotes
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-neutral-50">Quotes</h1>
        </section>

        {quotesQuery.isLoading ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">Loading quotes...</div>
        ) : quotesQuery.error ? (
          <div className="rounded-md border border-red-900/60 bg-red-950/20 p-5 text-sm text-red-200">
            {quotesQuery.error instanceof Error ? quotesQuery.error.message : "Failed to load quotes."}
          </div>
        ) : quotes.length === 0 ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">No quotes are assigned to your portal account yet.</div>
        ) : (
          <div className="grid gap-3">
            {quotes.map((quote) => (
              <Link key={quote.quote_id} href={`/client/quotes/${quote.quote_id}`} className="group rounded-md border border-neutral-800 bg-neutral-900 p-4 transition-colors hover:border-neutral-600 hover:bg-neutral-800/70">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase text-neutral-500">{quote.quote_number}</div>
                    <h2 className="mt-1 truncate font-semibold text-neutral-100">{quoteTitle(quote)}</h2>
                    <p className="mt-1 text-xs text-neutral-500">
                      Updated {formatDateTime(quote.updated_at ?? quote.created_time)}
                      {quote.expiry_date ? ` / Expires ${formatDateOnly(quote.expiry_date)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="capitalize text-neutral-300">{statusLabel(quote.status)}</div>
                      <div className="text-sm font-semibold text-neutral-50">{money(quote.total_amount, quote.currency)}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-neutral-500 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
