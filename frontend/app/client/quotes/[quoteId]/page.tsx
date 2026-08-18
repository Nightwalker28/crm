"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Download, ScrollText, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  downloadClientQuoteProposal,
  useClientQuote,
  useClientQuoteActions,
  type ClientQuote,
} from "@/hooks/useClientPortal";
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
      toast.error("Failed to download quote proposal.");
    }
  }

  async function handleRespond(action: "approve" | "reject") {
    if (!quote) return;
    try {
      await respondToQuote({ quoteId: quote.quote_id, action, message: message.trim() || null });
      setMessage("");
      toast.success(action === "approve" ? "Quote approved." : "Quote rejected.");
    } catch {
      toast.error("Failed to update quote.");
    }
  }

  return (
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line-default pb-4">
          <Link href="/client" className="font-lynk text-3xl text-copy-primary">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client/quotes">Quotes</Link>
          </Button>
        </header>

        {quoteQuery.isLoading ? (
          <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">Loading quote...</div>
        ) : quoteQuery.error || !quote ? (
          <div className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-5 text-sm text-state-danger">
            {quoteQuery.error instanceof Error ? quoteQuery.error.message : "Quote not found."}
          </div>
        ) : (
          <div className="grid gap-5">
            <section className="rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm text-copy-secondary">
                    <ScrollText className="h-4 w-4" />
                    {quote.quote_number}
                  </div>
                  <h1 className="mt-2 text-2xl font-semibold tracking-normal text-copy-primary">{quoteTitle(quote)}</h1>
                  <p className="mt-1 text-sm text-copy-secondary">{quote.customer_name}</p>
                </div>
                <div className="text-right">
                  <div className="capitalize text-copy-secondary">{statusLabel(quote.status)}</div>
                  <div className="mt-1 text-xl font-semibold text-copy-primary">{money(quote.total_amount, quote.currency)}</div>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-xs font-medium text-copy-label">Issued</div>
                  <div className="mt-1 text-sm text-copy-secondary">{quote.issue_date ? formatDateOnly(quote.issue_date) : "Not set"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-copy-label">Expires</div>
                  <div className="mt-1 text-sm text-copy-secondary">{quote.expiry_date ? formatDateOnly(quote.expiry_date) : "No expiry"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-copy-label">Updated</div>
                  <div className="mt-1 text-sm text-copy-secondary">{formatDateTime(quote.updated_at ?? quote.created_time)}</div>
                </div>
              </div>
            </section>

            <section className="rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-copy-primary">Proposal</h2>
                  {quote.proposal_generated_at ? <p className="mt-1 text-xs text-copy-muted">Generated {formatDateTime(quote.proposal_generated_at)}</p> : null}
                </div>
                <Button type="button" variant="outline" onClick={() => void handleDownload()} disabled={!quote.proposal_content_text}>
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </div>
              {quote.proposal_content_text ? (
                <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-line-subtle bg-app p-4 text-p-sm text-copy-secondary">{quote.proposal_content_text}</pre>
              ) : (
                <div className="text-sm text-copy-muted">No generated proposal is attached to this quote yet.</div>
              )}
            </section>

            <section className="rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
              <h2 className="font-semibold text-copy-primary">Response</h2>
              <p className="mt-1 text-sm text-copy-muted">
                {quote.can_respond ? "Approve the quote or send a rejection reason for the team to review." : "This quote is not currently open for portal response."}
              </p>
              <Textarea
                className="mt-4 min-h-24"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Optional comment or rejection reason"
                disabled={!quote.can_respond || isRespondingToQuote}
              />
              <div className="mt-4 flex flex-wrap justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => void handleRespond("reject")} disabled={!quote.can_respond || isRespondingToQuote}>
                  <ThumbsDown className="h-4 w-4" />
                  Reject
                </Button>
                <Button type="button" onClick={() => void handleRespond("approve")} disabled={!quote.can_respond || isRespondingToQuote}>
                  <ThumbsUp className="h-4 w-4" />
                  Approve
                </Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
