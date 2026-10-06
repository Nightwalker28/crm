"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Download, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { RecordWorkspace } from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { Fact, FactList } from "@/components/ui/Fact";
import { Money } from "@/components/ui/Money";
import { PanelHeader } from "@/components/ui/PanelStates";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import {
  downloadClientQuoteProposal,
  useClientQuote,
  useClientQuoteActions,
  type ClientQuote,
} from "@/hooks/useClientPortal";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { getQuoteStatus } from "@/lib/statusStyles";

function quoteTitle(quote: ClientQuote) {
  return quote.title || quote.quote_number;
}

export default function ClientQuoteDetailPage() {
  const params = useParams<{ quoteId: string }>();
  const [message, setMessage] = useState("");
  const quoteQuery = useClientQuote(params.quoteId);
  const { respondToQuote, isRespondingToQuote } = useClientQuoteActions();
  const quote = quoteQuery.data;

  async function handleDownload() {
    if (!quote) return;
    try {
      await downloadClientQuoteProposal(quote);
    } catch {
      toast.error("The proposal could not be downloaded. Check your connection and try again.");
    }
  }

  async function handleRespond(action: "approve" | "reject") {
    if (!quote) return;
    try {
      await respondToQuote({ quoteId: quote.quote_id, action, message: message.trim() || null });
      setMessage("");
      toast.success(action === "approve" ? "Quote approved." : "Quote rejected.");
    } catch {
      toast.error("The response could not be sent. Check your connection and try again.");
    }
  }

  return (
    // Archetype 2, read-only (§4.7): no `spine`. Approve, Reject and Download are actions,
    // not fields — §4.7's test is whether anything edits in place, and nothing here does.
    <RecordWorkspace
      title={quote ? quoteTitle(quote) : "Quote"}
      description="Review the quote and send your response."
      backHref="/client/quotes"
      backLabel="Quotes"
      isLoading={quoteQuery.isLoading}
      hasError={Boolean(quoteQuery.error) || (!quoteQuery.isLoading && !quote)}
      onRetry={() => void quoteQuery.refetch()}
      status={quote ? <StatusValue status={getQuoteStatus(quote.status)} context="record" /> : null}
      subtitle={
        quote ? (
          <>
            <span>{quote.quote_number}</span>
            <Money amount={quote.total_amount} currency={quote.currency} />
            <span>{quote.customer_name}</span>
          </>
        ) : null
      }
      actions={
        quote ? (
          <Button type="button" variant="outline" onClick={() => void handleDownload()} disabled={!quote.proposal_content_text}>
            <Download />
            Download
          </Button>
        ) : null
      }
      details={
        quote ? (
          <div className="flex min-w-0 flex-col gap-6">
            <Card className="p-6">
              <FactList>
                <Fact label="Issued">{quote.issue_date ? formatDateOnly(quote.issue_date) : <EmptyValue context="field" />}</Fact>
                <Fact label="Expires">{quote.expiry_date ? formatDateOnly(quote.expiry_date) : <EmptyValue context="field" />}</Fact>
                <Fact label="Updated">{formatDateTime(quote.updated_at ?? quote.created_time)}</Fact>
              </FactList>
            </Card>

            <Card className="flex min-w-0 flex-col gap-4 p-6">
              <PanelHeader
                title="Proposal"
                description={
                  quote.proposal_generated_at
                    ? `Generated ${formatDateTime(quote.proposal_generated_at)}`
                    : undefined
                }
              />
              {quote.proposal_content_text ? (
                // Prose a customer reads, so the product face and no box of its own. It was a
                // `<pre>` — monospace (§3.2 keeps that for secrets and raw payloads), a bordered
                // box inside the card (§1.3's third level), and a `max-h` scroller nested in the
                // record's content region (§4.5), hidden only while the text stayed short.
                <p className="whitespace-pre-wrap text-p-sm text-copy-secondary">{quote.proposal_content_text}</p>
              ) : (
                <p className="text-sm text-copy-muted">No proposal has been attached to this quote yet.</p>
              )}
            </Card>

            <Card className="flex min-w-0 flex-col gap-4 p-6">
              <PanelHeader
                title="Your response"
                description={
                  quote.can_respond
                    ? "Approve the quote, or send a reason for the team to review."
                    : "This quote is not open for a response right now."
                }
              />
              <Textarea
                className="min-h-24"
                aria-label="Comment or rejection reason"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Optional comment or rejection reason"
                disabled={!quote.can_respond || isRespondingToQuote}
              />
              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleRespond("reject")}
                  disabled={!quote.can_respond || isRespondingToQuote}
                >
                  <ThumbsDown />
                  Reject
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleRespond("approve")}
                  disabled={!quote.can_respond || isRespondingToQuote}
                >
                  <ThumbsUp />
                  Approve
                </Button>
              </div>
            </Card>
          </div>
        ) : null
      }
    />
  );
}
