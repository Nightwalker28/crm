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
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line-default pb-4">
          <Link href="/client" className="font-lynk text-3xl text-copy-primary">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client">Overview</Link>
          </Button>
        </header>

        <section className="mb-5">
          <div className="flex items-center gap-2 text-sm text-copy-secondary">
            <ScrollText className="h-4 w-4" />
            Client quotes
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-copy-primary">Quotes</h1>
        </section>

        {quotesQuery.isLoading ? (
          <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">Loading quotes...</div>
        ) : quotesQuery.error ? (
          <div className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-5 text-sm text-state-danger">
            {quotesQuery.error instanceof Error ? quotesQuery.error.message : "Failed to load quotes."}
          </div>
        ) : quotes.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">No quotes are assigned to your portal account yet.</div>
        ) : (
          <div className="grid gap-3">
            {quotes.map((quote) => (
              <Link key={quote.quote_id} href={`/client/quotes/${quote.quote_id}`} className="group rounded-[var(--radius-control)] border border-line-subtle bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-raised">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-copy-label">{quote.quote_number}</div>
                    <h2 className="mt-1 truncate font-semibold text-copy-primary">{quoteTitle(quote)}</h2>
                    <p className="mt-1 text-xs text-copy-muted">
                      Updated {formatDateTime(quote.updated_at ?? quote.created_time)}
                      {quote.expiry_date ? ` / Expires ${formatDateOnly(quote.expiry_date)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="capitalize text-copy-secondary">{statusLabel(quote.status)}</div>
                      <div className="text-sm font-semibold text-copy-primary">{money(quote.total_amount, quote.currency)}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-copy-muted transition-transform group-hover:translate-x-0.5" />
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
