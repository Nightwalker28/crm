"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { ClientPdfButton } from "@/components/client-portal/ClientPdfButton";
import { QuoteAcceptForm, QuoteDeclineForm } from "@/components/quotes/QuoteResponse";
import { RecordWorkspace } from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { PanelHeader } from "@/components/ui/PanelStates";
import { StatusValue } from "@/components/ui/StatusValue";
import { useClientQuote, useClientQuoteActions, type ClientQuote } from "@/hooks/useClientPortal";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getClientQuoteState } from "@/lib/statusStyles";

const CLOSED_COPY: Record<Exclude<ClientQuote["state"], "open">, string> = {
  pending: "We are still preparing this quote. You can answer it once we send it.",
  accepted: "You accepted this quote. We will be in touch about next steps.",
  declined: "You declined this quote. Thank you for letting us know.",
  expired: "This quote has expired. Ask us for an updated one.",
  replaced: "We have sent a newer version of this quote; answer that one instead.",
};

/**
 * A quote in the portal (13d §3.5, §3.7): the document as we issued it, its PDF, and the same
 * accept and decline the emailed proposal link offers, signed in.
 */
export default function ClientQuoteDetailPage() {
  const params = useParams<{ quoteId: string }>();
  const quoteQuery = useClientQuote(params.quoteId);
  const { acceptQuote, declineQuote, isAnswering } = useClientQuoteActions();
  const [mode, setMode] = useState<"view" | "accept" | "decline">("view");
  const quote = quoteQuery.data;

  return (
    // Archetype 2, read-only (§4.7): no `spine`. Accept and decline are actions on the quote.
    <RecordWorkspace
      title={quote ? (quote.title || `Quote ${quote.quote_number}`) : "Quote"}
      description="Read the quote, download it, and accept or decline it."
      backHref="/client/quotes"
      backLabel="Quotes"
      isLoading={quoteQuery.isLoading}
      hasError={Boolean(quoteQuery.error) || (!quoteQuery.isLoading && !quote)}
      onRetry={() => void quoteQuery.refetch()}
      status={quote ? <StatusValue status={getClientQuoteState(quote.state)} context="record" /> : null}
      actions={quote ? <ClientPdfButton kind="quotes" id={quote.quote_id} name={quote.quote_number} /> : null}
      subtitle={quote ? (
        <>
          <span>{quote.quote_number}</span>
          <Money amount={quote.total_amount} currency={quote.currency} />
          {quote.expiry_date ? <span>Valid until {formatDateOnly(quote.expiry_date)}</span> : null}
        </>
      ) : null}
      details={quote ? (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          {quote.html ? (
            // The document as issued, in a blank sandbox: its HTML runs no script and reaches nothing.
            <iframe
              title={`Quote ${quote.quote_number}`}
              sandbox=""
              srcDoc={quote.html}
              className="h-[75vh] w-full min-w-0 rounded-[var(--radius-card)] border border-line-default bg-surface"
            />
          ) : <Card className="p-6 text-sm text-copy-secondary">Download the PDF to read this quote.</Card>}

          <Card className="flex h-fit min-w-0 flex-col gap-4 p-6">
            {quote.state !== "open" ? (
              <>
                <PanelHeader title="Your answer" />
                <p role="status" className="text-p-sm text-copy-secondary">
                  {quote.state === "accepted" && quote.accepted_by_name
                    ? `Accepted by ${quote.accepted_by_name}${quote.accepted_at ? ` on ${formatDateTime(quote.accepted_at)}` : ""}. `
                    : ""}
                  {CLOSED_COPY[quote.state]}
                </p>
              </>
            ) : mode === "accept" ? (
              <>
                <PanelHeader title="Accept quote" />
                <QuoteAcceptForm
                  optionalItems={quote.optional_items ?? []}
                  currency={quote.currency}
                  total={quote.total_amount}
                  submitting={isAnswering}
                  onCancel={() => setMode("view")}
                  onSubmit={async (values) => {
                    try {
                      await acceptQuote({ quoteId: quote.quote_id, values });
                      setMode("view");
                      toast.success("Quote accepted. Thank you.");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "The quote could not be accepted. Try again.");
                    }
                  }}
                />
              </>
            ) : mode === "decline" ? (
              <>
                <PanelHeader title="Decline quote" />
                <QuoteDeclineForm
                  reasons={quote.decline_reasons ?? []}
                  submitting={isAnswering}
                  onCancel={() => setMode("view")}
                  onSubmit={async (values) => {
                    try {
                      await declineQuote({ quoteId: quote.quote_id, values });
                      setMode("view");
                      toast.success("Thank you for letting us know.");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Your answer could not be sent. Try again.");
                    }
                  }}
                />
              </>
            ) : (
              <>
                <PanelHeader
                  title="Your answer"
                  description={quote.optional_items?.length ? "You can add the optional items when you accept." : undefined}
                />
                <div className="grid gap-2">
                  <Button type="button" onClick={() => setMode("accept")}><Check />Accept</Button>
                  <Button type="button" variant="outline" onClick={() => setMode("decline")}><X />Decline</Button>
                </div>
              </>
            )}
          </Card>
        </div>
      ) : null}
    />
  );
}
