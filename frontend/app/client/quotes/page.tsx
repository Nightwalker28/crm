"use client";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { StatusValue } from "@/components/ui/StatusValue";
import { useClientQuotes, type ClientQuote } from "@/hooks/useClientPortal";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getClientQuoteState } from "@/lib/statusStyles";

function quoteTitle(quote: ClientQuote) {
  return quote.title || quote.quote_number;
}

export default function ClientQuotesPage() {
  const quotesQuery = useClientQuotes();
  const quotes = quotesQuery.data?.results ?? [];

  return (
    <PageShell
      title="Quotes"
      isLoading={quotesQuery.isLoading}
      hasError={Boolean(quotesQuery.error)}
      backHref="/client"
      backLabel="Return to the portal"
      onRetry={() => quotesQuery.refetch()}
    >
      {quotes.length === 0 ? (
        <EmptyState
          title="No quotes yet"
          description="Quotes we send you appear here, for you to read, download and accept or decline."
        />
      ) : (
        <Card className="p-0">
          <RowList label="Quotes" inset>
            {quotes.map((quote) => (
              <ListRow
                key={quote.quote_id}
                title={quoteTitle(quote)}
                href={`/client/quotes/${quote.quote_id}`}
                meta={
                  <>
                    {quote.quote_number} · Updated {formatDateTime(quote.updated_at ?? quote.created_time)}
                    {quote.expiry_date ? ` · Expires ${formatDateOnly(quote.expiry_date)}` : ""}
                  </>
                }
                trailing={
                  <span className="flex items-center gap-3">
                    <StatusValue status={getClientQuoteState(quote.state)} />
                    <Money amount={quote.total_amount} currency={quote.currency} className="font-medium text-copy-primary" />
                  </span>
                }
              />
            ))}
          </RowList>
        </Card>
      )}
    </PageShell>
  );
}
